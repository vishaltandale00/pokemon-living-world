import Phaser from 'phaser';

// Real FireRed/LeafGreen terrain rendering. public/tiles/atlas.png is a
// combined metatile atlas decoded from pret/pokefirered (General primary
// tileset ids 0-639, ViridianCity secondary ids 640-735), 16 frames per row,
// 16x16 px each — so spritesheet frame index == metatile id.
//
// All ids below were verified against the actual game maps (the real
// ViridianCity/Route1 map.bin blockdata renders correctly with this atlas).

export const FRLG_ATLAS_KEY = 'frlg_tiles';

export function preloadFrlgTiles(scene: Phaser.Scene) {
  scene.load.spritesheet(FRLG_ATLAS_KEY, '/tiles/atlas.png', { frameWidth: 16, frameHeight: 16 });
}

export function frlgReady(scene: Phaser.Scene): boolean {
  return scene.textures.exists(FRLG_ATLAS_KEY);
}

// ——— terrain frame tables ———

// plain ground variants (METATILE_General_Plain_Mowed family); weighted to 1
const GRASS_VARIANTS = [1, 1, 1, 1, 1, 1, 8, 9, 16, 17];
export const F = {
  tallGrass: 13,      // METATILE_General_Plain_Grass — wild encounter grass
  flowers: 4,
  topiary: 646,       // round bush (Viridian secondary)
  singleTree: 35,     // whole small tree in one tile (canopy + trunk, grass corners)
} as const;

// 3x3 edge sets + inner-corner notch tiles, orientation verified from real maps
type Edge9 = Record<string, number>;
const PATH9: Edge9 = {
  NW: 211, N: 212, NE: 213, W: 219, C: 220, E: 221, SW: 227, S: 228, SE: 229,
  iNW: 258, iNE: 259, iSW: 260, iSE: 261,
};
const PLAZA9: Edge9 = {
  NW: 357, N: 358, NE: 359, W: 365, C: 366, E: 367, SW: 373, S: 374, SE: 375,
  iNW: 405, iNE: 406, iSW: 413, iSE: 414,
};
const POND9: Edge9 = {
  NW: 416, N: 417, NE: 418, W: 424, C: 425, E: 426, SW: 432, S: 433, SE: 434,
  iNW: 425, iNE: 425, iSW: 425, iSE: 425,
};

const HEDGE = { L: 317, M: 318, R: 319 };
const LEDGE = { L: 176, M: 135, R: 177 };
const ROCK_PAIR = [110, 111];

// tree wall tiles (light FRLG trees): tops 14/15, interior 30/31 + 20/21,
// bottoms-with-trunks 36/37 (run ends 38/39) — the pattern Route 1 itself uses
const TREE = { topA: 14, topB: 15, upA: 30, upB: 31, midA: 20, midB: 21, botA: 36, botB: 37, botL: 38, botR: 39 };

// ruined buildings render as churned dirt mounds
const RUIN_TOP = 654;
const RUIN_FILL = 661;

// ——— building facade templates (rows top->bottom, real FRLG pieces) ———
// door: column of the walkable doorway in the bottom row. When a building is
// shorter than the template, roof rows are dropped from the top; when wider,
// the last column repeats.
export interface BuildingTemplate { rows: number[][]; door: number }

export const TEMPLATES: Record<string, BuildingTemplate> = {
  center: {
    rows: [
      [72, 73, 74, 75],     // red tiled roof
      [80, 81, 82, 83],     // roof eave (emblem notch at 82)
      [88, 89, 90, 91],     // wall: windows + pokeball emblem
      [96, 97, 98, 99],     // P.C sign + sliding glass door
    ],
    door: 2,
  },
  mart: {
    rows: [
      [40, 41, 43],         // blue dome roof
      [48, 49, 51],         // dome wall
      [64, 65, 98],         // MA|RT sign + sliding glass door
    ],
    door: 2,
  },
  gym: {
    rows: [
      [685, 686, 686, 686, 687], // tan slatted roof (Viridian gym top)
      [329, 330, 330, 330, 331], // roof bottom, navy eave
      [336, 337, 339, 340, 342], // facade: GYM plaque top + gold pokeball band
      [344, 345, 347, 348, 350], // GYM letters + blue double door
    ],
    door: 2,
  },
  lab: {
    rows: [
      [68, 69, 70, 71],     // tall gray panel roof
      [84, 85, 86, 87],     // navy clerestory band
      [92, 93, 61, 95],     // brick wall + wooden door
    ],
    door: 2,
  },
  house: {
    rows: [
      [640, 641, 643, 644], // green roof top + dormer
      [656, 657, 659, 660], // green roof bottom + dormer base
      [677, 678, 665, 679], // windows + yellow slatted door
    ],
    door: 2,
  },
  hideout: {
    rows: [
      [357, 358, 358, 359], // flat concrete pad roof
      [365, 366, 366, 367],
      [368, 369, 61, 368],  // crate/girder walls + plank door
    ],
    door: 2,
  },
};
TEMPLATES.tower = TEMPLATES.lab;

export function ruinFrames(w: number, h: number): number[][] {
  const rows: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row: number[] = [];
    for (let x = 0; x < w; x++) row.push(y === 0 ? RUIN_TOP : RUIN_FILL);
    rows.push(row);
  }
  return rows;
}

// ——— deterministic per-cell hash for grass variation ———
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// ——— frame selection (logical tile grid -> atlas frames) ———
// Logical tile ids are imported loosely to avoid a circular dep with maps.ts.
export interface StyleTiles {
  GRASS: number; PATH: number; TREE: number; WATER: number; TALLGRASS: number;
  FLOWER: number; ROCK: number; PLAZA: number; LEDGE: number; BUSH: number; DOOR: number;
}

export function styleFrames(tiles: number[][], W: number, H: number, T: StyleTiles): number[][] {
  const at = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= W || y >= H) return -1;
    return tiles[y][x];
  };
  const inFam = (x: number, y: number, fam: Set<number>): boolean => {
    const t = at(x, y);
    return t === -1 ? true : fam.has(t); // off-map joins any family (map edges stay clean)
  };

  const pathFam = new Set([T.PATH, T.PLAZA, T.DOOR]);
  const plazaFam = new Set([T.PLAZA, T.PATH, T.DOOR]);
  const waterFam = new Set([T.WATER]);

  const edgePick = (x: number, y: number, fam: Set<number>, tb: Edge9): number => {
    const n = inFam(x, y - 1, fam), s = inFam(x, y + 1, fam);
    const w = inFam(x - 1, y, fam), e = inFam(x + 1, y, fam);
    if (!n && !w && s && e) return tb.NW;
    if (!n && !e && s && w) return tb.NE;
    if (!s && !w && n && e) return tb.SW;
    if (!s && !e && n && w) return tb.SE;
    if (!n && s) return tb.N;
    if (!s && n) return tb.S;
    if (!w && e) return tb.W;
    if (!e && w) return tb.E;
    if (n && s && w && e) {
      if (!inFam(x - 1, y - 1, fam)) return tb.iNW;
      if (!inFam(x + 1, y - 1, fam)) return tb.iNE;
      if (!inFam(x - 1, y + 1, fam)) return tb.iSW;
      if (!inFam(x + 1, y + 1, fam)) return tb.iSE;
    }
    return tb.C;
  };

  const isTree = (x: number, y: number): boolean => at(x, y) === T.TREE || at(x, y) === -1;

  const treeFrame = (x: number, y: number): number => {
    const up = isTree(x, y - 1), down = isTree(x, y + 1);
    const left = isTree(x - 1, y), right = isTree(x + 1, y);
    if (!up && !down) {
      // single-height run: hedge; isolated cell: whole small tree
      if (!left && !right) return F.singleTree;
      if (!left) return HEDGE.L;
      if (!right) return HEDGE.R;
      return HEDGE.M;
    }
    // phase tree pairs from the start of this row's run so apexes pair up
    let sx = x;
    while (sx > 0 && isTree(sx - 1, y)) sx--;
    const px = (x - sx) % 2; // 0 = left half of a tree, 1 = right half
    let ty = y;
    while (ty > 0 && isTree(x, ty - 1)) ty--;
    const rel = y - ty;
    if (rel === 0 && !up) return px === 0 ? TREE.topA : TREE.topB;
    if (!down) {
      if (left && right) return px === 0 ? TREE.botA : TREE.botB;
      if (left) return TREE.botR;
      if (right) return TREE.botL;
      return F.singleTree;
    }
    return rel % 2 === 1
      ? (px === 0 ? TREE.upA : TREE.upB)
      : (px === 0 ? TREE.midA : TREE.midB);
  };

  const runFrame = (x: number, y: number, kind: number, tb: { L: number; M: number; R: number }): number => {
    const left = at(x - 1, y) === kind, right = at(x + 1, y) === kind;
    if (!left && right) return tb.L;
    if (left && !right) return tb.R;
    return tb.M;
  };

  const out: number[][] = [];
  for (let y = 0; y < H; y++) {
    const row: number[] = [];
    for (let x = 0; x < W; x++) {
      const t = tiles[y][x];
      let f: number;
      switch (t) {
        case T.GRASS: f = GRASS_VARIANTS[hash2(x, y) % GRASS_VARIANTS.length]; break;
        case T.TALLGRASS: f = F.tallGrass; break;
        case T.FLOWER: f = F.flowers; break;
        case T.BUSH: f = F.topiary; break;
        case T.PATH: f = edgePick(x, y, pathFam, PATH9); break;
        case T.PLAZA: f = edgePick(x, y, plazaFam, PLAZA9); break;
        case T.WATER: f = edgePick(x, y, waterFam, POND9); break;
        case T.TREE: f = treeFrame(x, y); break;
        case T.LEDGE: f = runFrame(x, y, T.LEDGE, LEDGE); break;
        case T.ROCK: f = at(x - 1, y) === T.ROCK ? ROCK_PAIR[1] : ROCK_PAIR[0]; break;
        default: f = GRASS_VARIANTS[0];
      }
      row.push(f);
    }
    out.push(row);
  }
  return out;
}
