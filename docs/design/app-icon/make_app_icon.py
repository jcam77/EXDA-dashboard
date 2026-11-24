#!/usr/bin/env python3
"""Generate the EXDA app icon ("EX / DA" monogram).

Dark rounded square with "EX" over "DA" in the start page's teal-to-blue
gradient (theme colours primary -> secondary of the dark theme), set in Inter
ExtraBold, the app's font. Drawn at 4x and scaled down for smooth edges.

Writes:
  docs/design/app-icon/exda-icon-1024.png   source image
  EXDA.app/Contents/Resources/EXDA.icns     macOS launcher icon
  scripts/EXDA.ico                          Windows shortcut icon (made by Setup-EXDA-WIN.bat)
  frontend/public/favicon.ico               browser tab icon
  frontend/public/exda-icon-192.png         browser / home-screen icon
  frontend/public/apple-touch-icon.png      Safari / iOS icon (180 px)

Usage (from the repository root):
  python3 docs/design/app-icon/make_app_icon.py
"""

import colorsys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[3]
FONT = ROOT / "frontend/public/fonts/Inter/static/Inter_18pt-ExtraBold.ttf"
OUT_PNG = Path(__file__).resolve().parent / "exda-icon-1024.png"
OUT_ICNS = ROOT / "EXDA.app/Contents/Resources/EXDA.icns"
OUT_ICO = ROOT / "scripts/EXDA.ico"
ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
PUBLIC = ROOT / "frontend/public"

SCALE = 4
SIZE = 1024 * SCALE


def hsl(h, s, l):
    r, g, b = colorsys.hls_to_rgb(h / 360, l / 100, s / 100)
    return int(r * 255), int(g * 255), int(b * 255)


# Dark-theme tokens from frontend/src/index.css
BACKGROUND = hsl(220, 29, 6)
PANEL = hsl(220, 26, 11)
PRIMARY = hsl(192, 70, 62)
SECONDARY = hsl(212, 50, 44)
OUTLINE = hsl(192, 40, 30)


def px(value):
    return int(value * SCALE)


def make_icon():
    box = (px(40), px(40), SIZE - px(40), SIZE - px(40))
    icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

    shape = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(shape).rounded_rectangle(box, radius=px(210), fill=255)
    background = Image.new("RGBA", (SIZE, SIZE), BACKGROUND + (255,))
    glow = Image.new("L", (SIZE // 8, SIZE // 8), 0)
    ImageDraw.Draw(glow).ellipse((SIZE // 8 * 0.15, SIZE // 8 * 0.06, SIZE // 8 * 0.85, SIZE // 8 * 0.68), fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(15)).resize((SIZE, SIZE))
    background = Image.composite(Image.new("RGBA", (SIZE, SIZE), PANEL + (255,)), background, glow)
    icon.paste(background, (0, 0), shape)
    ImageDraw.Draw(icon).rounded_rectangle(box, radius=px(210), outline=OUTLINE + (255,), width=px(6))

    letters = Image.new("L", (SIZE, SIZE), 0)
    draw = ImageDraw.Draw(letters)
    font = ImageFont.truetype(str(FONT), px(330))
    for text, top in (("EX", 170), ("DA", 500)):
        width = draw.textlength(text, font=font)
        draw.text(((SIZE - width) / 2, px(top)), text, font=font, fill=255)

    row = Image.new("RGBA", (SIZE, 1))
    for x in range(SIZE):
        t = x / (SIZE - 1)
        row.putpixel((x, 0), tuple(int(PRIMARY[i] * (1 - t) + SECONDARY[i] * t) for i in range(3)) + (255,))
    gradient = row.resize((SIZE, SIZE))
    coloured = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    coloured.paste(gradient, (0, 0), letters)
    icon.alpha_composite(coloured)
    return icon.resize((1024, 1024), Image.LANCZOS)


def main():
    icon = make_icon()
    icon.save(OUT_PNG)
    OUT_ICNS.parent.mkdir(parents=True, exist_ok=True)
    icon.save(OUT_ICNS)
    icon.save(OUT_ICO, sizes=ICO_SIZES)
    icon.save(PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    icon.resize((192, 192), Image.LANCZOS).save(PUBLIC / "exda-icon-192.png")
    icon.resize((180, 180), Image.LANCZOS).save(PUBLIC / "apple-touch-icon.png")
    print(OUT_PNG)
    print(OUT_ICNS)
    print(OUT_ICO)


if __name__ == "__main__":
    main()
