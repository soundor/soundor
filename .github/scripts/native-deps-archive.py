"""Pack and unpack one native dependency install (native-deps-release.mjs).

An install is a directory of the Soundor cache that CMake names after what made
it: skia-<...>, angle-<...>, or one flavor of a Hermes build, hermes-<...>/<flavor>.
Archives are read as data: never follow links or archive paths outside the
install, and write it under a temporary name renamed into place when complete.
"""
import os
import re
import shutil
import sys
import tarfile
from pathlib import Path, PurePosixPath

MAX_BYTES = 8 * 1024**3
INSTALL = re.compile(r"(?:(?:skia|angle)-[a-z0-9_-]+|hermes-[a-z0-9_-]+/(?:release|md|mdd|mt|mtd))")
MARKERS = {"skia": "defines.txt", "angle": "libs.txt", "hermes": "hermes.txt"}


def checked(install):
    if not INSTALL.fullmatch(install):
        raise ValueError("Not a native dependency install: " + install)
    return install


def marker(install):
    return MARKERS[install.split("-", 1)[0]]


def pack(cache, install, output):
    checked(install)
    root = cache / install
    if root.is_symlink() or not (root / marker(install)).is_file():
        raise ValueError("Incomplete install: " + install)
    for child in root.rglob("*"):
        if child.is_symlink() or not (child.is_file() or child.is_dir()):
            raise ValueError("Installs cannot contain links or special files: " + str(child))
    output.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(output, "w:gz") as archive:
        archive.add(root, arcname=install)


def unpack(source, cache, install):
    # Called after the archive's digest and attestation are verified. Still reject
    # traversal, links, devices and duplicates before writing anything.
    checked(install)
    final = cache / install
    if (final / marker(install)).exists():
        raise ValueError("Install already exists: " + install)
    partial = final.with_name(final.name + ".fetching")
    shutil.rmtree(partial, ignore_errors=True)
    with tarfile.open(source, "r:gz") as archive:
        entries = archive.getmembers()
        names = set()
        total = 0
        for item in entries:
            path = PurePosixPath(item.name)
            if (path.is_absolute() or ".." in path.parts or "\\" in item.name or ":" in item.name
                    or item.name.rstrip("/") != path.as_posix() or item.name in names
                    or not (item.isdir() or item.isfile())
                    or (item.name != install and not item.name.startswith(install + "/"))):
                raise ValueError("Unsafe archive member: " + item.name)
            names.add(item.name)
            total += item.size
            if total > MAX_BYTES:
                raise ValueError("Archive exceeds size limit")
        if install + "/" + marker(install) not in names:
            raise ValueError("Archive is not a complete install: " + install)
        partial.mkdir(parents=True)
        for item in entries:
            relative = PurePosixPath(item.name).relative_to(install)
            path = partial / relative
            if item.isdir():
                path.mkdir(parents=True, exist_ok=True)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(item) as source_file, path.open("wb") as target:
                    shutil.copyfileobj(source_file, target)
                path.chmod(item.mode & 0o777)
    # What a build left without its marker is incomplete: the install replaces it.
    if final.is_symlink() or final.is_file():
        final.unlink()
    elif final.exists():
        shutil.rmtree(final)
    os.replace(partial, final)


if __name__ == "__main__":
    command, *args = sys.argv[1:]
    if command == "pack":
        pack(Path(args[0]), args[1], Path(args[2]))
    elif command == "unpack":
        unpack(Path(args[0]), Path(args[1]), args[2])
    else:
        raise ValueError("Unknown archive operation")
