#!/usr/bin/env python3
"""Make upscaled, ID-labeled contact sheets from the combined FRLG atlas.

Atlas: 256x736, 16 cols of 16x16 metatiles, frame index == metatile id.
Output: /tmp/frtiles/labeled/sheet_<start>_<end>.png, 8 tiles per row,
each tile upscaled 5x with its numeric id printed above it.
"""
import os
from PIL import Image, ImageDraw

ATLAS = '/Users/vishaltandale/ProjectsDev/pokemon-living-world/public/tiles/atlas.png'
OUT = '/tmp/frtiles/labeled'
SCALE = 5
COLS = 8
LABEL_H = 14
CELL_W = 16 * SCALE + 4   # 84
CELL_H = 16 * SCALE + LABEL_H + 4  # 98

atlas = Image.open(ATLAS).convert('RGBA')
total = (atlas.height // 16) * 16  # 46 rows * 16 = 736

os.makedirs(OUT, exist_ok=True)

def tile(i):
    x, y = (i % 16) * 16, (i // 16) * 16
    return atlas.crop((x, y, x + 16, y + 16))

CHUNK = 128
for start in range(0, total, CHUNK):
    end = min(start + CHUNK, total) - 1
    n = end - start + 1
    rows = (n + COLS - 1) // COLS
    sheet = Image.new('RGBA', (COLS * CELL_W, rows * CELL_H), (40, 40, 48, 255))
    d = ImageDraw.Draw(sheet)
    for k in range(n):
        i = start + k
        cx, cy = (k % COLS) * CELL_W, (k // COLS) * CELL_H
        up = tile(i).resize((16 * SCALE, 16 * SCALE), Image.NEAREST)
        sheet.paste(up, (cx + 2, cy + LABEL_H + 2))
        d.text((cx + 4, cy + 1), str(i), fill=(255, 255, 120, 255))
        d.rectangle((cx + 2, cy + LABEL_H + 2, cx + 2 + 16 * SCALE - 1, cy + LABEL_H + 2 + 16 * SCALE - 1), outline=(90, 90, 110, 255))
    p = f'{OUT}/sheet_{start:03d}_{end:03d}.png'
    sheet.save(p)
    print(p, sheet.size)
