#!/usr/bin/env python3
"""
Utility to unpack a PyInstaller-built executable using PyInstaller's own readers.

This avoids depending on external scripts and works entirely offline.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path

from PyInstaller.archive import readers


PYI_TYPE_SUFFIX = {
    readers.PKG_ITEM_PYMODULE: ".pyc",
    readers.PKG_ITEM_PYPACKAGE: ".pyc",
    readers.PKG_ITEM_PYSOURCE: ".pyc",
}


def _normalize_name(raw: str) -> Path:
    parts = raw.replace("\\", "/").split("/")
    return Path(*parts)


def _write_file(base: Path, relative: Path, data: bytes) -> Path:
    target = base / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return target


def extract_pkg(exe_path: Path, output_dir: Path) -> readers.CArchiveReader:
    output_dir.mkdir(parents=True, exist_ok=True)
    archive = readers.CArchiveReader(str(exe_path))

    for name, (_, _, _, _, typecode) in archive.toc.items():
        if typecode == readers.PKG_ITEM_RUNTIME_OPTION:
            continue

        rel_path = _normalize_name(name)
        suffix = PYI_TYPE_SUFFIX.get(typecode, "")
        if suffix and rel_path.suffix != suffix:
            rel_path = rel_path.with_suffix(rel_path.suffix + suffix if rel_path.suffix else suffix)

        data = archive.extract(name)
        _write_file(output_dir, rel_path, data)

    return archive


def extract_pyz(archive: readers.CArchiveReader, output_dir: Path):
    try:
        pyz = archive.open_embedded_archive("PYZ.pyz")
    except readers.NotAnArchiveError:
        return

    pyz_root = output_dir / "PYZ-contents"
    for fullname in pyz.toc.keys():
        blob = pyz.extract(fullname, raw=True)
        if blob is None:
            continue

        rel_path = Path(*fullname.split("."))  # e.g. package.module
        rel_path = rel_path.with_suffix(rel_path.suffix + ".pyc" if rel_path.suffix else ".pyc")
        _write_file(pyz_root, rel_path, blob)


def main():
    parser = argparse.ArgumentParser(description="Extract contents of a PyInstaller-built executable.")
    parser.add_argument("exe", type=Path, help="Path to the PyInstaller executable (the .exe file).")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Destination directory for extracted files (default: <exe>-extracted)",
    )
    args = parser.parse_args()

    exe_path = args.exe.resolve()
    output_dir = args.output or exe_path.with_suffix(".extracted")
    output_dir = output_dir.resolve()

    print(f"[+] Unpacking {exe_path}")
    archive = extract_pkg(exe_path, output_dir)
    print(f"[+] Wrote PKG members to {output_dir}")
    extract_pyz(archive, output_dir)
    print(f"[+] Extracted embedded PYZ archive (if present) under {output_dir / 'PYZ-contents'}")


if __name__ == "__main__":
    main()






