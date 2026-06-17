#!/usr/bin/env python3
"""Decode pret/pokefirered tileset data into a metatile atlas PNG.

- tiles.png: 4-bit colormap PNG, grayscale ramp; pixel value = palette index
  (index = (255 - R) / 17, since PLTE is 255,238,...,0)
- palettes/NN.pal: JASC-PAL, 16 colors each
- metatiles.bin: 8 u16 per metatile (4 bottom-layer + 4 top-layer quadrant tiles)
  u16 layout: tileId(0..9) | flipX(10) | flipY(11) | palette(12..15)
- Primary tileset owns tile ids 0..639 and palettes 0..6.
  Secondary owns ids 640+ and palettes 7..12.

Output: atlas.png (16 metatiles per row, 16x16 px each) for primary+secondary,
plus an HTML index page for eyeballing metatile ids.
"""
import struct, zlib, sys, os

def read_png_indexed(path):
    data = open(path, 'rb').read()
    pos = 8
    w = h = bitdepth = None
    idat = b''
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos+4])[0]
        typ = data[pos+4:pos+8].decode()
        chunk = data[pos+8:pos+8+ln]
        if typ == 'IHDR':
            w, h, bitdepth, ctype = struct.unpack('>IIBB', chunk[:10])
            assert ctype == 3, 'expected indexed PNG'
        elif typ == 'IDAT':
            idat += chunk
        pos += 12 + ln
    raw = zlib.decompress(idat)
    # unfilter
    if bitdepth == 4:
        rowbytes = (w * 4 + 7) // 8
    elif bitdepth == 8:
        rowbytes = w
    else:
        raise SystemExit(f'unsupported bitdepth {bitdepth}')
    out = []
    prev = bytearray(rowbytes)
    p = 0
    for y in range(h):
        f = raw[p]; p += 1
        row = bytearray(raw[p:p+rowbytes]); p += rowbytes
        if f == 1:
            for i in range(rowbytes):
                row[i] = (row[i] + (row[i-1] if i else 0)) & 0xff
        elif f == 2:
            for i in range(rowbytes):
                row[i] = (row[i] + prev[i]) & 0xff
        elif f == 3:
            for i in range(rowbytes):
                a = row[i-1] if i else 0
                row[i] = (row[i] + ((a + prev[i]) >> 1)) & 0xff
        elif f == 4:
            for i in range(rowbytes):
                a = row[i-1] if i else 0
                b = prev[i]
                c = prev[i-1] if i else 0
                pa, pb, pc = abs(b-c), abs(a-c), abs(a+b-2*c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                row[i] = (row[i] + pr) & 0xff
        prev = row
        # expand to per-pixel indices
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
    assert lines[0] == 'JASC-PAL'
    n = int(lines[2])
    return [tuple(map(int, lines[3+i].split())) for i in range(n)]

def tiles_from_indexed(w, h, px):
    """Cut into 8x8 tiles, row-major, 16 tiles per row."""
    tiles = []
    for ty in range(h // 8):
        for tx in range(w // 8):
            t = [[px[ty*8+y][tx*8+x] for x in range(8)] for y in range(8)]
            tiles.append(t)
    return tiles

def write_png_rgba(path, w, h, rgba_rows):
    def chunk(typ, data):
        c = struct.pack('>I', len(data)) + typ + data
        return c + struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff)
    raw = b''.join(b'\x00' + bytes(row) for row in rgba_rows)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    open(path, 'wb').write(png)

def main():
    root = '/tmp/frtiles'
    pw, ph, ppx = read_png_indexed(f'{root}/tiles.png')
    sw, sh, spx = read_png_indexed(f'{root}/sec/tiles.png')
    ptiles = tiles_from_indexed(pw, ph, ppx)
    stiles = tiles_from_indexed(sw, sh, spx)
    NUM_PRIMARY_TILES = 640
    # palettes: primary 00-06 from primary dir, 07-12 from secondary dir
    pals = []
    for i in range(13):
        n = f'{i:02d}'
        path = f'{root}/{n}.pal' if i <= 6 else f'{root}/sec/{n}.pal'
        pals.append(read_pal(path))

    def get_tile(tid):
        if tid < NUM_PRIMARY_TILES:
            return ptiles[tid] if tid < len(ptiles) else None
        sid = tid - NUM_PRIMARY_TILES
        return stiles[sid] if sid < len(stiles) else None

    def compose(metatiles_bin, count, out_path):
        mt = open(metatiles_bin, 'rb').read()
        n = min(count, len(mt) // 16)
        cols = 16
        rows = (n + cols - 1) // cols
        W, H = cols * 16, rows * 16
        img = [[(0,0,0,0)] * W for _ in range(H)]
        for m in range(n):
            base_x = (m % cols) * 16
            base_y = (m // cols) * 16
            for layer in range(2):       # 0 = bottom, 1 = top
                for q in range(4):       # TL TR BL BR
                    v = struct.unpack_from('<H', mt, m*16 + layer*8 + q*2)[0]
                    tid = v & 0x3ff
                    fx, fy = bool(v & 0x400), bool(v & 0x800)
                    pal = (v >> 12) & 0xf
                    tile = get_tile(tid)
                    if tile is None or pal >= len(pals):
                        continue
                    ox = base_x + (q % 2) * 8
                    oy = base_y + (q // 2) * 8
                    for y in range(8):
                        for x in range(8):
                            sx_ = 7 - x if fx else x
                            sy_ = 7 - y if fy else y
                            ci = tile[sy_][sx_]
                            if ci == 0 and layer == 1:
                                continue  # top layer index 0 = transparent
                            r, g, b = pals[pal][ci]
                            img[oy+y][ox+x] = (r, g, b, 255)
        rows_flat = []
        for row in img:
            flat = []
            for (r, g, b, a) in row:
                flat += [r, g, b, a]
            rows_flat.append(flat)
        write_png_rgba(out_path, W, H, rows_flat)
        print(f'{out_path}: {n} metatiles, {W}x{H}')

    compose(f'{root}/metatiles.bin', 640, f'{root}/primary_atlas.png')
    compose(f'{root}/sec/metatiles.bin', 256, f'{root}/secondary_atlas.png')

if __name__ == '__main__':
    main()
