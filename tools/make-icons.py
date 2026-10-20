"""Draws the app icon: a 120-second dial with the 60-90 s window in plate green
and the hand inside it. Writes icons/icon-180.png, icon-192.png and icon-512.png,
and icon-maskable-512.png with the dial shrunk to fit inside the circle Android
crops icons to (the inner 80%)."""

import math
from pathlib import Path

from PIL import Image, ImageDraw

FLOOR = (35, 36, 39)
RING = (58, 60, 66)
GREEN = (23, 122, 69)
CHALK = (239, 238, 232)
SCALE = 4  # drawn large, then scaled down for smooth edges


def angle(seconds):
    """PIL angles start at 3 o'clock and run clockwise; the dial starts at 12."""
    return -90 + seconds / 120 * 360


def icon(size, dial=1.0):
    s = size * SCALE
    image = Image.new('RGB', (s, s), FLOOR)
    draw = ImageDraw.Draw(image)
    c = s / 2
    r = s * 0.34 * dial
    width = round(s * 0.1 * dial)
    box = [c - r, c - r, c + r, c + r]
    draw.ellipse(box, outline=RING, width=width)
    draw.arc(box, angle(60), angle(90), fill=GREEN, width=width)

    a = math.radians(angle(75))
    tip = (c + math.cos(a) * r * 0.78, c + math.sin(a) * r * 0.78)
    hand = round(s * 0.055 * dial)
    draw.line([(c, c), tip], fill=CHALK, width=hand)
    for x, y, d in [(c, c, hand * 0.9), (*tip, hand / 2)]:
        draw.ellipse([x - d, y - d, x + d, y + d], fill=CHALK)
    return image.resize((size, size), Image.LANCZOS)


out = Path(__file__).resolve().parent.parent / 'icons'
out.mkdir(exist_ok=True)
for size in (180, 192, 512):
    icon(size).save(out / f'icon-{size}.png', optimize=True)
    print(f'icons/icon-{size}.png')
icon(512, dial=0.8).save(out / 'icon-maskable-512.png', optimize=True)
print('icons/icon-maskable-512.png')
