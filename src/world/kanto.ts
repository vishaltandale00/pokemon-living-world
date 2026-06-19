// CANONICAL KANTO — the seed world as the original game's geography, expressed
// as DATA. A generator (kantoGen.ts) turns this graph into walkable maps,
// connections, towns, buildings, NPCs and gym slots at seed time. The emergent
// engine then DIVERGES this world as it's played.
//
// Fidelity: canonically STRUCTURED (right places, right connections, right gyms,
// biome-appropriate terrain rendered with real FRLG metatiles) — not pixel-ripped
// from the cartridge (that needs the original map.bin blockdata, not in repo).
//
// HYBRID: the three hand-authored maps (viridian, route1, pewter) and all their
// seed content (NPCs, the warehouse, the story spine) are PRESERVED untouched
// (`existing: true` -> generator skips their layout + content, only wires edges).
// Everything else is generated. All connections are data-driven.

export type Biome = 'town' | 'city' | 'route' | 'forest' | 'cave' | 'water' | 'plateau';
export type Dir = 'n' | 's' | 'e' | 'w';

export interface KantoGym {
  leader: string;        // npc id
  name: string;          // leader display name
  type: string;          // specialty type (flavor)
  badge: string;         // badge name
  slotId: string;        // role slot id
}

export interface KantoPlace {
  id: string;            // map id (also town-registry id)
  name: string;
  biome: Biome;
  existing?: boolean;    // already hand-authored in maps.ts LAYOUTS + seed.ts content
  buildings?: Array<'center' | 'mart' | 'house' | 'lab' | 'gym' | 'tower'>;
  gym?: KantoGym;
  blurb?: string;
}

export interface KantoEdge { from: string; to: string; fromDir: Dir; }

// ——— the places ———
export const PLACES: KantoPlace[] = [
  // ——— starting region (Pallet is the NEW true start) ———
  { id: 'pallet', name: 'Pallet Town', biome: 'town', buildings: ['lab', 'house', 'house'],
    blurb: 'A tranquil seaside town where your journey begins.' },
  { id: 'route1s', name: 'Route 1', biome: 'route', blurb: 'A gentle path north to Viridian.' },

  // ——— hand-authored core, preserved ———
  { id: 'viridian', name: 'Viridian City', biome: 'city', existing: true,
    gym: { leader: 'giovanni', name: 'Giovanni', type: 'ground', badge: 'Earth Badge', slotId: 'gym_leader_viridian' } },
  { id: 'route1', name: 'Route 1', biome: 'route', existing: true },
  { id: 'viridian_forest', name: 'Viridian Forest', biome: 'forest', blurb: 'A natural maze of trees, alive with Bug Pokémon.' },
  { id: 'pewter', name: 'Pewter City', biome: 'city', existing: true,
    gym: { leader: 'brock', name: 'Brock', type: 'rock', badge: 'Boulder Badge', slotId: 'gym_leader_pewter' } },

  // ——— Mt. Moon to Cerulean ———
  { id: 'route3', name: 'Route 3', biome: 'route', blurb: 'A climbing trail toward the mountain caves.' },
  { id: 'mt_moon', name: 'Mt. Moon', biome: 'cave', blurb: 'A dark cave said to draw a meteor’s light.' },
  { id: 'route4', name: 'Route 4', biome: 'route', blurb: 'The path down to Cerulean.' },
  { id: 'cerulean', name: 'Cerulean City', biome: 'city', buildings: ['center', 'mart', 'gym', 'house'],
    gym: { leader: 'misty', name: 'Misty', type: 'water', badge: 'Cascade Badge', slotId: 'gym_leader_cerulean' },
    blurb: 'A beautiful city of water, by the cape.' },

  // ——— Cerulean spokes ———
  { id: 'route24', name: 'Route 24', biome: 'route', blurb: 'Nugget Bridge, north of Cerulean.' },
  { id: 'route5', name: 'Route 5', biome: 'route', blurb: 'South of Cerulean toward Saffron.' },
  { id: 'route9', name: 'Route 9', biome: 'route', blurb: 'East toward the Rock Tunnel.' },
  { id: 'rock_tunnel', name: 'Rock Tunnel', biome: 'cave', blurb: 'A pitch-black tunnel through the ridge.' },
  { id: 'route10', name: 'Route 10', biome: 'route', blurb: 'Past the power plant to Lavender.' },

  // ——— Saffron hub ———
  { id: 'saffron', name: 'Saffron City', biome: 'city', buildings: ['center', 'mart', 'gym', 'house', 'tower'],
    gym: { leader: 'sabrina', name: 'Sabrina', type: 'psychic', badge: 'Marsh Badge', slotId: 'gym_leader_saffron' },
    blurb: 'The bustling heart of Kanto — and Silph Co.’s tower.' },
  { id: 'route6', name: 'Route 6', biome: 'route', blurb: 'South of Saffron to Vermilion.' },
  { id: 'route7', name: 'Route 7', biome: 'route', blurb: 'West of Saffron to Celadon.' },
  { id: 'route8', name: 'Route 8', biome: 'route', blurb: 'East of Saffron to Lavender.' },

  // ——— Vermilion ———
  { id: 'vermilion', name: 'Vermilion City', biome: 'city', buildings: ['center', 'mart', 'gym', 'house'],
    gym: { leader: 'surge', name: 'Lt. Surge', type: 'electric', badge: 'Thunder Badge', slotId: 'gym_leader_vermilion' },
    blurb: 'The port of exit to the sea.' },

  // ——— Celadon ———
  { id: 'celadon', name: 'Celadon City', biome: 'city', buildings: ['center', 'mart', 'gym', 'house'],
    gym: { leader: 'erika', name: 'Erika', type: 'grass', badge: 'Rainbow Badge', slotId: 'gym_leader_celadon' },
    blurb: 'The big-city brightness of department stores — and a Rocket secret.' },

  // ——— Lavender ———
  { id: 'lavender', name: 'Lavender Town', biome: 'town', buildings: ['center', 'mart', 'tower', 'house'],
    blurb: 'A quiet, haunted town beneath the Pokémon Tower.' },

  // ——— south to Fuchsia ———
  { id: 'route12', name: 'Route 12', biome: 'water', blurb: 'The Silence Bridge along the sea.' },
  { id: 'route13', name: 'Route 13', biome: 'route', blurb: 'Open fields toward Fuchsia.' },
  { id: 'fuchsia', name: 'Fuchsia City', biome: 'city', buildings: ['center', 'mart', 'gym', 'house'],
    gym: { leader: 'koga', name: 'Koga', type: 'poison', badge: 'Soul Badge', slotId: 'gym_leader_fuchsia' },
    blurb: 'A town of ninja secrets and the Safari Zone.' },

  // ——— Cinnabar (island loop back to Pallet) ———
  { id: 'route19', name: 'Route 19', biome: 'water', blurb: 'Open water south of Fuchsia.' },
  { id: 'route20', name: 'Route 20', biome: 'water', blurb: 'Past the Seafoam Islands.' },
  { id: 'cinnabar', name: 'Cinnabar Island', biome: 'city', buildings: ['center', 'mart', 'gym', 'lab'],
    gym: { leader: 'blaine', name: 'Blaine', type: 'fire', badge: 'Volcano Badge', slotId: 'gym_leader_cinnabar' },
    blurb: 'A volcanic island of fire and old laboratories.' },
  { id: 'route21', name: 'Route 21', biome: 'water', blurb: 'The sea lane back to Pallet.' },

  // ——— Victory Road & the League (west of Viridian) ———
  { id: 'route22', name: 'Route 22', biome: 'route', blurb: 'West of Viridian, the road to the League.' },
  { id: 'route23', name: 'Route 23', biome: 'route', blurb: 'The guarded approach to Victory Road.' },
  { id: 'victory_road', name: 'Victory Road', biome: 'cave', blurb: 'The final gauntlet before the Plateau.' },
  { id: 'indigo', name: 'Indigo Plateau', biome: 'plateau', buildings: ['center'],
    blurb: 'The Pokémon League. Beyond it, the Champion.' },
];

// ——— connections (canonical Kanto adjacency, including the existing core) ———
export const EDGES: KantoEdge[] = [
  // Pallet -> Viridian (new) -> through the existing core to Pewter
  { from: 'pallet', to: 'route1s', fromDir: 'n' },
  { from: 'route1s', to: 'viridian', fromDir: 'n' },
  { from: 'viridian', to: 'route1', fromDir: 'n' },
  { from: 'route1', to: 'viridian_forest', fromDir: 'n' },
  { from: 'viridian_forest', to: 'pewter', fromDir: 'n' },
  // Pewter -> Mt. Moon -> Cerulean
  { from: 'pewter', to: 'route3', fromDir: 'e' },
  { from: 'route3', to: 'mt_moon', fromDir: 'e' },
  { from: 'mt_moon', to: 'route4', fromDir: 'e' },
  { from: 'route4', to: 'cerulean', fromDir: 'e' },
  // Cerulean spokes
  { from: 'cerulean', to: 'route24', fromDir: 'n' },
  { from: 'cerulean', to: 'route5', fromDir: 's' },
  { from: 'cerulean', to: 'route9', fromDir: 'e' },
  { from: 'route9', to: 'rock_tunnel', fromDir: 'e' },
  { from: 'rock_tunnel', to: 'route10', fromDir: 's' },
  { from: 'route10', to: 'lavender', fromDir: 's' },
  // Saffron hub
  { from: 'route5', to: 'saffron', fromDir: 's' },
  { from: 'saffron', to: 'route6', fromDir: 's' },
  { from: 'saffron', to: 'route7', fromDir: 'w' },
  { from: 'saffron', to: 'route8', fromDir: 'e' },
  { from: 'route6', to: 'vermilion', fromDir: 's' },
  { from: 'route7', to: 'celadon', fromDir: 'w' },
  { from: 'route8', to: 'lavender', fromDir: 'e' },
  // south to Fuchsia
  { from: 'lavender', to: 'route12', fromDir: 's' },
  { from: 'route12', to: 'route13', fromDir: 's' },
  { from: 'route13', to: 'fuchsia', fromDir: 'w' },
  // Cinnabar loop back to Pallet
  { from: 'fuchsia', to: 'route19', fromDir: 's' },
  { from: 'route19', to: 'route20', fromDir: 'w' },
  { from: 'route20', to: 'cinnabar', fromDir: 'w' },
  { from: 'cinnabar', to: 'route21', fromDir: 'n' },
  { from: 'route21', to: 'pallet', fromDir: 'n' },
  // Victory Road & League
  { from: 'viridian', to: 'route22', fromDir: 'w' },
  { from: 'route22', to: 'route23', fromDir: 'n' },
  { from: 'route23', to: 'victory_road', fromDir: 'n' },
  { from: 'victory_road', to: 'indigo', fromDir: 'n' },
];

export const START_PLACE = 'pallet';

// gym leaders' parties + personalities (canonical-flavored); generator spawns the
// NEW ones (brock + giovanni already exist in the seed cast).
// Rosters use only the 13 species that exist today, mapped to each leader's type
// where possible (placeholder until the full Gen-1 dex is added).
export const GYM_NPC: Record<string, { sprite: number; personality: string; party: [string, number][] }> = {
  misty:    { sprite: 3, personality: 'Cerulean Gym Leader, water-type specialist. Hot-tempered, proud, a tomboyish mermaid.', party: [['squirtle', 18], ['lapras', 22]] },
  surge:    { sprite: 5, personality: 'Vermilion Gym Leader, electric-type specialist. A loud ex-soldier who calls his Pokémon comrades.', party: [['pikachu', 21], ['pikachu', 24]] },
  erika:    { sprite: 9, personality: 'Celadon Gym Leader, grass-type specialist. Gentle and refined, a lover of flowers who naps in her garden.', party: [['bulbasaur', 27], ['bulbasaur', 29]] },
  koga:     { sprite: 8, personality: 'Fuchsia Gym Leader, poison-type specialist. A ninja master who fights with traps and toxins.', party: [['gastly', 37], ['houndour', 39]] },
  sabrina:  { sprite: 9, personality: 'Saffron Gym Leader, psychic-type specialist. Cold, telekinetic, unsettlingly precise.', party: [['gastly', 38], ['dratini', 43]] },
  blaine:   { sprite: 2, personality: 'Cinnabar Gym Leader, fire-type specialist. A riddling old scientist who guards his Gym with quizzes.', party: [['charmander', 42], ['houndour', 47]] },
};
