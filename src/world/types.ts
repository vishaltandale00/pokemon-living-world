// World state types — the simulation's source of truth.
// Roles are SLOTS in the world, not story flags. The LLM director proposes
// mutations; the sim validates them. Nothing narrative is hardcoded.

import type { DialogueTurn } from './dialogueContent';
import type { RngState } from './rng';
import type { EntityRegistry } from './entity';

export type FactionId = 'league' | 'rocket' | 'townsfolk' | 'rangers';

export interface Reputation {
  league: number;    // standing with the Pokémon League (-100..100)
  rocket: number;    // standing with Team Rocket
  civic: number;     // standing with ordinary townsfolk
  research: number;  // standing with explorers/professors
}

export type RoleId =
  | 'wanderer'
  | 'trainer'
  | 'gym_challenger'
  | 'gym_leader'
  | 'elite_four'
  | 'champion'
  | 'rocket_grunt'
  | 'rocket_officer'
  | 'rocket_boss'
  | 'ranger'
  | 'legend_hunter';

export interface RoleSlot {
  id: string;             // e.g. 'gym_leader_viridian'
  role: RoleId;
  title: string;          // display name e.g. 'Viridian Gym Leader'
  holder: string | null;  // npc id, 'player', or null (vacant)
  town: string | null;
  // Acquisition requirements, validated by the sim:
  requires: {
    minRep?: Partial<Reputation>;
    badges?: number;
    defeatHolder?: boolean;   // must beat current holder in battle
    invitation?: boolean;     // must be invited via a world event
  };
}

export interface NPC {
  id: string;
  name: string;
  sprite: number;          // palette index for procedural sprite
  faction: FactionId;
  role: RoleId;
  town: string;
  x: number; y: number;    // tile coords in current map
  map: string;
  personality: string;     // seed for the LLM, evolves over time
  // Battle stats (simple but real):
  party: MonsterInstance[];
  defeated: boolean;       // defeated by player today
  attitude: number;        // -100..100 toward player, drifts with events
}

export interface MonsterSpecies {
  id: string;
  name: string;
  dexId: number;           // national dex number → /sprites/<dexId>.png
  type1: string;
  type2: string | null;
  baseHp: number;
  baseAtk: number;
  baseDef: number;
  baseSpd: number;
  color: number;           // for procedural sprite tint
  catchRate: number;       // 0..1 base capture ease (common high, legendary low)
}

export interface MonsterInstance {
  speciesId: string;
  nickname: string | null;
  level: number;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  spd: number;
  moves: string[];
  xp: number;          // experience toward the next level
}

export interface Building {
  id: string;
  kind: 'house' | 'gym' | 'center' | 'mart' | 'hideout' | 'lab' | 'tower';
  name: string;
  map: string;
  x: number; y: number; w: number; h: number;  // tile rect
  owner: string | null;     // faction or npc id
  condition: 'new' | 'normal' | 'damaged' | 'ruined';
  builtOnDay: number;
}

export interface WorldEvent {
  day: number;
  kind: string;            // 'battle_won' | 'role_acquired' | 'building_built' | 'faction_shift' | 'rumor' | ...
  summary: string;         // human-readable fact, used for LLM retrieval
  data?: Record<string, unknown>;
}

export interface TownState {
  id: string;
  name: string;
  prosperity: number;      // 0..100, drives building growth/decay
  rocketInfluence: number; // 0..100
  mood: string;            // one-word vibe, LLM-writable
}

export interface PlayerState {
  name: string;
  x: number; y: number;
  map: string;
  roles: RoleId[];         // accumulated roles (you can be champion AND legend hunter)
  badges: number;
  money: number;
  reputation: Reputation;
  party: MonsterInstance[];
  flags: Record<string, boolean>;
  story: number;           // index into the authored story spine (world/story.ts)
  items: Record<string, number>;  // itemId -> count (e.g. potion, pokeball)
}

// A prefetched/cached LLM dialogue turn (see llm/dialogueCache.ts). `turn` is
// already sanitized (it's exactly what npcDialogue returns). It's only served
// when `sig` still matches the live world signature and `day >= state.day`, so
// a cached line can never be shown stale.
export interface CachedDialogue {
  turn: DialogueTurn;
  sig: string;
  day: number;
}

export interface WorldState {
  day: number;
  player: PlayerState;
  npcs: Record<string, NPC>;
  slots: Record<string, RoleSlot>;
  towns: Record<string, TownState>;
  buildings: Record<string, Building>;
  events: WorldEvent[];          // append-only history
  rumors: string[];              // current rumor pool, LLM-refreshed
  pendingOffers: RoleOffer[];    // director-generated opportunities
  dialogueCache?: Record<string, CachedDialogue>; // key: `${npc.id}|${norm(playerSaid)}`
  // ——— determinism (P0): the world-sim's reproducibility anchors ———
  rng: RngState;                 // seed + per-stream cursors (see world/rng.ts)
  idSeq: Record<string, number>; // per-prefix monotonic id counters (replaces Date.now ids)
  // ——— kernel substrate (P1): every game object as an open Entity ———
  entities: EntityRegistry;      // derived from structs in P1a; tick-owned from P2 (see world/entity.ts)
  // ——— kernel runtime (P2): persisted so a half-grown world resumes identically ———
  kernel: KernelState;
  // ——— structural-op data homes (P3): runtime geometry the ops write ———
  connections: Connection[];               // edges wireConnection lays; merged into buildMap exits
  mapLayouts: Record<string, string[]>;    // runtime ASCII layouts for createLocation'd map nodes
}

// A walkable edge between two overworld tiles (bidirectional pairs are stored as
// two Connections). Persisted so generated roads/links survive a reload.
export interface Connection { fromMap: string; fromX: number; fromY: number; toMap: string; toX: number; toY: number; }

// Per-tick/per-day runtime the kernel carries IN the save (reload-deterministic).
export interface KernelState {
  lastFired: Record<string, number>;    // ruleId -> day it last fired (throttle)
  channelDay: number;                    // the day `channelUsed` budgets apply to
  channelUsed: Record<string, number>;   // `${entityId}|${channel}` -> abs delta spent this day (velocity cap)
  deferred: DeferredDelta[];             // cross-entity threshold bumps, applied (re-capped) NEXT tick
}
export interface DeferredDelta { id: string; channel: string; delta: number; }

export interface RoleOffer {
  id: string;
  slotId: string;
  fromNpc: string;
  text: string;          // how the offer is phrased
  expiresDay: number;
}

// ——— LLM director proposal schema (what the model is allowed to do) ———

export interface DirectorProposal {
  developments: Development[];
  rumors: string[];
  townMoods: { town: string; mood: string }[];
}

export type Development =
  | { kind: 'faction_shift'; town: string; rocketDelta: number; prosperityDelta: number; reason: string }
  | { kind: 'npc_attitude'; npc: string; delta: number; reason: string }
  | { kind: 'role_offer'; slotId: string; fromNpc: string; text: string }
  | { kind: 'building_change'; town: string; action: 'build' | 'damage' | 'repair' | 'ruin'; buildingKind: Building['kind']; name: string; reason: string }
  | { kind: 'vacate_slot'; slotId: string; reason: string }
  | { kind: 'world_news'; summary: string };
