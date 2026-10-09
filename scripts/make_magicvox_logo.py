"""Render the MagicVox logo: a magenta→violet microphone with sparkles.

Outputs
  app/src/assets/magicvox-logo.png   512px, transparent (sidebar/about, glows via CSS)
  <out>/magicvox-icon-1024.png       1024px on a dark rounded tile (app icon source
                                     for `bun run tauri icon`)

Usage: python scripts/make_magicvox_logo.py [icon_out_dir]
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SS = 2048  # supersampled canvas, downscaled for anti-aliasing
MAGENTA = (255, 46, 170)
VIOLET = (124, 58, 255)
ROOT = Path(__file__).resolve().parents[1]


def gradient(size: int) -> Image.Image:
    """Diagonal magenta (top-left) → violet (bottom-right)."""
    grad = Image.new("RGBA", (size, size))
    px = grad.load()
    for y in range(size):
        for x in range(size):
            t = min(1.0, max(0.0, (0.35 * x + 0.65 * y) / size))
            px[x, y] = tuple(int(MAGENTA[i] + (VIOLET[i] - MAGENTA[i]) * t) for i in range(3)) + (255,)
    return grad


def star(draw: ImageDraw.ImageDraw, cx: float, cy: float, r: float) -> None:
    """Four-point sparkle."""
    w = r * 0.28
    draw.polygon([(cx, cy - r), (cx + w, cy - w), (cx + r, cy), (cx + w, cy + w),
                  (cx, cy + r), (cx - w, cy + w), (cx - r, cy), (cx - w, cy - w)], fill=255)


def mic_mask(s: int) -> Image.Image:
    k = s / 1024
    m = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(m)
    # Capsule head
    d.rounded_rectangle([392 * k, 150 * k, 632 * k, 600 * k], radius=120 * k, fill=255)
    # Holder arc, stem and base
    d.arc([300 * k, 250 * k, 724 * k, 710 * k], start=0, end=180, fill=255, width=int(44 * k))
    d.rounded_rectangle([490 * k, 700 * k, 534 * k, 845 * k], radius=10 * k, fill=255)
    d.rounded_rectangle([380 * k, 820 * k, 644 * k, 872 * k], radius=26 * k, fill=255)
    # Sparkles
    star(d, 772 * k, 196 * k, 92 * k)
    star(d, 238 * k, 310 * k, 58 * k)
    star(d, 812 * k, 452 * k, 40 * k)
    # Grille: cut thin horizontal slots into the head
    for y in (300, 360, 420):
        d.rounded_rectangle([452 * k, (y - 9) * k, 572 * k, (y + 9) * k], radius=9 * k, fill=0)
    return m


def render(size: int, tile: bool) -> Image.Image:
    grad = gradient(SS)
    mask = mic_mask(SS)
    art = Image.new("RGBA", (SS, SS), (0, 0, 0, 0))
    if tile:
        bg = Image.new("L", (SS, SS), 0)
        ImageDraw.Draw(bg).rounded_rectangle([40, 40, SS - 40, SS - 40], radius=int(SS * 0.22), fill=255)
        art.paste((22, 10, 34, 255), (0, 0), bg)
        # Soft inner glow behind the mic
        glow = mask.filter(ImageFilter.GaussianBlur(SS * 0.03))
        art.paste(Image.new("RGBA", (SS, SS), (190, 60, 255, 120)), (0, 0), glow)
    art.paste(grad, (0, 0), mask)
    return art.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    icon_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "scripts"
    render(512, tile=False).save(ROOT / "app" / "src" / "assets" / "magicvox-logo.png")
    render(1024, tile=True).save(icon_dir / "magicvox-icon-1024.png")
    print("wrote logo and icon")
