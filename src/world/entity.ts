// The Entity substrate — the kernel's source of truth.
//
// Every game object (town, building, npc, slot, faction, the player) is one
// open Entity. The closed predicate/effect/structural-op vocabulary operates on
// Entities; the LLM authors fiction OVER them but never touches their fields
// directly. magnitude is the single velocity-capped accretion channel (the P2
// tick is the only thing that moves it).
//
// P1a (this step): entities are DERIVED from the existing typed structs at
// seed/load time, so the structs stay the source of truth and nothing can
// desync — the substrate simply exists and is persisted. P1b/P2 invert the
// dependency: the tick writes Entities and a projector updates the struct fields
// the renderer reads.
//
// Serialization is canonical for determinism: `tags` is a SORTED string[] (never
// a Set), `attrs` a plain record — both JSON round-trip byte-identically.
import type { WorldState, FactionId, Reputation } from './types';

export interface Edge {
  to: string;       // target entity id
  rel: string;      // OPEN relation name (e.g. 'in', 'memberOf', 'heldBy', 'controlledBy')
  weight: number;
}

// ——— the closed kernel DSL (authored bundles are written PURELY in this) ———
// Co-located with Entity because Threshold lives on the entity. The kernel
// (world/kernel.ts) evaluates these; it has no other type to import.
export type Ref = { id: string } | { var: 'each' } | { self: true };

export type Predicate =
  | { t: 'and'; of: Predicate[] }
  | { t: 'or'; of: Predicate[] }
  | { t: 'not'; of: Predicate }
  | { t: 'magnitudeAtLeast'; e: Ref; n: number }
  | { t: 'attrAtLeast'; e: Ref; key: string; n: number }
  | { t: 'attrEquals'; e: Ref; key: string; v: string | number | boolean }
  | { t: 'hasTag'; e: Ref; tag: string }
  | { t: 'relationAtLeast'; a: Ref; b: Ref; rel: string; n: number }
  | { t: 'playerHasRole'; role: string }
  | { t: 'playerRepAtLeast'; axis: keyof Reputation; n: number }
  | { t: 'playerControls'; e: Ref }
  | { t: 'controlledBy'; e: Ref; faction: string }
  | { t: 'daysSince'; eventKey: string; n: number }
  | { t: 'countMatching'; match: Predicate; n: number }
  | { t: 'exists'; id: string };

export type Effect =
  | { t: 'addMagnitude'; e: Ref; delta: number }
  | { t: 'addAttr'; e: Ref; key: string; delta: number }
  | { t: 'setAttr'; e: Ref; key: string; v: string | number | boolean }
  | { t: 'clampedRep'; axis: keyof Reputation; delta: number }
  | { t: 'addRelation'; a: Ref; b: Ref; rel: string; delta: number }
  | { t: 'setTag'; e: Ref; tag: string }
  | { t: 'clearTag'; e: Ref; tag: string }
  | { t: 'logEvent'; key: string }
  | { t: 'retireEntity'; e: Ref }
  | { t: 'spawnEntity'; id: string; entityType: string; tags: string[]; attrs: Record<string, number | string | boolean>; atLocation?: string }
  | { t: 'transferControl'; e: Ref; toFaction: string }
  // ——— geometric structural ops (P3): self-validating, fail atomically ———
  | { t: 'placeBuildingValidly'; map: string; kind: string; owner: string; name: string }
  | { t: 'createLocation'; newMapId: string; seedMap: string; biome: string; tags: string[]; name: string }
  | { t: 'wireConnection'; fromMap: string; fromX: number; fromY: number; toMap: string; toX: number; toY: number };

// The geometric ops are injected into the tick (kernel.ts stays decoupled from
// the renderer). Each returns whether it applied; each self-validates.
export interface StructuralOps {
  placeBuildingValidly(state: WorldState, map: string, kind: string, owner: string, name: string): boolean;
  createLocation(state: WorldState, newMapId: string, seedMap: string, biome: string, tags: string[], name: string): boolean;
  wireConnection(state: WorldState, fromMap: string, fromX: number, fromY: number, toMap: string, toX: number, toY: number): boolean;
}

// Authored threshold ladder on a channel; fired by the two-phase tick.
export interface Threshold {
  channel: string;          // 'magnitude' or a named attr key
  level: number;
  up: Effect[];
  down: Effect[];
}

export interface Rule {
  id: string;
  when: Predicate;
  forEach?: Predicate;      // binds 'each'; frozen, id-ordered match-set
  then: Effect[];
  throttleDays: number;     // min days between firings (0 = every day)
  source?: 'kernel' | 'authored';
}

export interface Entity {
  id: string;
  type: string;                                    // OPEN: 'location' | 'npc' | 'faction' | 'slot' | 'player' | ...
  tags: string[];                                  // OPEN, kept SORTED (canonical codec)
  attrs: Record<string, number | string | boolean>;// OPEN
  magnitude: number;                               // accretion channel (P2: fixed-point + velocity cap)
  relations: Edge[];
  thresholds: Threshold[];
}

export type EntityRegistry = Record<string, Entity>;

// ——— tag helpers (maintain the sorted-array invariant) ———
export function hasTag(e: Entity, tag: string): boolean { return e.tags.includes(tag); }
export function addTag(e: Entity, tag: string): void {
  if (!e.tags.includes(tag)) { e.tags.push(tag); e.tags.sort(); }
}
export function removeTag(e: Entity, tag: string): void {
  const i = e.tags.indexOf(tag);
  if (i >= 0) e.tags.splice(i, 1);
}

function mk(
  id: string, type: string, tags: string[],
  attrs: Record<string, number | string | boolean>, relations: Edge[] = [],
): Entity {
  return { id, type, tags: [...new Set(tags)].sort(), attrs, magnitude: 0, relations, thresholds: [] };
}

// id conventions — stable, namespaced, derivable from struct ids.
export const eid = {
  town: (id: string) => `town:${id}`,
  bld: (id: string) => `bld:${id}`,
  npc: (id: string) => `npc:${id}`,
  slot: (id: string) => `slot:${id}`,
  faction: (id: string) => `faction:${id}`,
  player: 'player',
};

const FACTIONS: FactionId[] = ['league', 'rocket', 'townsfolk', 'rangers'];

// Derive the full Entity registry from the current world structs. Deterministic:
// fixed iteration order, sorted tags, fixed attr/relation order → byte-identical
// across runs with the same state.
export function buildEntitiesFromWorld(state: WorldState): EntityRegistry {
  const E: EntityRegistry = {};

  for (const f of FACTIONS) E[eid.faction(f)] = mk(eid.faction(f), 'faction', ['faction'], { name: f });

  const p = state.player;
  E[eid.player] = mk(eid.player, 'player', ['player'], {
    name: p.name, map: p.map, badges: p.badges, money: p.money,
    repLeague: p.reputation.league, repRocket: p.reputation.rocket,
    repCivic: p.reputation.civic, repResearch: p.reputation.research,
  });

  for (const t of Object.values(state.towns)) {
    E[eid.town(t.id)] = mk(eid.town(t.id), 'location', ['town'], {
      name: t.name, prosperity: t.prosperity, rocketInfluence: t.rocketInfluence, mood: t.mood,
    });
  }

  for (const b of Object.values(state.buildings)) {
    E[eid.bld(b.id)] = mk(eid.bld(b.id), 'location', ['building', b.kind], {
      name: b.name, map: b.map, kind: b.kind, condition: b.condition, owner: b.owner ?? '',
    }, state.towns[b.map] ? [{ to: eid.town(b.map), rel: 'in', weight: 1 }] : []);
  }

  for (const n of Object.values(state.npcs)) {
    E[eid.npc(n.id)] = mk(eid.npc(n.id), 'npc', [n.faction, n.role], {
      name: n.name, town: n.town, attitude: n.attitude, faction: n.faction, role: n.role,
    }, [
      ...(state.towns[n.town] ? [{ to: eid.town(n.town), rel: 'in', weight: 1 }] : []),
      { to: eid.faction(n.faction), rel: 'memberOf', weight: 1 },
    ]);
  }

  for (const sl of Object.values(state.slots)) {
    const rels: Edge[] = sl.holder && sl.holder !== 'player' && state.npcs[sl.holder]
      ? [{ to: eid.npc(sl.holder), rel: 'heldBy', weight: 1 }] : [];
    E[eid.slot(sl.id)] = mk(eid.slot(sl.id), 'slot', [sl.role], {
      title: sl.title, holder: sl.holder ?? '', town: sl.town ?? '',
    }, rels);
  }

  return E;
}
