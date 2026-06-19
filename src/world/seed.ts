import type { WorldState, NPC, RoleSlot, Building, TownState } from './types';
import { makeMonster } from './monsters';
import { buildEntitiesFromWorld } from './entity';
import { generateKanto } from './kantoGen';

// Seed world: Viridian City + Route 1 + Pewter City (real Kanto).
// Everything here is DATA — the world mutates from day one via the director
// and the player's choices.

function npc(p: Partial<NPC> & Pick<NPC, 'id' | 'name' | 'faction' | 'role' | 'town' | 'x' | 'y' | 'map' | 'personality'>): NPC {
  return { sprite: 0, party: [], defeated: false, attitude: 0, ...p };
}

// `seed` anchors the world-sim's deterministic RNG. It defaults to a constant so
// the seed game is reproducible; a new game or the sim harness can pass an
// explicit seed to diverge. (A production new-game may mint the seed once from an
// entropy source — that's allowed: the seed is the replay anchor, not replayed.)
export function createSeedWorld(seed = 1): WorldState {
  const npcs: Record<string, NPC> = {};
  const add = (n: NPC) => { npcs[n.id] = n; };

  // ——— Viridian City ———
  add(npc({ id: 'giovanni', name: 'Giovanni', faction: 'league', role: 'gym_leader', town: 'viridian',
    x: 17, y: 19, map: 'int:viridian_gym', sprite: 1, attitude: -10,
    personality: 'Viridian Gym Leader, ground-type specialist. Publicly a respected pillar of the League; secretly the boss of Team Rocket. Calculating, charismatic, always evaluating whether people are useful to him. Never admits his Rocket ties unless the player has proven deep loyalty to the organization.',
    party: [makeMonster('geodude', 12), makeMonster('onix', 11)] }));
  add(npc({ id: 'oak', name: 'Prof. Oak', faction: 'rangers', role: 'legend_hunter', town: 'pallet',
    x: 3, y: 8, map: 'pallet', sprite: 2, attitude: 10,
    personality: 'The legendary Pokémon professor, working in his Viridian field lab. Obsessed lately with reports of Lugia sighted over the northern peaks. Warm, encouraging, trusts anyone who shows genuine curiosity about Pokémon.' }));
  add(npc({ id: 'blue', name: 'Blue', faction: 'townsfolk', role: 'trainer', town: 'viridian',
    x: 10, y: 6, map: 'viridian', sprite: 3,
    personality: 'Your cocky rival, Oak\'s grandson. Competitive, smug, but secretly respects you. Dreams of being Champion. Keeps score of your wins and losses and never lets you forget a loss. Smell ya later.',
    party: [makeMonster('squirtle', 7)] }));
  add(npc({ id: 'sal', name: 'Sal', faction: 'townsfolk', role: 'trainer', town: 'viridian',
    x: 5, y: 3, map: 'int:viridian_inn', sprite: 4,
    personality: 'Viridian innkeeper. Hears every rumor in town. Friendly but careful — knows more about Team Rocket activity than he lets on, and has private suspicions about Giovanni he only shares with people he deeply trusts.' }));
  add(npc({ id: 'nurse_viridian', name: 'Nurse Joy', faction: 'townsfolk', role: 'trainer', town: 'viridian',
    x: 7, y: 2, map: 'int:viridian_center', sprite: 10,
    personality: 'The ever-cheerful Pokémon Center nurse.' }));

  // ——— Route 1 (wilds between towns) ———
  add(npc({ id: 'james', name: 'James', faction: 'rocket', role: 'rocket_grunt', town: 'route1',
    x: 12, y: 9, map: 'route1', sprite: 5, attitude: -20,
    personality: 'Team Rocket grunt scouting the route. Theatrical, vain, not actually mean-spirited — fell into Rocket for the money. Always recruiting. Will respect anyone who beats him or helps him.',
    party: [makeMonster('houndour', 8)] }));
  add(npc({ id: 'ranger_iva', name: 'Ranger Iva', faction: 'rangers', role: 'ranger', town: 'route1',
    x: 7, y: 16, map: 'route1', sprite: 6, attitude: 5,
    personality: 'Route warden who protects wild Pokémon. Distrusts Rocket deeply. Offers ranger work to trainers who show kindness to wild creatures.',
    party: [makeMonster('bulbasaur', 10)] }));

  // ——— Pewter City ———
  add(npc({ id: 'brock', name: 'Brock', faction: 'league', role: 'gym_leader', town: 'pewter',
    x: 6, y: 11, map: 'int:pewter_gym', sprite: 7, attitude: 0,
    personality: 'Pewter Gym Leader, rock-type specialist. Reliable, kind-hearted, takes his duty seriously while raising his nine siblings. Dreams of becoming a Pokémon breeder instead — would happily hand the gym to a worthy successor. Hopeless romantic.',
    party: [makeMonster('geodude', 9), makeMonster('onix', 10)] }));
  add(npc({ id: 'nurse_pewter', name: 'Nurse Joy', faction: 'townsfolk', role: 'trainer', town: 'pewter',
    x: 7, y: 2, map: 'int:pewter_center', sprite: 10,
    personality: 'The ever-cheerful Pokémon Center nurse.' }));
  add(npc({ id: 'clerk_pewter', name: 'Mart Clerk', faction: 'townsfolk', role: 'trainer', town: 'pewter',
    x: 2, y: 2, map: 'int:pewter_mart', sprite: 11,
    personality: 'A brisk Poké Mart shopkeeper.' }));
  add(npc({ id: 'archer', name: 'Archer', faction: 'rocket', role: 'rocket_officer', town: 'pewter',
    x: 4, y: 18, map: 'pewter', sprite: 8, attitude: -30,
    personality: 'Team Rocket executive running a quiet operation out of a Pewter warehouse. Fanatically loyal to Giovanni — though he never says the boss\'s name aloud. Calculating, polite, dangerous. Recruits promising trainers with money troubles.',
    party: [makeMonster('houndour', 13), makeMonster('gastly', 12)] }));
  add(npc({ id: 'elder_rosa', name: 'Elder Rosa', faction: 'townsfolk', role: 'trainer', town: 'pewter',
    x: 10, y: 12, map: 'pewter', sprite: 9, attitude: 15,
    personality: 'Pewter town elder. Remembers when the League was founded. Worried about Rocket influence growing in the warehouse district. Moral compass of the town.' }));

  const slots: Record<string, RoleSlot> = {
    gym_leader_viridian: { id: 'gym_leader_viridian', role: 'gym_leader', title: 'Viridian Gym Leader',
      holder: 'giovanni', town: 'viridian', requires: { defeatHolder: true, badges: 1, minRep: { league: 10 } } },
    gym_leader_pewter: { id: 'gym_leader_pewter', role: 'gym_leader', title: 'Pewter Gym Leader',
      holder: 'brock', town: 'pewter', requires: { defeatHolder: true, badges: 1, minRep: { league: 10 } } },
    champion: { id: 'champion', role: 'champion', title: 'League Champion',
      holder: null, town: null, requires: { badges: 2, minRep: { league: 40 } } },
    rocket_boss: { id: 'rocket_boss', role: 'rocket_boss', title: 'Boss of Team Rocket',
      holder: 'giovanni', town: null, requires: { minRep: { rocket: 60 }, defeatHolder: true, invitation: true } },
    head_ranger: { id: 'head_ranger', role: 'ranger', title: 'Head Ranger',
      holder: null, town: 'route1', requires: { minRep: { research: 30, civic: 20 }, invitation: true } },
  };

  const towns: Record<string, TownState> = {
    viridian: { id: 'viridian', name: 'Viridian City', prosperity: 55, rocketInfluence: 20, mood: 'quiet' },
    route1:   { id: 'route1',   name: 'Route 1',       prosperity: 20, rocketInfluence: 25, mood: 'wild' },
    pewter:   { id: 'pewter',   name: 'Pewter City',   prosperity: 70, rocketInfluence: 35, mood: 'uneasy' },
  };

  const buildings: Record<string, Building> = {
    viridian_gym:    { id: 'viridian_gym',    kind: 'gym',    name: 'Viridian Gym',     map: 'viridian', x: 12, y: 3,  w: 5, h: 4, owner: 'league',    condition: 'normal', builtOnDay: 0 },
    viridian_center: { id: 'viridian_center', kind: 'center', name: 'Pokémon Center',   map: 'viridian', x: 4,  y: 4,  w: 4, h: 3, owner: 'townsfolk', condition: 'normal', builtOnDay: 0 },
    viridian_lab:    { id: 'viridian_lab',    kind: 'lab',    name: "Oak's Field Lab",  map: 'viridian', x: 4,  y: 12, w: 4, h: 3, owner: 'rangers',   condition: 'normal', builtOnDay: 0 },
    viridian_inn:    { id: 'viridian_inn',    kind: 'house',  name: "Sal's Inn",        map: 'viridian', x: 16, y: 11, w: 4, h: 3, owner: 'townsfolk', condition: 'normal', builtOnDay: 0 },
    pewter_gym:      { id: 'pewter_gym',      kind: 'gym',    name: 'Pewter Gym',       map: 'pewter',   x: 13, y: 3,  w: 5, h: 4, owner: 'league',    condition: 'normal', builtOnDay: 0 },
    pewter_center:   { id: 'pewter_center',   kind: 'center', name: 'Pokémon Center',   map: 'pewter',   x: 5,  y: 4,  w: 4, h: 3, owner: 'townsfolk', condition: 'normal', builtOnDay: 0 },
    pewter_mart:     { id: 'pewter_mart',     kind: 'mart',   name: 'Poké Mart',        map: 'pewter',   x: 9,  y: 8,  w: 3, h: 3, owner: 'townsfolk', condition: 'normal', builtOnDay: 0 },
    rocket_warehouse:{ id: 'rocket_warehouse', kind: 'hideout', name: 'Old Warehouse',  map: 'pewter',   x: 3,  y: 15, w: 4, h: 3, owner: 'rocket',    condition: 'damaged', builtOnDay: 0 },
  };

  const state: WorldState = {
    day: 1,
    player: {
      name: 'You', x: 10, y: 12, map: 'pallet',
      roles: ['trainer'], badges: 0, money: 500,
      reputation: { league: 0, rocket: 0, civic: 0, research: 0 },
      party: [makeMonster('charmander', 8)],
      flags: {},
      story: 0,
      items: { potion: 3, pokeball: 5 },
    },
    npcs, slots, towns, buildings,
    dialogueCache: {},
    rng: { seed, cursors: {} },
    idSeq: {},
    events: [
      { day: 0, kind: 'world_news', summary: 'A new trainer set out from Pallet Town with a single Charmander.' },
    ],
    rumors: [
      'They say a great silver bird flies over the northern peaks at dawn — Lugia, if you believe old Oak.',
      'Rocket types have been hanging around the Pewter warehouse district.',
      'Nobody has ever seen Giovanni and the Rocket boss in the same room. Funny, that.',
    ],
    pendingOffers: [],
    entities: {},
    kernel: { lastFired: {}, channelDay: 0, channelUsed: {}, deferred: [] },
    connections: [],
    mapLayouts: {},
    rules: [],
  };
  // Build the rest of canonical Kanto (all towns/routes/dungeons/gyms beyond the
  // hand-authored core) from the kanto.ts graph, then derive the kernel Entity
  // substrate from the full world.
  generateKanto(state);
  state.entities = buildEntitiesFromWorld(state);
  return state;
}
