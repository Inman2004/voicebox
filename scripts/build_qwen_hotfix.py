"""Build a replacement application core from an existing unsigned bundle.

By default only the Qwen backend and decoder modules are recompiled.
With --all-backend, existing backend modules are refreshed from the checkout.
All dependency modules,
bootloader code, runtime hooks and GPU libraries remain unchanged. Writes a
separate candidate, never replaces the installed executable. Python 3.12 only.
"""
import argparse
from pathlib import Path
import struct
import sys
import tempfile
import types

from PyInstaller.archive.readers import CArchiveReader
from PyInstaller.archive.writers import CArchiveWriter, ZlibArchiveWriter


def normalized(code):
    return (code.co_code, code.co_names,
            tuple(normalized(x) if isinstance(x, types.CodeType) else x for x in code.co_consts))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("installed", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--all-backend", action="store_true",
                        help="Refresh all existing backend modules from the current checkout")
    args = parser.parse_args()
    if sys.version_info[:2] != (3, 12):
        raise RuntimeError("This bundle uses Python 3.12")
    if args.installed.resolve() == args.output.resolve():
        raise RuntimeError("Build a separate candidate before deployment")
    archive = CArchiveReader(str(args.installed))
    z = archive.open_embedded_archive("PYZ.pyz")
    root = Path(__file__).resolve().parents[1]
    replacement = {"backend.backends.qwen_fast_decode", "backend.backends.qwen_fast_predictor",
                   "backend.backends.qwen_custom_voice_backend"}
    if args.all_backend:
        replacement.update(name for name, (kind, *_rest) in z.toc.items()
                           if name.startswith("backend.") and kind in (0, 1))
    code_dict, entries = {}, []
    for name, (kind, *_rest) in z.toc.items():
        if kind == 3:
            entries.append((name, None, "PYMODULE"))
            continue
        code_dict[name] = z.extract(name)
        entries.append((name, "__init__.py" if kind == 1 else name + ".py", "PYMODULE"))
    for name in replacement:
        path = root / (name.replace(".", "/") + ".py")
        if name in z.toc and z.toc[name][0] == 1:
            path = path.with_suffix("") / "__init__.py"
        code_dict[name] = compile(path.read_text(encoding="utf-8"), str(path), "exec")
        if name not in z.toc:
            entries.append((name, str(path), "PYMODULE"))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="voicebox-core-build-") as tmp:
        pyz = Path(tmp) / "PYZ.pyz"
        ZlibArchiveWriter(str(pyz), entries, code_dict)

        class BlobArchiveWriter(CArchiveWriter):
            def _write_entry(self, fp, entry):
                name, blob, compress, kind = entry
                return self._write_blob(fp, blob, name, kind, compress=compress)

        payload = [(name, pyz.read_bytes() if name == "PYZ.pyz" else archive.extract(name),
                    meta[3], meta[4]) for name, meta in archive.toc.items()]
        payload.extend((name, b"", False, "o") for name in archive.options)
        raw = args.installed.read_bytes()
        cookie = struct.unpack(CArchiveReader._COOKIE_FORMAT,
                               raw[archive._end_offset - CArchiveReader._COOKIE_LENGTH:archive._end_offset])
        pkg = Path(tmp) / "replacement.pkg"
        BlobArchiveWriter(str(pkg), payload, cookie[-1].rstrip(b'\0').decode('ascii'))
        with args.output.open("wb") as out:
            out.write(raw[:archive._start_offset])
            out.write(pkg.read_bytes())
    candidate = CArchiveReader(str(args.output)).open_embedded_archive("PYZ.pyz")
    for name in z.toc:
        if name not in replacement and z.toc[name][0] != 3:
            if normalized(candidate.extract(name)) != normalized(z.extract(name)):
                raise RuntimeError(f"Unexpected dependency change: {name}")
    for name in replacement:
        assert normalized(candidate.extract(name)) == normalized(code_dict[name])
    print("Built", args.output, "with", len(replacement), "application modules refreshed")


if __name__ == "__main__":
    main()
