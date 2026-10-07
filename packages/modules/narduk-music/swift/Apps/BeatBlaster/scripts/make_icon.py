#!/usr/bin/env python3
"""Renders Beat Blaster's 1024x1024 app icon (no alpha) into the asset catalog.

Run from the app folder: `python3 scripts/make_icon.py`. Needs Pillow. Neon equalizer bars and a lightning bolt on a
deep purple glow; everything is drawn here, so the PNG is reproducible.
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

S = 1024
OUT = Path(__file__).resolve().parent.parent / "Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def background():
    img = Image.new("RGB", (S, S))
    px = img.load()
    inner, outer = (70, 12, 120), (6, 2, 20)
    for y in range(S):
        for x in range(S):
            d = math.hypot(x - S / 2, y - S * 0.55) / (S * 0.72)
            px[x, y] = lerp(inner, outer, min(1.0, d))
    return img


def glow_layer(draw_fn, blur):
    layer = Image.new("RGB", (S, S), (0, 0, 0))
    draw_fn(ImageDraw.Draw(layer))
    return layer.filter(ImageFilter.GaussianBlur(blur))


def add(base, layer):
    from PIL import ImageChops

    return ImageChops.add(base, layer)


RAINBOW = [(255, 60, 170), (255, 120, 40), (255, 220, 40), (60, 255, 140), (40, 220, 255), (150, 90, 255), (255, 60, 220)]
HEIGHTS = [0.32, 0.55, 0.78, 0.62, 0.86, 0.5, 0.36]


def bars(d, inset=0):
    n = len(HEIGHTS)
    left, right, floor = 150, S - 150, 820
    slot = (right - left) / n
    for i, h in enumerate(HEIGHTS):
        x0 = left + i * slot + slot * 0.16 + inset
        x1 = left + (i + 1) * slot - slot * 0.16 - inset
        top = floor - h * 560 + inset
        d.rounded_rectangle([x0, top, x1, floor - inset], radius=(x1 - x0) / 2, fill=RAINBOW[i])


BOLT = [(560, 120), (360, 560), (500, 560), (430, 900), (690, 420), (540, 420), (640, 120)]


def bolt(d, color=(255, 255, 255)):
    d.polygon(BOLT, fill=color)


def ring(d, width):
    d.ellipse([70, 70, S - 70, S - 70], outline=(0, 230, 255), width=width)


img = background()
img = add(img, glow_layer(lambda d: ring(d, 40), 40))
img = add(img, glow_layer(lambda d: ring(d, 14), 6))
img = add(img, glow_layer(bars, 45))
dark = ImageDraw.Draw(img)
bars(dark)
# Darken the bars a touch under the bolt so it reads.
img = add(img, glow_layer(lambda d: bolt(d, (255, 230, 60)), 50))
img = add(img, glow_layer(lambda d: bolt(d, (255, 200, 40)), 18))
bolt(ImageDraw.Draw(img), (255, 250, 210))

OUT.parent.mkdir(parents=True, exist_ok=True)
img.convert("RGB").save(OUT, "PNG")
print(OUT)
