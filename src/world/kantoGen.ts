// KANTO GENERATOR — turns the canonical graph (kanto.ts) into a walkable world
// at seed time: ASCII map layouts, bidirectional connections, town registry
// entries, buildings, gym-leader NPCs and gym slots. Phaser-free (emits ASCII
// the renderer's CHAR_TILE understands). Existing hand-authored maps are skipped
// (their content is preserved); only edges touching them are wired.
//
// Walkability invariant: every map carves a full '+' path network (vertical col
// HX, horizontal row HY); all inter-map warps sit at edge centers (HX or HY), so
// they always connect. Verified by BFS in the boot check.
import type { WorldState, NPC, Building, TownState, RoleSlot, RoleId } from './types';
import { makeMonster } from './monsters';
import { PLACES, EDGES, GYM_NPC, type KantoPlace, type Dir } from './kanto';

const W = 25, H = 20;
const HX = 10, HY = 10;   // hub col/row — col 10 matches the existing maps' spine

const opp = (d: Dir): Dir => (d === 'n' ? 's' : d === 's' ? 'n' : d === 'e' ? 'w' : 'e');
// the warp cell ON an edge, and the inner cell you arrive at from that edge
const edgeCell = (d: Dir): [number, number] => d === 'n' ? [HX, 0] : d === 's' ? [HX, H - 1] : d === 'e' ? [W - 1, HY] : [0, HY];
const innerCell = (d: Dir): [number, number] => d === 'n' ? [HX, 1] : d === 's' ? [HX, H - 2] : d === 'e' ? [W - 2, HY] : [1, HY];

// which edge-directions a place has a warp on (for nicer borders)
function dirsFor(id: string): Set<Dir> {
  const s = new Set<Dir>();
  for (const e of EDGES) { if (e.from === id) s.add(e.fromDir); if (e.to === id) s.add(opp(e.fromDir)); }
  return s;
}

// ——— layout generation ———
function genLayout(place: KantoPlace, dirs: Set<Dir>): { rows: string[]; buildingPlots: Array<{ x: number; y: number }> } {
  const base = place.biome === 'cave' ? '^' : place.biome === 'water' ? '~' : place.biome === 'forest' ? '#' : '.';
  const g: string[][] = Array.from({ length: H }, () => Array.from({ length: W }, () => base));
  const land = place.biome !== 'cave' && place.biome !== 'water';
  if (land) { for (let x = 0; x < W; x++) { g[0][x] = '#'; g[H - 1][x] = '#'; } for (let y = 0; y < H; y++) { g[y][0] = '#'; g[y][W - 1] = '#'; } }

  // the '+' spine — guarantees every edge-center warp is mutually reachable
  for (let y = 1; y < H - 1; y++) g[y][HX] = '=';
  for (let x = 1; x < W - 1; x++) g[HY][x] = '=';

  // biome decoration (never on the spine)
  if (place.biome === 'route') {
    for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) if (g[y][x] === '.' && (x * 3 + y * 7) % 11 === 0) g[y][x] = '"';
    for (let x = 3; x < W - 3; x++) if (x !== HX && (x % 6) === 2) g[7][x] = '_';   // a ledge line
  } else if (place.biome === 'forest') {
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (g[y][x] === '#' && (g[y][HX] === '=' || g[HY][x] === '=' || (Math.abs(x - HX) <= 2 && Math.abs(y - HY) <= 2))) g[y][x] = '"';
  } else if (place.biome === 'cave') {
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (g[y][x] === '^' && (Math.abs(x - HX) <= 1 || Math.abs(y - HY) <= 1)) g[y][x] = '=';
  } else if (place.biome === 'water') {
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (g[y][x] === '~' && (x === HX || y === HY)) g[y][x] = '=';   // a bridge
  }

  // town/city/plateau: a secondary street (row 6) for building fronts + a plaza
  const plots: Array<{ x: number; y: number }> = [];
  if (place.biome === 'town' || place.biome === 'city' || place.biome === 'plateau') {
    for (let x = 1; x < W - 1; x++) g[6][x] = '=';                 // upper street
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) g[HY + dy][HX + dx] = '+';  // plaza
    // building plots in the top row (doors face the row-6 street)
    for (const x of [2, 8, 16, 20]) plots.push({ x, y: 3 });
  }
  return { rows: g.map(r => r.join('')), buildingPlots: plots };
}

// ——— main ———
export function generateKanto(state: WorldState): void {
  const byId = new Map(PLACES.map(p => [p.id, p]));

  // 1) connections for EVERY edge (existing maps included)
  for (const e of EDGES) {
    const fc = edgeCell(e.fromDir), ti = innerCell(opp(e.fromDir));
    const tc = edgeCell(opp(e.fromDir)), fi = innerCell(e.fromDir);
    state.connections.push({ fromMap: e.from, fromX: fc[0], fromY: fc[1], toMap: e.to, toX: ti[0], toY: ti[1] });
    state.connections.push({ fromMap: e.to, fromX: tc[0], fromY: tc[1], toMap: e.from, toX: fi[0], toY: fi[1] });
  }

  // 2) generate every NON-existing place
  for (const place of PLACES) {
    if (place.existing) continue;
    const dirs = dirsFor(place.id);
    const { rows, buildingPlots } = genLayout(place, dirs);
    state.mapLayouts[place.id] = rows;
    state.towns[place.id] = townState(place);

    // buildings (cap to the available plots)
    const kinds = (place.buildings ?? []).slice(0, buildingPlots.length);
    kinds.forEach((kind, i) => {
      const plot = buildingPlots[i];
      state.buildings[`${place.id}_${kind}`] = {
        id: `${place.id}_${kind}`, kind, name: buildingName(place, kind), map: place.id,
        x: plot.x, y: plot.y, w: 4, h: 3, owner: 'townsfolk', condition: 'normal', builtOnDay: 0,
      };
    });
    const gymBld = state.buildings[`${place.id}_gym`];

    // gym leader + slot (placed on the overworld in front of the gym so they're battleable)
    if (place.gym && GYM_NPC[place.gym.leader]) {
      const meta = GYM_NPC[place.gym.leader];
      const fx = gymBld ? Math.min(gymBld.x + 1, W - 2) : HX;
      state.npcs[place.gym.leader] = {
        id: place.gym.leader, name: place.gym.name, sprite: meta.sprite, faction: 'league',
        role: 'gym_leader' as RoleId, town: place.id, x: fx, y: 7, map: place.id,
        personality: meta.personality, defeated: false, attitude: 0,
        party: meta.party.map(([sp, lv]) => makeMonster(sp, lv)),
      };
      state.slots[place.gym.slotId] = {
        id: place.gym.slotId, role: 'gym_leader' as RoleId, title: `${place.name} Gym Leader`,
        holder: place.gym.leader, town: place.id,
        requires: { defeatHolder: true, badges: 1, minRep: { league: 10 } },
      } as RoleSlot;
    }
  }
}

function townState(p: KantoPlace): TownState {
  const mood = p.biome === 'cave' ? 'dim' : p.biome === 'forest' ? 'wild' : p.biome === 'water' ? 'breezy' : 'lively';
  return { id: p.id, name: p.name, prosperity: 50, rocketInfluence: 0, mood };
}

function buildingName(p: KantoPlace, kind: Building['kind']): string {
  switch (kind) {
    case 'center': return 'Pokémon Center';
    case 'mart': return 'Poké Mart';
    case 'gym': return `${p.name} Gym`;
    case 'lab': return p.id === 'pallet' ? "Oak's Lab" : 'Laboratory';
    case 'tower': return p.id === 'lavender' ? 'Pokémon Tower' : 'Silph Co.';
    default: return 'House';
  }
}

// the canonical place blurbs, for the first-visit banner / place label
export function placeBlurb(mapId: string): string | null {
  return PLACES.find(p => p.id === mapId)?.blurb ?? null;
}
export function placeName(mapId: string): string | null {
  return PLACES.find(p => p.id === mapId)?.name ?? null;
}
