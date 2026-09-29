#!/usr/bin/env python3
"""
Build the bundled avatar images for built-in (preset) voices.

Faces come from https://thispersondoesnotexist.com — StyleGAN-generated
portraits of people who do not exist, so no real person's likeness is
attached to a synthetic voice. The app never fetches these at runtime;
the output is committed under backend/voices/avatars/.

Two steps, because matching a face to a voice (gender, age, region) is a
human judgement:

    # 1. download a candidate pool + numbered contact sheets to review
    python scripts/fetch_voice_avatars.py pool --count 150 --out .avatar-pool

    # 2. write an assignment file {"kokoro:af_heart": 17, ...} and build
    python scripts/fetch_voice_avatars.py build --pool .avatar-pool \
        --assign scripts/voice_avatar_assignments.json

Requires Pillow.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw

SOURCE_URL = "https://thispersondoesnotexist.com/random-person.jpeg"
USER_AGENT = "Mozilla/5.0 (voicebox avatar builder)"
REPO_ROOT = Path(__file__).resolve().parent.parent
AVATAR_DIR = REPO_ROOT / "backend" / "voices" / "avatars"
AVATAR_SIZE = 256
THUMB = 160
SHEET_COLS = 8
SHEET_ROWS = 5


def _download(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        if resp.headers.get_content_type() != "image/jpeg":
            raise RuntimeError(f"unexpected content type {resp.headers.get_content_type()}")
        return resp.read()


def cmd_pool(args: argparse.Namespace) -> None:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    seen = {hashlib.md5(p.read_bytes()).hexdigest() for p in out.glob("*.jpg")}
    index = len(list(out.glob("*.jpg")))

    while index < args.count:
        try:
            data = _download(SOURCE_URL)
        except Exception as e:  # transient network errors: back off and retry
            print(f"  retry after error: {e}", file=sys.stderr)
            time.sleep(3)
            continue
        digest = hashlib.md5(data).hexdigest()
        if digest in seen:  # the site caches for ~1s; skip repeats
            time.sleep(1.2)
            continue
        seen.add(digest)
        (out / f"{index:03d}.jpg").write_bytes(data)
        print(f"  {index:03d}.jpg")
        index += 1
        time.sleep(args.delay)

    _contact_sheets(out)


def _contact_sheets(pool: Path) -> None:
    files = sorted(pool.glob("[0-9][0-9][0-9].jpg"))
    per_sheet = SHEET_COLS * SHEET_ROWS
    for sheet_no in range(0, len(files), per_sheet):
        batch = files[sheet_no : sheet_no + per_sheet]
        sheet = Image.new("RGB", (SHEET_COLS * THUMB, SHEET_ROWS * (THUMB + 18)), "white")
        draw = ImageDraw.Draw(sheet)
        for i, f in enumerate(batch):
            img = Image.open(f).convert("RGB").resize((THUMB, THUMB))
            x, y = (i % SHEET_COLS) * THUMB, (i // SHEET_COLS) * (THUMB + 18)
            sheet.paste(img, (x, y))
            draw.text((x + 4, y + THUMB + 2), f.stem, fill="black")
        name = pool / f"sheet_{sheet_no // per_sheet:02d}.png"
        sheet.save(name)
        print(f"contact sheet: {name}")


def _crop_face(img: Image.Image) -> Image.Image:
    """StyleGAN portraits are face-centred; crop slightly tighter so the
    face fills a small circular avatar."""
    w, h = img.size
    margin = int(w * 0.12)
    return img.crop((margin, int(h * 0.06), w - margin, int(h * 0.06) + (w - 2 * margin)))


def cmd_build(args: argparse.Namespace) -> None:
    pool = Path(args.pool)
    assignments: dict[str, int] = json.loads(Path(args.assign).read_text(encoding="utf-8"))
    AVATAR_DIR.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, str] = {}
    for key, idx in sorted(assignments.items()):
        src = pool / f"{int(idx):03d}.jpg"
        if not src.exists():
            raise SystemExit(f"{key}: pool image {src} not found")
        engine, voice_id = key.split(":", 1)
        filename = f"{engine}_{voice_id}.webp".lower()
        img = _crop_face(Image.open(src).convert("RGB")).resize((AVATAR_SIZE, AVATAR_SIZE), Image.LANCZOS)
        img.save(AVATAR_DIR / filename, "WEBP", quality=82, method=6)
        manifest[key] = filename

    (AVATAR_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {len(manifest)} avatars to {AVATAR_DIR}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("pool", help="download a pool of candidate faces")
    p.add_argument("--count", type=int, default=150)
    p.add_argument("--out", default=".avatar-pool")
    p.add_argument("--delay", type=float, default=1.3, help="seconds between requests")
    p.set_defaults(func=cmd_pool)

    b = sub.add_parser("build", help="crop/resize assigned faces into backend/voices/avatars")
    b.add_argument("--pool", default=".avatar-pool")
    b.add_argument("--assign", default=str(REPO_ROOT / "scripts" / "voice_avatar_assignments.json"))
    b.set_defaults(func=cmd_build)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
