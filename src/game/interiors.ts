import Phaser from 'phaser';

// Building interiors: real FRLG interior maps pre-rendered to PNGs
// (public/interiors/*.png, see tools/build_interiors.py). Each interior is a
// flat background image + a collision grid + an entrance/exit warp. NPCs that
// live inside (nurse, clerk, gym leader, Oak) have their map set to the
// interior id `int:<buildingId>` in the seed, so the existing render/interact
// code handles them with no changes.

export interface InteriorGeom {
  image: string;          // texture key / file under public/interiors/<image>.png
  w: number; h: number;   // tile dims
  collision: string[];    // '0'/'1' per tile, one string per row
  entrance: { x: number; y: number };  // where the player appears (interior-local)
  exitTiles: { x: number; y: number }[]; // doormat tiles → warp back outside
}

// geometry keyed by interior IMAGE (multiple buildings can share one, e.g. centers)
export const INTERIOR_GEOM: Record<string, InteriorGeom> = {
  center: {
    image: 'center', w: 15, h: 10, entrance: { x: 7, y: 7 },
    exitTiles: [{ x: 6, y: 8 }, { x: 7, y: 8 }, { x: 8, y: 8 }],
    collision: ['101111111111111', '111111111111111', '000011100110000', '000011111110000', '000000000000000', '000000000000000', '100000000001100', '000000000001100', '000000000000000', '111111111111111'],
  },
  mart: {
    image: 'mart', w: 11, h: 9, entrance: { x: 4, y: 6 },
    exitTiles: [{ x: 3, y: 7 }, { x: 4, y: 7 }, { x: 5, y: 7 }],
    collision: ['11111111111', '11111111111', '11010000001', '00010000000', '11110001101', '00000001101', '01100001101', '00000000000', '11111111111'],
  },
  house: {
    image: 'house', w: 11, h: 9, entrance: { x: 4, y: 6 },
    exitTiles: [{ x: 3, y: 7 }, { x: 4, y: 7 }, { x: 5, y: 7 }],
    collision: ['11111111111', '11111111111', '00000000000', '00000000000', '00000110000', '00000110000', '00000000000', '10000000001', '11111111111'],
  },
  lab: {
    image: 'lab', w: 13, h: 14, entrance: { x: 6, y: 11 },
    exitTiles: [{ x: 5, y: 12 }, { x: 6, y: 12 }, { x: 7, y: 12 }],
    collision: ['1111111111111', '1111111111111', '0000000000000', '1000000000000', '1110000011100', '0110000000000', '0000000000000', '0000000000000', '1111100011111', '0000000000000', '0000000000000', '0000000000000', '1000000000001', '1111111111111'],
  },
  pewter_gym: {
    image: 'pewter_gym', w: 13, h: 16, entrance: { x: 6, y: 13 },
    exitTiles: [{ x: 5, y: 14 }, { x: 6, y: 14 }, { x: 7, y: 14 }],
    collision: ['1111111111111', '1111000001111', '1111111111111', '1000010100001', '1000000000001', '1000100010001', '1000000000001', '1001010101001', '1100000000011', '1000100010001', '1100000000011', '1000000000001', '1000100010001', '1000000000001', '1000000000001', '1111111111111'],
  },
  viridian_gym: {
    image: 'viridian_gym', w: 20, h: 24, entrance: { x: 17, y: 21 },
    exitTiles: [{ x: 16, y: 22 }, { x: 17, y: 22 }, { x: 18, y: 22 }],
    collision: ['11111111111111111111', '11111111111111111111', '10001000000000000000', '10001000000000000000', '10001110110111111100', '10001110110111111100', '10000000100100000100', '10000001110000000100', '11111101111111100100', '11111101011111100100', '00000101000000000100', '00000101000000110100', '00110101000000110100', '00110101000000010100', '00110001000000010100', '00110111111111000000', '00110111111111000000', '00110000000000000000', '00110000000000000000', '00111111111111000000', '00111111111111010001', '00000000000000000000', '00000000000000000000', '11111111111111111111'],
  },
};

// which interior image each building opens into (omitted buildings are not enterable)
export const INTERIOR_OF_BUILDING: Record<string, string> = {
  viridian_gym: 'viridian_gym',
  pewter_gym: 'pewter_gym',
  viridian_center: 'center',
  pewter_center: 'center',
  viridian_lab: 'lab',
  viridian_inn: 'house',
  pewter_mart: 'mart',
};

export function interiorMapId(buildingId: string): string { return `int:${buildingId}`; }
export function isInteriorId(mapId: string): boolean { return mapId.startsWith('int:'); }
export function buildingOfInterior(mapId: string): string { return mapId.slice(4); }

export function geomForBuilding(buildingId: string): InteriorGeom | null {
  const img = INTERIOR_OF_BUILDING[buildingId];
  return img ? INTERIOR_GEOM[img] : null;
}

// Preload every interior background image.
export function preloadInteriors(scene: Phaser.Scene) {
  const seen = new Set<string>();
  for (const g of Object.values(INTERIOR_GEOM)) {
    if (seen.has(g.image)) continue;
    seen.add(g.image);
    if (!scene.textures.exists(`interior_${g.image}`)) {
      scene.load.image(`interior_${g.image}`, `/interiors/${g.image}.png`);
    }
  }
}
