#!/usr/bin/env python3
"""Render real FRLG interior maps (Building primary + a secondary tileset) to
PNGs, and extract per-tile collision from the map block bits.

map.bin: one u16 LE per block.
  metatile id = v & 0x03FF ; collision = (v >> 10) & 3 ; elevation = v >> 12
metatiles.bin: 8 u16 per metatile (4 bottom-layer + 4 top-layer quadrant tiles)
  u16 = tileId(0..9) | flipX(10) | flipY(11) | palette(12..15)
Primary owns tile ids 0..639 + palettes 0..6; secondary owns 640+ + palettes 7..12.
"""
import struct, zlib, json, os

ROOT = '/tmp/frtiles/interiors'
NUM_PRIMARY_TILES = 640

def read_png_indexed(path):
    data = open(path, 'rb').read()
    pos = 8; w = h = bitdepth = None; idat = b''
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos+4])[0]
        typ = data[pos+4:pos+8].decode()
        chunk = data[pos+8:pos+8+ln]
        if typ == 'IHDR':
            w, h, bitdepth, ctype = struct.unpack('>IIBB', chunk[:10])
        elif typ == 'IDAT':
            idat += chunk
        pos += 12 + ln
    raw = zlib.decompress(idat)
    rowbytes = (w * 4 + 7) // 8 if bitdepth == 4 else w
    out = []; prev = bytearray(rowbytes); p = 0
    for _y in range(h):
        f = raw[p]; p += 1
        row = bytearray(raw[p:p+rowbytes]); p += rowbytes
        if f == 1:
            for i in range(rowbytes): row[i] = (row[i] + (row[i-1] if i else 0)) & 0xff
        elif f == 2:
            for i in range(rowbytes): row[i] = (row[i] + prev[i]) & 0xff
        elif f == 3:
            for i in range(rowbytes):
                a = row[i-1] if i else 0
                row[i] = (row[i] + ((a + prev[i]) >> 1)) & 0xff
        elif f == 4:
            for i in range(rowbytes):
                a = row[i-1] if i else 0; b = prev[i]; c = prev[i-1] if i else 0
                pa, pb, pc = abs(b-c), abs(a-c), abs(a+b-2*c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                row[i] = (row[i] + pr) & 0xff
        prev = row
        if bitdepth == 4:
            px = []
            for i in range(w):
                byte = row[i >> 1]
                px.append((byte >> 4) if i % 2 == 0 else (byte & 0xf))
            out.append(px)
        else:
            out.append(list(row[:w]))
    return w, h, out

def read_pal(path):
    lines = open(path).read().splitlines()
    n = int(lines[2])
    return [tuple(map(int, lines[3+i].split())) for i in range(n)]

def tiles_from_indexed(w, h, px):
    tiles = []
    for ty in range(h // 8):
        for tx in range(w // 8):
            tiles.append([[px[ty*8+y][tx*8+x] for x in range(8)] for y in range(8)])
    return tiles

def write_png_rgba(path, w, h, rgba_rows):
    def chunk(typ, data):
        return struct.pack('>I', len(data)) + typ + data + struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff)
    raw = b''.join(b'\x00' + bytes(row) for row in rgba_rows)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    open(path, 'wb').write(png)

def load_tileset(primary_dir, secondary_dir):
    pw, ph, ppx = read_png_indexed(f'{primary_dir}/tiles.png')
    sw, sh, spx = read_png_indexed(f'{secondary_dir}/tiles.png')
    ptiles = tiles_from_indexed(pw, ph, ppx)
    stiles = tiles_from_indexed(sw, sh, spx)
    pals = []
    for i in range(13):
        n = f'{i:02d}'
        path = f'{primary_dir}/palettes/{n}.pal' if i <= 6 else f'{secondary_dir}/palettes/{n}.pal'
        pals.append(read_pal(path) if os.path.exists(path) else [(0,0,0)]*16)
    pmeta = open(f'{primary_dir}/metatiles.bin', 'rb').read()
    smeta = open(f'{secondary_dir}/metatiles.bin', 'rb').read()
    def get_tile(tid):
        if tid < NUM_PRIMARY_TILES:
            return ptiles[tid] if tid < len(ptiles) else None
        sid = tid - NUM_PRIMARY_TILES
        return stiles[sid] if sid < len(stiles) else None
    def metatile_words(mid):
        src = pmeta if mid < 640 else smeta
        base = (mid if mid < 640 else mid - 640) * 16
        if base + 16 > len(src): return None
        return [struct.unpack_from('<H', src, base + i*2)[0] for i in range(8)]
    return get_tile, metatile_words, pals

def render_map(name, secondary, mapfile, w, h):
    get_tile, metatile_words, pals = load_tileset(f'{ROOT}/building', f'{ROOT}/{secondary}')
    mapdata = open(f'{ROOT}/{mapfile}', 'rb').read()
    img = [[(0, 0, 0, 255)] * (w*16) for _ in range(h*16)]
    collision = [[0]*w for _ in range(h)]
    for by in range(h):
        for bx in range(w):
            v = struct.unpack_from('<H', mapdata, (by*w + bx)*2)[0]
            mid = v & 0x3ff
            collision[by][bx] = 1 if (v >> 10) & 3 else 0
            words = metatile_words(mid)
            if not words: continue
            ox, oy = bx*16, by*16
            for layer in range(2):
                for q in range(4):
                    val = words[layer*4 + q]
                    tid = val & 0x3ff
                    fx, fy = bool(val & 0x400), bool(val & 0x800)
                    pal = (val >> 12) & 0xf
                    tile = get_tile(tid)
                    if tile is None or pal >= len(pals): continue
                    qx = ox + (q % 2)*8; qy = oy + (q // 2)*8
                    for yy in range(8):
                        for xx in range(8):
                            sx = 7-xx if fx else xx
                            sy = 7-yy if fy else yy
                            ci = tile[sy][sx]
                            if ci == 0 and layer == 1: continue
                            if ci >= len(pals[pal]): continue
                            r, g, b = pals[pal][ci]
                            img[qy+yy][qx+xx] = (r, g, b, 255)
    rows = []
    for row in img:
        flat = []
        for (r, g, b, a) in row: flat += [r, g, b, a]
        rows.append(flat)
    out_png = f'/Users/vishaltandale/ProjectsDev/pokemon-living-world/public/interiors/{name}.png'
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    write_png_rgba(out_png, w*16, h*16, rows)
    return name, w, h, collision

MAPS = [
    ('center',       'pokemon_center',   'map_PokemonCenter_1F.bin',           15, 10),
    ('mart',         'mart',             'map_Mart.bin',                       11, 9),
    ('house',        'generic_building_1','map_House1.bin',                     11, 9),
    ('lab',          'lab',              'map_PalletTown_ProfessorOaksLab.bin',13, 14),
    ('pewter_gym',   'pewter_gym',       'map_PewterCity_Gym.bin',             13, 16),
    ('viridian_gym', 'viridian_gym',     'map_ViridianCity_Gym.bin',           20, 24),
]

manifest = {}
for (name, sec, mf, w, h) in MAPS:
    nm, ww, hh, coll = render_map(name, sec, mf, w, h)
    manifest[nm] = {'w': ww, 'h': hh, 'collision': coll}
    print(f'rendered {nm}: {ww}x{hh}')

out_json = '/Users/vishaltandale/ProjectsDev/pokemon-living-world/public/interiors/manifest.json'
json.dump(manifest, open(out_json, 'w'))
print('wrote', out_json)
