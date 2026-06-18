import Phaser from 'phaser';
import { world } from '../world/store';
import type { Building } from '../world/types';
import { styleFrames, TEMPLATES, ruinFrames } from './frlgTiles';
import { isInteriorId, buildingOfInterior, geomForBuilding, interiorMapId, INTERIOR_OF_BUILDING } from './interiors';

// Maps are GENERATED from world state, not baked. Terrain comes from a
// hand-authored base layer per map; buildings come from the building registry
// (so new construction appears, damage shows, etc). Rendering uses real
// FireRed metatiles (see frlgTiles.ts); the T.* ids below stay purely logical
// (collision, encounters, doors).

export const TILE = 16;
export const MAP_W = 25;
export const MAP_H = 20;

// logical tile ids
export const T = {
  GRASS: 0, PATH: 1, TREE: 2, WATER: 3, TALLGRASS: 4,
  WALL: 5, ROOF: 6, DOOR: 7, FLOWER: 8, ROCK: 9,
  RUIN: 10, ROOF_GYM: 11, ROOF_CENTER: 12, ROOF_MART: 13, ROOF_HIDEOUT: 14,
  PLAZA: 15, LEDGE: 16, BUSH: 17, IFLOOR: 18, IWALL: 19,
} as const;

const SOLID = new Set<number>([
  T.TREE, T.WATER, T.WALL, T.ROOF, T.ROCK, T.RUIN,
  T.ROOF_GYM, T.ROOF_CENTER, T.ROOF_MART, T.ROOF_HIDEOUT, T.LEDGE, T.BUSH, T.IWALL,
]);

// deterministic PRNG per map so terrain is stable across sessions
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hand-authored base layouts inspired by the real Gen-1 town structures.
// 25 cols x 20 rows. Legend: . grass  # tree  = sand path  + city plaza
// ~ water  , flower  " tall grass  ^ rock  _ ledge (hop down)  o round bush.
// Buildings are NOT in the layout — they stamp on top from the registry.
const LAYOUTS: Record<string, string[]> = {
  // Viridian City: plaza ring road, pond SW, gym NE of the crossing
  viridian: [
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
  // Route 1: tall grass fields, ledges, forest fingers
  route1: [
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
  // Pewter City: rocky northern city, mart fronting the main road
  pewter: [
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
};

const CHAR_TILE: Record<string, number> = {
  '.': T.GRASS, '#': T.TREE, '=': T.PATH, '~': T.WATER, ',': T.FLOWER,
  '"': T.TALLGRASS, '^': T.ROCK, '+': T.PLAZA, '_': T.LEDGE, 'o': T.BUSH,
};

export interface MapData {
  w: number; h: number;          // tile dimensions (towns are 25x20; interiors vary)
  originX: number; originY: number; // render offset to center smaller maps on the canvas
  tiles: number[][];             // logical tiles (collision / encounters / doors)
  frames: number[][] | null;     // atlas frame per cell (overworld), null for interiors
  interiorImage: string | null;  // texture key for an interior background, else null
  exits: { x: number; y: number; toMap: string; toX: number; toY: number }[];
}

// the overworld tile the player stands on just below a building's door
function buildingDoor(b: Building): { doorX: number; doorY: number } {
  const tpl = TEMPLATES[b.kind] ?? TEMPLATES.house;
  const rows = b.condition === 'ruined' ? ruinFrames(b.w, b.h) : tpl.rows.slice(-b.h);
  const doorX = Math.min(b.x + tpl.door, MAP_W - 2);
  const doorY = Math.min(b.y + Math.min(b.h, rows.length) - 1, MAP_H - 2);
  return { doorX, doorY };
}

export function buildMap(mapId: string): MapData {
  if (isInteriorId(mapId)) return buildInterior(mapId);
  // P3: runtime-generated locations (createLocation) live in world.mapLayouts;
  // hand-authored towns in LAYOUTS; unknown ids fall back to a route.
  const layout = LAYOUTS[mapId] ?? world.state.mapLayouts?.[mapId] ?? LAYOUTS.route1;
  const tiles: number[][] = layout.map(row => {
    const out: number[] = [];
    for (let x = 0; x < MAP_W; x++) out.push(CHAR_TILE[row[x] ?? '.'] ?? T.GRASS);
    return out;
  });

  // exits: viridian(top) <-> route1 <-> pewter (2-wide road spine)
  const spineX = 10;
  const exits: MapData['exits'] = [];
  const addExit = (x: number, y: number, toMap: string, toX: number, toY: number) => {
    tiles[y][x] = T.PATH;
    exits.push({ x, y, toMap, toX, toY });
  };
  if (mapId === 'viridian') {
    addExit(spineX, 0, 'route1', spineX, MAP_H - 2);
    addExit(spineX + 1, 0, 'route1', spineX + 1, MAP_H - 2);
  } else if (mapId === 'route1') {
    addExit(spineX, MAP_H - 1, 'viridian', spineX, 1);
    addExit(spineX + 1, MAP_H - 1, 'viridian', spineX + 1, 1);
    addExit(spineX, 0, 'pewter', spineX, MAP_H - 2);
    addExit(spineX + 1, 0, 'pewter', spineX + 1, MAP_H - 2);
  } else if (mapId === 'pewter') {
    addExit(spineX, MAP_H - 1, 'route1', spineX, 1);
    addExit(spineX + 1, MAP_H - 1, 'route1', spineX + 1, 1);
  }

  // P3: merge persisted connections (roads wireConnection laid) for this map, so
  // generated links are walkable and survive a reload.
  for (const c of world.state.connections ?? []) {
    if (c.fromMap !== mapId) continue;
    if (c.fromY >= 0 && c.fromY < MAP_H && c.fromX >= 0 && c.fromX < MAP_W) {
      addExit(c.fromX, c.fromY, c.toMap, c.toX, c.toY);
    }
  }

  // terrain frames first, then buildings stamp over them
  const frames = styleFrames(tiles, MAP_W, MAP_H, T);

  const buildings = Object.values(world.state.buildings).filter(b => b.map === mapId);
  for (const b of buildings) stampBuilding(tiles, frames, b);

  // re-style path/plaza cells once doors and stubs exist so they join up
  const restyled = styleFrames(tiles, MAP_W, MAP_H, T);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (tiles[y][x] === T.PATH || tiles[y][x] === T.PLAZA) frames[y][x] = restyled[y][x];
    }
  }

  // building doors warp INTO interiors (real FRLG interior maps)
  for (const b of buildings) {
    if (b.condition === 'ruined' || !INTERIOR_OF_BUILDING[b.id]) continue;
    const geom = geomForBuilding(b.id);
    if (!geom) continue;
    const { doorX, doorY } = buildingDoor(b);
    exits.push({ x: doorX, y: doorY, toMap: interiorMapId(b.id), toX: geom.entrance.x, toY: geom.entrance.y });
  }

  return { w: MAP_W, h: MAP_H, originX: 0, originY: 0, tiles, frames, interiorImage: null, exits };
}

function buildInterior(mapId: string): MapData {
  const bId = buildingOfInterior(mapId);
  const geom = geomForBuilding(bId);
  const b = world.state.buildings[bId];
  if (!geom || !b) {
    // safety fallback: empty room
    return { w: MAP_W, h: MAP_H, originX: 0, originY: 0, tiles: [], frames: null, interiorImage: null, exits: [] };
  }
  const { w, h } = geom;
  const tiles: number[][] = geom.collision.map(row =>
    Array.from(row, ch => (ch === '1' ? T.IWALL : T.IFLOOR)));
  // the doormat warps back outside, to the tile just below the building's door
  const { doorX, doorY } = buildingDoor(b);
  const outX = doorX, outY = Math.min(doorY + 1, MAP_H - 2);
  const exits = geom.exitTiles.map(t => ({ x: t.x, y: t.y, toMap: b.map, toX: outX, toY: outY }));
  return {
    w, h,
    // center maps that fit; for oversized maps anchor at 0 and let the camera follow
    originX: Math.max(0, Math.floor((MAP_W - w) / 2)),
    originY: Math.max(0, Math.floor((MAP_H - h) / 2)),
    tiles,
    frames: null,
    interiorImage: `interior_${geom.image}`,
    exits,
  };
}

function stampBuilding(tiles: number[][], frames: number[][], b: Building) {
  const tpl = TEMPLATES[b.kind] ?? TEMPLATES.house;
  const ruined = b.condition === 'ruined';
  const rows = ruined ? ruinFrames(b.w, b.h) : tpl.rows.slice(-b.h);
  for (let ry = 0; ry < Math.min(b.h, rows.length); ry++) {
    for (let rx = 0; rx < b.w; rx++) {
      const y = b.y + ry, x = b.x + rx;
      if (y >= MAP_H - 1 || x >= MAP_W - 1 || y < 0 || x < 0) continue;
      const src = rows[ry];
      frames[y][x] = rx < src.length ? src[rx] : src[src.length - 1];
      tiles[y][x] = ruined ? T.RUIN : T.WALL;
    }
  }
  // walkable doorway bottom row + path stub so it connects visually
  if (!ruined) {
    const { doorX, doorY } = buildingDoor(b);
    tiles[doorY][doorX] = T.DOOR;
    if (doorY + 1 < MAP_H - 1 && tiles[doorY + 1][doorX] === T.GRASS) {
      tiles[doorY + 1][doorX] = T.PLAZA;
    }
  }
}

export function isSolid(tiles: number[][], x: number, y: number, w = MAP_W, h = MAP_H): boolean {
  if (x < 0 || y < 0 || x >= w || y >= h) return true;
  return SOLID.has(tiles[y][x]);
}

// south-facing jump ledge: walking down onto it hops the player over
export function isLedge(tiles: number[][], x: number, y: number): boolean {
  if (x < 0 || y < 0 || y >= tiles.length || x >= (tiles[y]?.length ?? 0)) return false;
  return tiles[y][x] === T.LEDGE;
}

// ——— procedural tileset texture (fallback if the atlas fails to load) ———
export function generateTileset(scene: Phaser.Scene) {
  const count = 18;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);

  const draw = (i: number, fn: (ox: number) => void) => fn(i * TILE);

  const base = (ox: number, color: number) => { g.fillStyle(color); g.fillRect(ox, 0, TILE, TILE); };
  const speckle = (ox: number, color: number, n: number, rngSeed: number) => {
    const rng = mulberry32(rngSeed);
    g.fillStyle(color);
    for (let i = 0; i < n; i++) g.fillRect(ox + Math.floor(rng() * 14), Math.floor(rng() * 14), 2, 2);
  };

  draw(T.GRASS, ox => { base(ox, 0x4a8f3c); speckle(ox, 0x55a345, 6, 11); });
  draw(T.PATH, ox => { base(ox, 0xc9b287); speckle(ox, 0xb89f74, 5, 22); });
  draw(T.TREE, ox => {
    base(ox, 0x4a8f3c);
    g.fillStyle(0x2d5a24); g.fillCircle(ox + 8, 6, 6);
    g.fillStyle(0x3a7330); g.fillCircle(ox + 5, 8, 4); g.fillCircle(ox + 11, 8, 4);
    g.fillStyle(0x6b4a2f); g.fillRect(ox + 6, 11, 4, 5);
  });
  draw(T.WATER, ox => { base(ox, 0x3a6ea5); speckle(ox, 0x4a82bd, 5, 33); });
  draw(T.TALLGRASS, ox => {
    base(ox, 0x4a8f3c);
    g.fillStyle(0x2f7a28);
    for (let i = 0; i < 4; i++) g.fillTriangle(ox + 2 + i * 4, 14, ox + 4 + i * 4, 4, ox + 6 + i * 4, 14);
  });
  draw(T.WALL, ox => { base(ox, 0xb0a090); g.fillStyle(0x8d7d6d); g.fillRect(ox, 0, TILE, 3); g.fillRect(ox + 2, 6, 5, 4); g.fillRect(ox + 9, 6, 5, 4); });
  draw(T.DOOR, ox => { base(ox, 0xb0a090); g.fillStyle(0x5a3d28); g.fillRect(ox + 3, 2, 10, 14); g.fillStyle(0xd8c050); g.fillRect(ox + 10, 8, 2, 2); });
  draw(T.ROOF, ox => { base(ox, 0xa84a3a); g.fillStyle(0x933e30); g.fillRect(ox, 4, TILE, 2); g.fillRect(ox, 10, TILE, 2); });
  draw(T.FLOWER, ox => { base(ox, 0x4a8f3c); g.fillStyle(0xe85a8a); g.fillCircle(ox + 5, 5, 2); g.fillStyle(0xf0d048); g.fillCircle(ox + 11, 10, 2); });
  draw(T.ROCK, ox => { base(ox, 0x4a8f3c); g.fillStyle(0x8d8478); g.fillCircle(ox + 8, 9, 5); g.fillStyle(0xa49a8c); g.fillCircle(ox + 6, 7, 2); });
  draw(T.RUIN, ox => { base(ox, 0x6d6258); speckle(ox, 0x4a4239, 8, 44); g.fillStyle(0x3a342e); g.fillRect(ox + 4, 4, 3, 3); g.fillRect(ox + 10, 9, 3, 3); });
  draw(T.ROOF_GYM, ox => { base(ox, 0x4a6ea8); g.fillStyle(0x3e5e93); g.fillRect(ox, 4, TILE, 2); g.fillRect(ox, 10, TILE, 2); });
  draw(T.ROOF_CENTER, ox => { base(ox, 0xd86a7a); g.fillStyle(0xc05a6a); g.fillRect(ox, 4, TILE, 2); g.fillRect(ox, 10, TILE, 2); });
  draw(T.ROOF_MART, ox => { base(ox, 0x4a9ea0); g.fillStyle(0x3e8a8c); g.fillRect(ox, 4, TILE, 2); g.fillRect(ox, 10, TILE, 2); });
  draw(T.ROOF_HIDEOUT, ox => { base(ox, 0x55495e); g.fillStyle(0x453a4e); g.fillRect(ox, 4, TILE, 2); g.fillRect(ox, 10, TILE, 2); });
  draw(T.PLAZA, ox => { base(ox, 0xd8d8d0); speckle(ox, 0xc4c4ba, 5, 55); });
  draw(T.LEDGE, ox => { base(ox, 0x4a8f3c); g.fillStyle(0x8a6a4a); g.fillRect(ox, 6, TILE, 6); });
  draw(T.BUSH, ox => { base(ox, 0x4a8f3c); g.fillStyle(0x55b045); g.fillCircle(ox + 8, 8, 6); });

  g.generateTexture('tiles', count * TILE, TILE);
  g.destroy();
}

// procedural character sprites (player + 10 NPC palettes) — one texture each
export function generateSprites(scene: Phaser.Scene) {
  const palettes = [
    { body: 0xe04848, skin: 0xf0c8a0 }, // 0 player (red)
    { body: 0x8d7d3a, skin: 0xe8b890 }, // 1 Vance
    { body: 0xd8d8e8, skin: 0xf0c8a0 }, // 2 Arden (labcoat)
    { body: 0x48a0d8, skin: 0xf0d0b0 }, // 3 Mira
    { body: 0x7a5a3a, skin: 0xe0b088 }, // 4 Sal
    { body: 0x383844, skin: 0xd8b090 }, // 5 grunt
    { body: 0x4a8a4a, skin: 0xe8c098 }, // 6 ranger
    { body: 0xb05a9a, skin: 0xf0c8a8 }, // 7 Opal
    { body: 0x282830, skin: 0xc8a080 }, // 8 Dray
    { body: 0x9a8ab8, skin: 0xe8c0a0 }, // 9 Rosa
  ];
  palettes.forEach((p, i) => {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(p.body); g.fillRect(4, 7, 8, 7);            // body
    g.fillStyle(p.skin); g.fillCircle(8, 5, 4);              // head
    g.fillStyle(0x202020); g.fillRect(5, 14, 2, 2); g.fillRect(9, 14, 2, 2); // feet
    g.generateTexture(`char_${i}`, TILE, TILE);
    g.destroy();
  });
}
