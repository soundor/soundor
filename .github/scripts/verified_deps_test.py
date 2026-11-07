import importlib.util
import io
import json
import tempfile
import tarfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("archives", Path(__file__).with_name("verified-deps.py"))
archives = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archives)


class VerifiedDependencies(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.key = "verified-native-windows-static-" + "a" * 64
        self.identity = self.root / "identity.json"
        self.identity.write_text(json.dumps({"format": 1, "key": self.key, "family": "windows-static"}))
        self.cache = self.root / "cache"
        for name in ["skia-revision/defines.txt", "angle-revision/libs.txt",
                     "hermes-revision/mt/hermes.txt", "hermes-revision/mtd/hermes.txt"]:
            path = self.cache / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("fixture")
        self.output = self.root / "candidate"

    def test_roundtrip_contains_completed_installs_and_signed_identity_only(self):
        partial = self.cache / "skia-incomplete.partial"
        partial.mkdir()
        (partial / "source.cpp").write_text("not a finished dependency")
        archives.package(self.cache, self.output, self.identity)
        destination = self.root / "restored"
        value = archives.unpack(self.output / "dependencies.tar.gz", destination, self.key)
        self.assertEqual(value["key"], self.key)
        self.assertEqual((destination / "hermes-revision/mt/hermes.txt").read_text(), "fixture")
        self.assertFalse((destination / partial.name).exists())
        with self.assertRaisesRegex(ValueError, "empty"):
            archives.unpack(self.output / "dependencies.tar.gz", destination, self.key)

    def test_missing_or_incomplete_dependencies_cannot_be_signed(self):
        (self.cache / "hermes-revision/mtd/hermes.txt").unlink()
        with self.assertRaisesRegex(ValueError, "Incomplete Hermes"):
            archives.package(self.cache, self.output, self.identity)

    def test_symlink_in_install_is_rejected(self):
        (self.cache / "skia-revision/link").symlink_to(self.identity)
        with self.assertRaisesRegex(ValueError, "links"):
            archives.package(self.cache, self.output, self.identity)

    def test_foreign_identity_cannot_be_activated(self):
        archives.package(self.cache, self.output, self.identity)
        with self.assertRaisesRegex(ValueError, "identity"):
            archives.unpack(self.output / "dependencies.tar.gz", self.root / "restored", "verified-native-windows-static-" + "b" * 64)
        self.assertFalse((self.root / "restored").exists())

    def test_tar_traversal_links_devices_and_duplicates_are_rejected_before_writes(self):
        for name, member_type in [("../escape", tarfile.REGTYPE),
                                  ("/tmp/escape", tarfile.REGTYPE),
                                  ("skia-x/../../escape", tarfile.REGTYPE),
                                  ("skia-x/./a", tarfile.REGTYPE),
                                  ("skia-x\\escape", tarfile.REGTYPE),
                                  ("skia-x/C:escape", tarfile.REGTYPE),
                                  ("skia-x/link", tarfile.SYMTYPE),
                                  ("skia-x/link", tarfile.LNKTYPE),
                                  ("skia-x/device", tarfile.CHRTYPE)]:
            with self.subTest(name=name, kind=member_type):
                archive = self.root / "bad.tar.gz"
                with tarfile.open(archive, "w:gz") as target:
                    member = tarfile.TarInfo(name)
                    member.type = member_type
                    target.addfile(member, io.BytesIO())
                destination = self.root / "bad-restore"
                with self.assertRaisesRegex(ValueError, "Unsafe"):
                    archives.unpack(archive, destination, self.key)
                self.assertFalse(destination.exists())
        with tarfile.open(self.root / "bad.tar.gz", "w:gz") as target:
            for _ in range(2):
                target.addfile(tarfile.TarInfo("skia-x/file"), io.BytesIO())
        with self.assertRaisesRegex(ValueError, "Unsafe"):
            archives.unpack(self.root / "bad.tar.gz", self.root / "bad-restore", self.key)

    def test_zip_wrapper_copies_only_fixed_regular_file_paths(self):
        source = self.root / "transport.zip"
        with zipfile.ZipFile(source, "w") as archive:
            for name in ["dependencies.tar.gz", "bundle.jsonl", "identity.json"]:
                archive.writestr(name, "fixture")
        destination = self.root / "unwrapped"
        archives.unwrap(source, destination)
        self.assertEqual((destination / "bundle.jsonl").read_text(), "fixture")
        with zipfile.ZipFile(source, "w") as archive:
            for name in ["dependencies.tar.gz", "identity.json"]:
                archive.writestr(name, "candidate")
        archives.unwrap(source, self.root / "candidate-wrapper", candidate=True)
        self.assertEqual((self.root / "candidate-wrapper/identity.json").read_text(), "candidate")
        for bad in ["../bundle.jsonl", "nested/bundle.jsonl", "executable.exe"]:
            with zipfile.ZipFile(source, "w") as archive:
                for name in ["dependencies.tar.gz", bad, "identity.json"]:
                    archive.writestr(name, "fixture")
            with self.assertRaisesRegex(ValueError, "Unexpected"):
                archives.unwrap(source, self.root / "bad-wrapper")
            self.assertFalse((self.root / "bad-wrapper").exists())


if __name__ == "__main__":
    unittest.main()
