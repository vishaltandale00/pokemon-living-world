// Derive an action-combat "kit" from a real MonsterInstance.
//
// The action battle reuses the game's real stats (atk/def/spd/maxHp/moves/type)
// so any of the 13 species drops in without hand-authoring. Posture / stamina /
// cooldown / tell timings have no source in the stat model — they are authored
// tuning constants here (the stat model only specifies the stat→action axes).
import { SPECIES, MOVES, type MonsterInstance } from '../../world/monsters';
import type { RoleId } from '../../world/types';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export type ActionEl = string | null; // a real type name (for type math), or null = physical

export interface ActionMove {
  name: string;
  el: ActionEl;       // element for VFX tint / fire-comp
  tEl: ActionEl;      // element the TYPE MATH uses (null = physical, always reliable)
  dmg: number;
  posture: number;
  range: number;
  sta: number;
}

export interface ActionSpecial {
  slot: 'U' | 'I' | 'O';
  name: string;
  kind: 'projectile' | 'cone';
  el: ActionEl;
  dmg: number;
  posture: number;
  range: number;
  cd: number;
  sta: number;
  // projectile
  speed?: number;
  count?: number;
  spread?: number;
  pr?: number;
  // cone
  arc?: number;
  active?: number;
}

export interface ActionKit {
  name: string;
  dexId: number;
  element: string;            // species type1 (drives fire-comp + ambient VFX)
  type1: string;
  type2: string | null;
  scale: number;              // sprite display scale
  hp: number;
  speed: number;              // move px/s
  dodgeCost: number;
  dodgeVel: number;
  dodgeEl: ActionEl;          // water types splash on dodge
  regen: number;              // stamina/ms
  light: ActionMove;
  heavy: ActionMove;
  specials: ActionSpecial[];
}

// Map a real type to a coarse VFX family the renderer knows how to draw.
export function vfxEl(type: ActionEl): 'fire' | 'water' | 'grass' | 'electric' | null {
  if (type === 'fire') return 'fire';
  if (type === 'water' || type === 'ice') return 'water';
  if (type === 'grass') return 'grass';
  if (type === 'electric') return 'electric';
  return null;
}

// Player kit: light & heavy are reliable PHYSICAL strikes (tEl null) so you can
// always chip any boss; your typed moves become ranged specials that carry the
// super-effective / resisted / immune pressure.
export function toActionKit(m: MonsterInstance): ActionKit {
  const s = SPECIES[m.speciesId];
  const speed = clamp(135 + (m.spd - 18) * 2.2, 122, 205);
  // Specials: derive 2-3 ranged options so the U/I/O binds are all real (decision
  // D2) WITHOUT touching the world's move data. Damage scales with the owner's atk
  // so a typed special stays relevant at every level (not flat power*0.5).
  const sdmg = (power: number) => Math.max(8, Math.round((power / 100) * (m.atk * 1.7 + 8)));
  const spost = (power: number) => Math.max(6, Math.round(power * 0.5));
  const raw: Omit<ActionSpecial, 'slot'>[] = [];
  for (const id of m.moves) {
    if (id === 'tackle' || !MOVES[id]) continue;
    const mv = MOVES[id];
    raw.push({ name: mv.name, kind: 'projectile', el: mv.type, dmg: sdmg(mv.power), posture: spost(mv.power), range: 330, speed: 560, count: 1, spread: 0, pr: 8, cd: 3200, sta: 20 });
  }
  // a heavy physical option everyone gets (slow, big single hit)
  if (raw.length < 3) raw.push({ name: 'Power Shot', kind: 'projectile', el: null, dmg: Math.max(8, Math.round(m.atk * 0.95)), posture: Math.max(8, Math.round(m.atk * 0.4)), range: 290, speed: 440, count: 1, spread: 0, pr: 11, cd: 4200, sta: 24 });
  // ensure a 2nd option for movesets with no typed move (pure-normal types)
  if (raw.length < 2) raw.push({ name: 'Quick Shot', kind: 'projectile', el: null, dmg: Math.max(6, Math.round(m.atk * 0.5)), posture: Math.max(5, Math.round(m.atk * 0.3)), range: 320, speed: 600, count: 2, spread: 0.12, pr: 6, cd: 2600, sta: 16 });
  const SLOTS: ('I' | 'U' | 'O')[] = ['I', 'U', 'O'];
  const specials: ActionSpecial[] = raw.slice(0, 3).map((s, i) => ({ ...s, slot: SLOTS[i] }));
  return {
    name: s.name,
    dexId: s.dexId,
    element: s.type1,
    type1: s.type1,
    type2: s.type2,
    scale: 1,
    hp: m.maxHp,
    speed,
    dodgeCost: clamp(26 - Math.floor(m.spd / 4), 16, 26),
    dodgeVel: 470 + (speed - 130) * 1.4,
    dodgeEl: s.type1 === 'water' ? 'water' : null,
    regen: 0.034 + Math.min(0.022, m.spd * 0.0006),
    light: {
      name: 'Strike', el: s.type1, tEl: null,
      dmg: Math.max(4, Math.round(m.atk * 0.55)),
      posture: 10 + Math.floor(m.atk * 0.08),
      range: 78, sta: 8,
    },
    heavy: {
      name: 'Heavy Strike', el: s.type1, tEl: null,
      dmg: Math.max(8, Math.round(m.atk * 1.25)),
      posture: 24 + Math.floor(m.atk * 0.12),
      range: 102, sta: 20,
    },
    specials,
  };
}

export interface BossKit {
  name: string;
  dexId: number;
  element: string;
  type1: string;
  type2: string | null;
  level: number;        // for the intro card
  roleLabel: string;    // "Gym Leader" / "Wild" / "Trainer" … for the intro card
  hpPool: number;       // scaled so the duel lasts (boss is a damage sponge vs your kit)
  maxPosture: number;
  atkBase: number;      // boss-move damage scales off this
  radius: number;       // body hit radius
}

const ROLE_LABEL: Partial<Record<RoleId, string>> = {
  gym_leader: 'Gym Leader', elite_four: 'Elite Four', champion: 'Champion',
  rocket_boss: 'Rocket Boss', rocket_officer: 'Rocket Officer', rocket_grunt: 'Rocket Grunt',
  trainer: 'Trainer', gym_challenger: 'Challenger', ranger: 'Ranger', legend_hunter: 'Legend Hunter', wanderer: 'Trainer',
};

// Bosses get an HP multiplier so the action duel lasts a satisfying time —
// stronger roles soak more. Move damage scales off the opponent's real atk.
const ROLE_HP_MULT: Partial<Record<RoleId, number>> = {
  gym_leader: 3.3, elite_four: 3.6, champion: 3.8,
  rocket_boss: 3.3, rocket_officer: 2.7, legend_hunter: 3.2,
  rocket_grunt: 2.2, trainer: 2.3, gym_challenger: 2.4, ranger: 2.4, wanderer: 2.1,
};

export function toBossKit(opponent: MonsterInstance, opts: { role?: RoleId; wild?: boolean } = {}): BossKit {
  const s = SPECIES[opponent.speciesId];
  const mult = opts.wild ? 1.55 : (opts.role ? (ROLE_HP_MULT[opts.role] ?? 2.4) : 2.4);
  return {
    name: s.name,
    dexId: s.dexId,
    element: s.type1,
    type1: s.type1,
    type2: s.type2,
    level: opponent.level,
    roleLabel: opts.wild ? 'Wild' : (opts.role ? (ROLE_LABEL[opts.role] ?? 'Trainer') : 'Trainer'),
    hpPool: Math.round(opponent.maxHp * mult),
    maxPosture: Math.round(80 + opponent.def * 0.6),
    atkBase: opponent.atk,
    radius: 46,
  };
}
