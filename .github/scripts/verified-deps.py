"""Read dependency archives as data; never follow links or archive paths."""
import json
import re
import shutil
import sys
import tarfile
import zipfile
from pathlib import Path, PurePosixPath

MAX_BYTES = 8 * 1024**3
ROOT = re.compile(r"(?:skia|angle|hermes|accesskit-c)-[a-zA-Z0-9_.-]+$")


def checked_identity(value, key):
    if (value.get("format") != 1 or value.get("key") != key
            or not re.fullmatch(r"verified-native-[a-z0-9-]+-[a-f0-9]{64}", key)):
        raise ValueError("Dependency archive identity does not match this build")
    families = {"linux-clang", "macos-universal", "windows", "windows-static"}
    if value.get("family") not in families or not key.startswith("verified-native-" + value["family"] + "-"):
        raise ValueError("Unknown dependency family")
    return value


def package(cache, output, identity):
    value = json.loads(identity.read_text())
    checked_identity(value, value["key"])
    directories = []
    for path in sorted(cache.iterdir()):
        if not ROOT.fullmatch(path.name) or path.name.endswith((".partial", ".lock")):
            continue
        if path.is_symlink() or not path.is_dir():
            raise ValueError("Dependency install must be a directory")
        for child in path.rglob("*"):
            if child.is_symlink() or not (child.is_file() or child.is_dir()):
                raise ValueError("Dependency installs cannot contain links or special files")
        if path.name.startswith("skia-") and not (path / "defines.txt").is_file():
            raise ValueError("Incomplete Skia install")
        if path.name.startswith("angle-") and not (path / "libs.txt").is_file():
            raise ValueError("Incomplete ANGLE install")
        flavors = {"windows": ["md", "mdd"], "windows-static": ["mt", "mtd"]}.get(value["family"], ["release"])
        if path.name.startswith("hermes-") and not all((path / flavor / "hermes.txt").is_file() for flavor in flavors):
            raise ValueError("Incomplete Hermes install")
        directories.append(path)
    for prefix in ["skia-", "angle-", "hermes-"]:
        if not any(path.name.startswith(prefix) for path in directories):
            raise ValueError("Missing completed " + prefix + " dependency")
    output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(identity, output / "identity.json")
    with tarfile.open(output / "dependencies.tar.gz", "w:gz", dereference=True) as archive:
        archive.add(identity, arcname="verified-deps.json", recursive=False)
        for path in directories:
            archive.add(path, arcname=path.name)


def unwrap(source, destination, candidate=False):
    # The unsigned transport ZIP is never extracted wholesale. Only three fixed
    # regular file names are copied to a scratch directory, before verification.
    limits = {"dependencies.tar.gz": 2 * 1024**3,
              "bundle.jsonl": 16 * 1024**2, "identity.json": 65536}
    if candidate:
        del limits["bundle.jsonl"]
    with zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        if len(entries) != len(limits) or {item.filename for item in entries} != set(limits):
            raise ValueError("Unexpected files in dependency artifact")
        destination.mkdir(parents=True, exist_ok=True)
        for item in entries:
            if item.is_dir() or item.file_size > limits[item.filename]:
                raise ValueError("Invalid dependency artifact member")
            with archive.open(item) as source_file, (destination / item.filename).open("wb") as target:
                shutil.copyfileobj(source_file, target)


def unpack(source, destination, key):
    # Called only after cryptographic verification. Still reject traversal,
    # links, devices and duplicate paths before writing any install files.
    with tarfile.open(source, "r:gz") as archive:
        entries = archive.getmembers()
        names = set()
        total = 0
        for item in entries:
            path = PurePosixPath(item.name)
            if (path.is_absolute() or ".." in path.parts or "\\" in item.name or ":" in item.name
                    or item.name.rstrip("/") != path.as_posix()
                    or not path.parts or item.name in names
                    or not (item.isdir() or item.isfile())
                    or (item.name != "verified-deps.json" and not ROOT.fullmatch(path.parts[0]))):
                raise ValueError("Unsafe dependency archive member")
            names.add(item.name)
            total += item.size
            if total > MAX_BYTES:
                raise ValueError("Dependency archive exceeds size limit")
        metadata = archive.extractfile("verified-deps.json")
        if metadata is None:
            raise ValueError("Missing dependency identity")
        value = checked_identity(json.loads(metadata.read(65537)), key)
        if destination.exists() and any(destination.iterdir()):
            raise ValueError("Dependency destination must be empty")
        destination.mkdir(parents=True, exist_ok=True)
        for item in entries:
            path = destination / item.name
            if item.isdir():
                path.mkdir(parents=True, exist_ok=True)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(item) as source_file, path.open("wb") as target:
                    shutil.copyfileobj(source_file, target)
                path.chmod(item.mode & 0o777)
        return value


if __name__ == "__main__":
    command, *args = sys.argv[1:]
    if command == "package":
        package(*(Path(arg) for arg in args))
    elif command == "unwrap":
        unwrap(*(Path(arg) for arg in args))
    elif command == "unwrap-candidate":
        unwrap(Path(args[0]), Path(args[1]), candidate=True)
    elif command == "unpack":
        unpack(Path(args[0]), Path(args[1]), args[2])
    else:
        raise ValueError("Unknown dependency archive operation")
