#!/usr/bin/env python3
"""Preview v2 — authentic FRLG terrain. Mirrors the future TS logic exactly."""
from PIL import Image

ATLAS = Image.open('/Users/vishaltandale/ProjectsDev/pokemon-living-world/public/tiles/atlas.png').convert('RGBA')
OUT = '/tmp/frtiles/labeled'
MAP_W, MAP_H = 25, 20

def frame(i):
    x, y = (i % 16) * 16, (i // 16) * 16
    return ATLAS.crop((x, y, x + 16, y + 16))

GRASS, PATH, TREE, WATER, TALLGRASS, WALL, ROOF, DOOR, FLOWER, ROCK, RUIN, PLAZA, LEDGE, BUSH = range(14)
CHAR_TILE = {'.': GRASS, '#': TREE, '=': PATH, '~': WATER, ',': FLOWER, '"': TALLGRASS,
             '^': ROCK, '+': PLAZA, '_': LEDGE, 'o': BUSH}

LAYOUTS = {
  'viridian': [
    '#########################',
    '#.........==...........,#',
    '#..o,.....==......,.o...#',
    '#.........==............#',
    '#.........==............#',
    '#.........==............#',
    '#.........==............#',
    '#.....+...==..+.........#',
    '#.....+...==..+.....,...#',
    '#.....+...==..+.........#',
    '#..++++++++++++++++++++++',
    '#..++++++++++++++++++++++',
    '#.........==..........o.#',
    '#,........==............#',
    '#.........==....,.+,....#',
    '#....+....==..++++++....#',
    '#..~~~~~..==............#',
    '#..~~~~~..==......o.....#',
    '#..~~~~~..==............#',
    '#########################',
  ],
  'route1': [
    '#########################',
    '#"""""....==......""""".#',
    '#"""""....==......""""".#',
    '#"""""....==......""""".#',
    '#####.....==......#######',
    '#####.....==......#######',
    '#...,.....==.....,......#',
    '#..."""...==...."""""...#',
    '#..."""...==...."""""...#',
    '#..."""...==...."""""...#',
    '#_________==_________...#',
    '#.........==............#',
    '#..""""...==...."""",...#',
    '#..""""...==....""""....#',
    '#..""""...==....""""....#',
    '#.........==............#',
    '#.....,...==......,.....#',
    '#.""""....==....."""""..#',
    '#.""""....==....."""""..#',
    '#########################',
  ],
  'pewter': [
    '#########################',
    '#..^^.....==....^^..^^..#',
    '#..^^.....==............#',
    '#.........==............#',
    '#.........==............#',
    '#.........==............#',
    '#.........==............#',
    '#......+..==...+........#',
    '#......+..==...+........#',
    '#......+..==...+....,...#',
    '#..++++++++++++++++++++++',
    '#..++++++++++++++++++++++',
    '#.........==....,.......#',
    '#..,......==............#',
    '#.........==.....o......#',
    '#.........==............#',
    '#....+....==......,.....#',
    '#.........==............#',
    '#.........==......^^....#',
    '#########################',
  ],
}

BUILDINGS = {
  'viridian': [
    ('gym',    12, 3, 5, 4),
    ('center',  4, 4, 4, 3),
    ('lab',     4, 12, 4, 3),
    ('house',  16, 11, 4, 3),
  ],
  'route1': [],
  'pewter': [
    ('gym',    13, 3, 5, 4),
    ('center',  5, 4, 4, 3),
    ('mart',    9, 8, 3, 3),
    ('hideout', 3, 15, 4, 3),
  ],
}

F_GRASS = [1, 1, 1, 1, 1, 1, 8, 9, 16, 17]
F_TALL = 13
F_FLOWER = 4
F_TOPIARY = 646
F_SINGLE_TREE = 35

# autotile tables: outer edges + C, plus inner-corner notch tiles
PATH9 = {'NW': 211, 'N': 212, 'NE': 213, 'W': 219, 'C': 220, 'E': 221,
         'SW': 227, 'S': 228, 'SE': 229, 'iNW': 258, 'iNE': 259, 'iSW': 260, 'iSE': 261}
PLAZA9 = {'NW': 357, 'N': 358, 'NE': 359, 'W': 365, 'C': 366, 'E': 367,
          'SW': 373, 'S': 374, 'SE': 375, 'iNW': 405, 'iNE': 406, 'iSW': 413, 'iSE': 414}
POND9 = {'NW': 416, 'N': 417, 'NE': 418, 'W': 424, 'C': 425, 'E': 426,
         'SW': 432, 'S': 433, 'SE': 434, 'iNW': 425, 'iNE': 425, 'iSW': 425, 'iSE': 425}

HEDGE = {'L': 317, 'M': 318, 'R': 319}
LEDGE_T = {'L': 176, 'M': 135, 'R': 177}
ROCK_PAIR = (110, 111)

TEMPLATES = {
  'center':  {'rows': [[72, 73, 74, 75], [80, 81, 82, 83], [88, 89, 90, 91], [96, 97, 98, 99]], 'door': 2},
  'mart':    {'rows': [[40, 41, 43], [48, 49, 51], [65, 98, 99]], 'door': 1},
  'gym':     {'rows': [[685, 686, 686, 686, 687], [329, 330, 330, 330, 331],
                       [336, 337, 339, 340, 342], [344, 345, 347, 348, 350]], 'door': 2},
  'lab':     {'rows': [[68, 69, 70, 71], [84, 85, 86, 87], [92, 61, 94, 95]], 'door': 1},
  'house':   {'rows': [[640, 641, 643, 644], [656, 657, 659, 660], [677, 678, 665, 679]], 'door': 2},
  'hideout': {'rows': [[357, 358, 358, 359], [365, 366, 366, 367], [368, 61, 369, 368]], 'door': 1},
}
TEMPLATES['tower'] = TEMPLATES['lab']

def hash2(x, y):
    h = (x * 374761393 + y * 668265263) & 0xffffffff
    h = (h ^ (h >> 13)) * 1274126177 & 0xffffffff
    return (h ^ (h >> 16)) & 0xffffffff

def build_logical(map_id):
    layout = LAYOUTS[map_id]
    return [[CHAR_TILE.get(layout[y][x] if x < len(layout[y]) else '.', GRASS)
             for x in range(MAP_W)] for y in range(MAP_H)]

def edge_pick(tiles, x, y, kinds, tb):
    def is_k(xx, yy):
        if xx < 0 or yy < 0 or xx >= MAP_W or yy >= MAP_H:
            return True
        return tiles[yy][xx] in kinds
    n, s, w, e = is_k(x, y-1), is_k(x, y+1), is_k(x-1, y), is_k(x+1, y)
    if not n and not w and s and e: return tb['NW']
    if not n and not e and s and w: return tb['NE']
    if not s and not w and n and e: return tb['SW']
    if not s and not e and n and w: return tb['SE']
    if not n and s: return tb['N']
    if not s and n: return tb['S']
    if not w and e: return tb['W']
    if not e and w: return tb['E']
    if n and s and w and e:
        if not is_k(x-1, y-1): return tb['iNW']
        if not is_k(x+1, y-1): return tb['iNE']
        if not is_k(x-1, y+1): return tb['iSW']
        if not is_k(x+1, y+1): return tb['iSE']
    return tb['C']

def tree_frame(tiles, x, y):
    def is_t(xx, yy):
        if xx < 0 or yy < 0 or xx >= MAP_W or yy >= MAP_H:
            return True
        return tiles[yy][xx] == TREE
    up, down = is_t(x, y-1), is_t(x, y+1)
    left, right = is_t(x-1, y), is_t(x+1, y)
    if not up and not down:
        if not left and not right: return F_SINGLE_TREE
        if not left: return HEDGE['L']
        if not right: return HEDGE['R']
        return HEDGE['M']
    ty = y
    while ty > 0 and is_t(x, ty-1):
        ty -= 1
    rel = y - ty
    if rel == 0 and not up:
        return 14 if x % 2 == 0 else 15
    if not down:  # bottom of run
        if left and right: return 36 if x % 2 == 0 else 37
        if left: return 39
        if right: return 38
        return F_SINGLE_TREE
    return (30 if x % 2 == 0 else 31) if rel % 2 == 1 else (20 if x % 2 == 0 else 21)

def run_frame(tiles, x, y, kind, tb):
    left = x > 0 and tiles[y][x-1] == kind
    right = x < MAP_W - 1 and tiles[y][x+1] == kind
    if not left and not right: return tb['M']
    if not left: return tb['L']
    if not right: return tb['R']
    return tb['M']

def style(tiles, x, y):
    t = tiles[y][x]
    if t == GRASS: return F_GRASS[hash2(x, y) % len(F_GRASS)]
    if t == TALLGRASS: return F_TALL
    if t == FLOWER: return F_FLOWER
    if t == BUSH: return F_TOPIARY
    if t == PATH: return edge_pick(tiles, x, y, {PATH, PLAZA, DOOR}, PATH9)
    if t == PLAZA: return edge_pick(tiles, x, y, {PLAZA, PATH, DOOR}, PLAZA9)
    if t == WATER: return edge_pick(tiles, x, y, {WATER}, POND9)
    if t == TREE: return tree_frame(tiles, x, y)
    if t == LEDGE: return run_frame(tiles, x, y, LEDGE, LEDGE_T)
    if t == ROCK:
        left = x > 0 and tiles[y][x-1] == ROCK
        return ROCK_PAIR[1] if left else ROCK_PAIR[0]
    return F_GRASS[0]

def render(map_id, suffix=''):
    tiles = build_logical(map_id)
    frames = [[0]*MAP_W for _ in range(MAP_H)]
    for y in range(MAP_H):
        for x in range(MAP_W):
            frames[y][x] = style(tiles, x, y)
    for (kind, bx, by, bw, bh) in BUILDINGS[map_id]:
        tpl = TEMPLATES[kind]
        rows = tpl['rows'][-bh:]
        for ry in range(min(bh, len(rows))):
            for rx in range(bw):
                fy, fx = by + ry, bx + rx
                if fy >= MAP_H - 1 or fx >= MAP_W - 1: continue
                src = rows[ry]
                frames[fy][fx] = src[rx] if rx < len(src) else src[-1]
                tiles[fy][fx] = WALL
        dx, dy = bx + tpl['door'], by + min(bh, len(rows)) - 1
        if dx < MAP_W - 1 and dy < MAP_H - 1:
            tiles[dy][dx] = DOOR
    img = Image.new('RGBA', (MAP_W * 16, MAP_H * 16))
    for y in range(MAP_H):
        for x in range(MAP_W):
            img.paste(frame(frames[y][x]), (x * 16, y * 16))
    img = img.resize((MAP_W * 32, MAP_H * 32), Image.NEAREST)
    p = f'{OUT}/preview_{map_id}{suffix}.png'
    img.save(p)
    print(p)

for m in ['viridian', 'route1', 'pewter']:
    render(m, '_v2')
