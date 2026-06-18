// The trusted, deterministic structural ops — the ONLY way world geometry/
// topology changes. Each self-validates or fails atomically, so even a careless
// authored rule can never produce an illegal/unreachable world. The kernel
// invokes these via an injected StructuralOps interface (so kernel.ts stays
// decoupled from the renderer); production + the in-browser checks supply this
// implementation.
import type { WorldState, Building } from './types';
import type { StructuralOps } from './entity';
import { eid } from './entity';
import { nextUnit } from './rng';
import { baseTiles, buildingDoor, isSolid, MAP_W, MAP_H, T } from '../game/maps';

// deterministic draws over the persisted per-stream cursors
function rint(state: WorldState, stream: string, loIncl: number, hiExcl: number): number {
  return loIncl + Math.floor(nextUnit(state.rng, stream) * (hiExcl - loIncl));
}
function nid(state: WorldState, prefix: string): string {
  const n = (state.idSeq[prefix] ?? 0) + 1;
  state.idSeq[prefix] = n;
  return `${prefix}_${n}`;
}

// collision grid for a map = base terrain + existing buildings stamped solid,
// with each building's door cell left walkable (mirrors how the renderer stamps).
function collisionGrid(state: WorldState, mapId: string): number[][] {
  const tiles = baseTiles(mapId);
  for (const b of Object.values(state.buildings)) {
    if (b.map !== mapId || b.condition === 'ruined') continue;
    for (let ry = 0; ry < b.h; ry++) for (let rx = 0; rx < b.w; rx++) {
      const y = b.y + ry, x = b.x + rx;
      if (y >= 0 && x >= 0 && y < MAP_H && x < MAP_W) tiles[y][x] = T.WALL;
    }
    const { doorX, doorY } = buildingDoor(b);
    if (doorY >= 0 && doorY < MAP_H && doorX >= 0 && doorX < MAP_W) tiles[doorY][doorX] = T.DOOR;
  }
  return tiles;
}

// 4-connected flood over walkable tiles from a path seed (towns/generated maps
// always have a path spine). Returns the set of reachable "x,y" keys.
function reachableSet(grid: number[][]): Set<string> {
  let seed: [number, number] | null = null;
  for (let y = 0; y < MAP_H && !seed; y++) for (let x = 0; x < MAP_W; x++) if (grid[y][x] === T.PATH) { seed = [x, y]; break; }
  if (!seed) for (let y = 0; y < MAP_H && !seed; y++) for (let x = 0; x < MAP_W; x++) if (!isSolid(grid, x, y)) { seed = [x, y]; break; }
  const seen = new Set<string>();
  if (!seed) return seen;
  const q: [number, number][] = [seed];
  seen.add(`${seed[0]},${seed[1]}`);
  while (q.length) {
    const [x, y] = q.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H || seen.has(key) || isSolid(grid, nx, ny)) continue;
      seen.add(key); q.push([nx, ny]);
    }
  }
  return seen;
}

// GLOBAL reachability invariant: every building's door-approach must be reachable.
export function reachabilityOK(state: WorldState, mapId: string): boolean {
  const grid = collisionGrid(state, mapId);
  const set = reachableSet(grid);
  for (const b of Object.values(state.buildings)) {
    if (b.map !== mapId || b.condition === 'ruined') continue;
    const { doorX, doorY } = buildingDoor(b);
    const ay = Math.min(doorY + 1, MAP_H - 1);
    if (!set.has(`${doorX},${ay}`)) return false;     // door blocked / orphaned
  }
  return true;
}

function addBuildingEntity(state: WorldState, b: Building): void {
  state.entities[eid.bld(b.id)] = {
    id: eid.bld(b.id), type: 'location', tags: ['building', b.kind].sort(),
    attrs: { name: b.name, map: b.map, kind: b.kind, condition: b.condition, owner: b.owner ?? '' },
    magnitude: 0, relations: state.towns[b.map] ? [{ to: eid.town(b.map), rel: 'in', weight: 1 }] : [], thresholds: [],
  };
}

export const structuralOps: StructuralOps = {
  // place ONE building on a valid, non-overlapping, door-reachable spot, else fail.
  placeBuildingValidly(state, map, kind, owner, name) {
    const W = 4, H = 3;
    const existing = Object.values(state.buildings).filter(b => b.map === map);
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = 3 + rint(state, `place:${map}`, 0, MAP_W - W - 3);
      const y = 3 + rint(state, `place:${map}`, 0, MAP_H - H - 4);
      const clash = existing.some(b => x < b.x + b.w + 1 && x + W + 1 > b.x && y < b.y + b.h + 1 && y + H + 1 > b.y);
      if (clash) continue;
      const id = nid(state, `bld:${map}`);
      const b: Building = { id, kind: kind as Building['kind'], name: name.slice(0, 40), map, x, y, w: W, h: H, owner: owner || null, condition: 'new', builtOnDay: state.day };
      state.buildings[id] = b;
      if (reachabilityOK(state, map)) { addBuildingEntity(state, b); return true; }
      delete state.buildings[id];   // would orphan a door — revert and try elsewhere
    }
    return false;
  },

  // calve a new walkable map node, registered so buildMap renders it.
  createLocation(state, newMapId, _seedMap, biome, tags, name) {
    if (state.mapLayouts[newMapId]) return true;   // idempotent-by-id
    const L: string[] = [];
    for (let y = 0; y < MAP_H; y++) {
      let r = '';
      for (let x = 0; x < MAP_W; x++) r += (y === 0 || y === MAP_H - 1 || x === 0 || x === MAP_W - 1) ? '#' : (x === 12 ? '=' : '.');
      L.push(r);
    }
    state.mapLayouts[newMapId] = L;
    state.towns[newMapId] = { id: newMapId, name: name.slice(0, 40), prosperity: 10, rocketInfluence: 0, mood: biome.slice(0, 20) };
    state.entities[eid.town(newMapId)] = {
      id: eid.town(newMapId), type: 'location', tags: ['settlement', ...tags].filter((v, i, a) => a.indexOf(v) === i).sort(),
      attrs: { name: name.slice(0, 40), map: newMapId, biome: biome.slice(0, 20), prosperity: 10, rocketInfluence: 0, mood: biome.slice(0, 20) },
      magnitude: 0, relations: [], thresholds: [],
    };
    return true;
  },

  // lay a bidirectional walkable link; persisted so it survives reload.
  wireConnection(state, fromMap, fromX, fromY, toMap, toX, toY) {
    const has = (a: string, ax: number, ay: number, b: string, bx: number, by: number) =>
      state.connections.some(c => c.fromMap === a && c.fromX === ax && c.fromY === ay && c.toMap === b && c.toX === bx && c.toY === by);
    if (!has(fromMap, fromX, fromY, toMap, toX, toY)) state.connections.push({ fromMap, fromX, fromY, toMap, toX, toY });
    if (!has(toMap, toX, toY, fromMap, fromX, fromY)) state.connections.push({ fromMap: toMap, fromX: toX, fromY: toY, toMap: fromMap, toX: fromX, toY: fromY });
    return true;
  },
};
