import type { MonsterSpecies, MonsterInstance } from './types';
export type { MonsterInstance } from './types';

// Real Kanto roster (local hobby project — actual Pokémon names).
// dexId = national dex number, matches /public/sprites/<dexId>.png + back_<dexId>.png
export const SPECIES: Record<string, MonsterSpecies> = {
  charmander: { id: 'charmander', name: 'Charmander', dexId: 4,   type1: 'fire',     type2: null,      baseHp: 39, baseAtk: 52, baseDef: 43, baseSpd: 65, color: 0xe8703a, catchRate: 0.45 },
  squirtle:   { id: 'squirtle',   name: 'Squirtle',   dexId: 7,   type1: 'water',    type2: null,      baseHp: 44, baseAtk: 48, baseDef: 65, baseSpd: 43, color: 0x4a90d9, catchRate: 0.45 },
  bulbasaur:  { id: 'bulbasaur',  name: 'Bulbasaur',  dexId: 1,   type1: 'grass',    type2: 'poison',  baseHp: 45, baseAtk: 49, baseDef: 49, baseSpd: 45, color: 0x5cb85c, catchRate: 0.45 },
  pikachu:    { id: 'pikachu',    name: 'Pikachu',    dexId: 25,  type1: 'electric', type2: null,      baseHp: 35, baseAtk: 55, baseDef: 40, baseSpd: 90, color: 0xf0d048, catchRate: 0.35 },
  geodude:    { id: 'geodude',    name: 'Geodude',    dexId: 74,  type1: 'rock',     type2: 'ground',  baseHp: 45, baseAtk: 70, baseDef: 82, baseSpd: 20, color: 0x9a8866, catchRate: 0.5 },
  onix:       { id: 'onix',       name: 'Onix',       dexId: 95,  type1: 'rock',     type2: 'ground',  baseHp: 44, baseAtk: 40, baseDef: 92, baseSpd: 70, color: 0x8d8478, catchRate: 0.4 },
  gastly:     { id: 'gastly',     name: 'Gastly',     dexId: 92,  type1: 'ghost',    type2: 'poison',  baseHp: 30, baseAtk: 35, baseDef: 30, baseSpd: 80, color: 0x8a6fc8, catchRate: 0.35 },
  rattata:    { id: 'rattata',    name: 'Rattata',    dexId: 19,  type1: 'normal',   type2: null,      baseHp: 30, baseAtk: 56, baseDef: 35, baseSpd: 72, color: 0xb88fc8, catchRate: 0.75 },
  pidgey:     { id: 'pidgey',     name: 'Pidgey',     dexId: 16,  type1: 'normal',   type2: 'flying',  baseHp: 40, baseAtk: 45, baseDef: 40, baseSpd: 56, color: 0xc8a878, catchRate: 0.7 },
  houndour:   { id: 'houndour',   name: 'Houndour',   dexId: 228, type1: 'dark',     type2: 'fire',    baseHp: 45, baseAtk: 60, baseDef: 30, baseSpd: 65, color: 0x4a4458, catchRate: 0.45 },
  lapras:     { id: 'lapras',     name: 'Lapras',     dexId: 131, type1: 'ice',      type2: 'water',   baseHp: 130, baseAtk: 85, baseDef: 80, baseSpd: 60, color: 0x9fd8e8, catchRate: 0.2 },
  dratini:    { id: 'dratini',    name: 'Dratini',    dexId: 147, type1: 'dragon',   type2: null,      baseHp: 41, baseAtk: 64, baseDef: 45, baseSpd: 50, color: 0x6878c8, catchRate: 0.25 },
  lugia:      { id: 'lugia',      name: 'Lugia',      dexId: 249, type1: 'psychic',  type2: 'flying',  baseHp: 106, baseAtk: 90, baseDef: 130, baseSpd: 110, color: 0xd8e8f8, catchRate: 0.05 }, // legendary
};

export const MOVES: Record<string, { name: string; type: string; power: number }> = {
  tackle:     { name: 'Tackle',       type: 'normal',   power: 40 },
  ember:      { name: 'Ember',        type: 'fire',     power: 45 },
  watergun:   { name: 'Water Gun',    type: 'water',    power: 45 },
  vinewhip:   { name: 'Vine Whip',    type: 'grass',    power: 45 },
  thundershock: { name: 'Thunder Shock', type: 'electric', power: 50 },
  rockthrow:  { name: 'Rock Throw',   type: 'rock',     power: 50 },
  lick:       { name: 'Lick',         type: 'ghost',    power: 50 },
  bite:       { name: 'Bite',         type: 'dark',     power: 55 },
  icebeam:    { name: 'Ice Beam',     type: 'ice',      power: 65 },
  dragonrage: { name: 'Dragon Rage',  type: 'dragon',   power: 60 },
  aeroblast:  { name: 'Aeroblast',    type: 'psychic',  power: 90 },
};

const TYPE_CHART: Record<string, Record<string, number>> = {
  fire:     { grass: 2, ice: 2, bug: 2, steel: 2, water: 0.5, rock: 0.5, fire: 0.5, dragon: 0.5 },
  water:    { fire: 2, rock: 2, ground: 2, grass: 0.5, water: 0.5, dragon: 0.5 },
  grass:    { water: 2, rock: 2, ground: 2, fire: 0.5, grass: 0.5, poison: 0.5, flying: 0.5, bug: 0.5, dragon: 0.5, steel: 0.5 },
  electric: { water: 2, flying: 2, grass: 0.5, electric: 0.5, dragon: 0.5, ground: 0 },
  rock:     { fire: 2, ice: 2, flying: 2, bug: 2, fighting: 0.5, ground: 0.5, steel: 0.5 },
  ground:   { fire: 2, electric: 2, rock: 2, poison: 2, steel: 2, grass: 0.5, bug: 0.5, flying: 0 },
  ghost:    { ghost: 2, psychic: 2, normal: 0, dark: 0.5 },
  dark:     { ghost: 2, psychic: 2, dark: 0.5, fighting: 0.5, fairy: 0.5 },
  ice:      { grass: 2, ground: 2, flying: 2, dragon: 2, fire: 0.5, water: 0.5, ice: 0.5, steel: 0.5 },
  dragon:   { dragon: 2, steel: 0.5 },
  psychic:  { poison: 2, fighting: 2, psychic: 0.5, steel: 0.5, dark: 0 },
  normal:   { rock: 0.5, steel: 0.5, ghost: 0 },
};

export function typeMultiplier(moveType: string, def1: string, def2: string | null): number {
  const row = TYPE_CHART[moveType] ?? {};
  let m = (row[def1] ?? 1);
  if (def2) m *= (row[def2] ?? 1);
  // Compress the multipliers so battles aren't decided by one swingy hit:
  // keep immunities, but soften "not very effective" (so a doubly-resisted
  // attacker like Charmander vs rock/ground Onix still chips) and cap
  // super-effective so a 2x/4x hit can't one-shot a frail starter.
  if (m === 0) return 0;
  if (m < 1) return 0.7;
  if (m > 1) return 1.6;
  return 1;
}

export function defaultMoves(speciesId: string): string[] {
  const s = SPECIES[speciesId];
  const byType: Record<string, string> = {
    fire: 'ember', water: 'watergun', grass: 'vinewhip', electric: 'thundershock',
    rock: 'rockthrow', ghost: 'lick', dark: 'bite', ice: 'icebeam',
    dragon: 'dragonrage', psychic: 'aeroblast', normal: 'tackle',
  };
  const m = byType[s.type1] ?? 'tackle';
  return m === 'tackle' ? ['tackle'] : ['tackle', m];
}

export function makeMonster(speciesId: string, level: number, nickname: string | null = null): MonsterInstance {
  const s = SPECIES[speciesId];
  const scale = (base: number) => Math.floor((base * level) / 50) + 5;
  // generous HP so battles last several turns and items/strategy matter
  const maxHp = Math.floor((s.baseHp * level) / 20) + level + 16;
  return {
    speciesId, nickname, level,
    hp: maxHp, maxHp,
    atk: scale(s.baseAtk), def: scale(s.baseDef), spd: scale(s.baseSpd),
    moves: defaultMoves(speciesId),
    xp: 0,
  };
}

// XP needed to advance FROM the given level to the next.
export function xpToNext(level: number): number {
  return 12 + level * 8;
}
