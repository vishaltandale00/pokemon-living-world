// Authored language BUNDLES — the per-playthrough content the kernel runs.
// In production an LLM authors these (during the nightly world-load) PURELY in
// the closed DSL; here they're hand-written examples that prove the SAME fixed
// engine yields structurally DIFFERENT worlds. A bundle = rules + per-entity
// threshold ladders + an optional one-time setup (the seed condition the player
// established through play, e.g. "seized the warehouse").
import type { Rule, Threshold } from './entity';
import type { WorldState } from './types';

export interface AuthoredBundle {
  id: string;
  describe: string;
  days: number;                            // in-game days to drive the arc to its top threshold
  rules: Rule[];
  thresholds: Record<string, Threshold[]>;
  setup?: (s: WorldState) => void;
}

const WAREHOUSE = 'bld:rocket_warehouse';

// SHAPE A — a place hardening. Sustained control of the seized warehouse accretes
// entrenchment; thresholds harden it into a fortified compound, then calve a new
// off-map settlement reached by a road. Neglect (losing control) decays it back.
export const WAREHOUSE_BUNDLE: AuthoredBundle = {
  id: 'warehouse_holdfast',
  describe: 'The player seizes the Pewter warehouse and entrenches it into a compound, then a settlement.',
  days: 16,
  setup: (s) => {
    const e = s.entities[WAREHOUSE];
    if (e && !e.relations.some(r => r.rel === 'controlledBy' && r.to === 'faction:player')) {
      e.relations.push({ to: 'faction:player', rel: 'controlledBy', weight: 1 });
    }
  },
  rules: [
    { id: 'entrench', when: { t: 'playerControls', e: { id: WAREHOUSE } }, then: [{ t: 'addMagnitude', e: { id: WAREHOUSE }, delta: 6 }], throttleDays: 0 },
    { id: 'decay', when: { t: 'not', of: { t: 'playerControls', e: { id: WAREHOUSE } } }, then: [{ t: 'addMagnitude', e: { id: WAREHOUSE }, delta: -5 }], throttleDays: 0 },
  ],
  thresholds: {
    [WAREHOUSE]: [
      { channel: 'magnitude', level: 30, up: [{ t: 'setTag', e: { var: 'each' }, tag: 'fortified' }, { t: 'logEvent', key: 'compound_fortified' }], down: [{ t: 'clearTag', e: { var: 'each' }, tag: 'fortified' }] },
      { channel: 'magnitude', level: 55, up: [{ t: 'setTag', e: { var: 'each' }, tag: 'compound' }, { t: 'placeBuildingValidly', map: 'pewter', kind: 'house', owner: 'player', name: 'Barracks' }, { t: 'placeBuildingValidly', map: 'pewter', kind: 'mart', owner: 'player', name: 'Supply Depot' }, { t: 'logEvent', key: 'compound_grows' }], down: [{ t: 'clearTag', e: { var: 'each' }, tag: 'compound' }] },
      { channel: 'magnitude', level: 80, up: [{ t: 'setTag', e: { var: 'each' }, tag: 'settlement_core' }, { t: 'createLocation', newMapId: 'compound', seedMap: 'pewter', biome: 'urban', tags: ['player_holdfast'], name: 'The Compound' }, { t: 'logEvent', key: 'settlement_founded' }], down: [] },
      { channel: 'magnitude', level: 88, up: [{ t: 'wireConnection', fromMap: 'compound', fromX: 12, fromY: 18, toMap: 'pewter', toX: 12, toY: 1 }, { t: 'placeBuildingValidly', map: 'compound', kind: 'center', owner: 'player', name: 'Compound Center' }, { t: 'logEvent', key: 'road_to_pewter' }], down: [] },
    ],
  },
};

// SHAPE B — a faction's reach spreading (a deliberately DIFFERENT shape, for the
// divergence check). Team Rocket's grip accretes and plants hideouts across towns,
// raising organized-crime influence. No new location, no player holdings — a
// structurally distinct world from the warehouse arc under the same seed.
export const GANG_BUNDLE: AuthoredBundle = {
  id: 'rocket_spread',
  describe: "Team Rocket's reach accretes and plants hideouts across Kanto's towns.",
  days: 14,
  rules: [
    { id: 'spread', when: { t: 'exists', id: 'faction:rocket' }, then: [{ t: 'addMagnitude', e: { id: 'faction:rocket' }, delta: 6 }], throttleDays: 0 },
  ],
  thresholds: {
    'faction:rocket': [
      { channel: 'magnitude', level: 30, up: [{ t: 'placeBuildingValidly', map: 'viridian', kind: 'hideout', owner: 'rocket', name: 'Rocket Cell' }, { t: 'addAttr', e: { id: 'town:viridian' }, key: 'rocketInfluence', delta: 6 }, { t: 'logEvent', key: 'rocket_grips_viridian' }], down: [] },
      { channel: 'magnitude', level: 60, up: [{ t: 'placeBuildingValidly', map: 'pewter', kind: 'hideout', owner: 'rocket', name: 'Rocket Den' }, { t: 'addAttr', e: { id: 'town:pewter' }, key: 'rocketInfluence', delta: 6 }, { t: 'logEvent', key: 'rocket_grips_pewter' }], down: [] },
    ],
  },
};

// SHAPE C — a rivalry escalating (relational, via a REIFIED carrier entity; the
// ruling was: model abstract things AS entities, never magnitude-on-edges). HEAT
// accretes on the carrier; thresholds walk it wary -> hostile -> feud -> war, the
// one geometric beat being the rival fortifying a counter-base. Distinct again.
export const RIVALRY_BUNDLE: AuthoredBundle = {
  id: 'blue_rivalry',
  describe: 'The feud with Blue escalates from wary to all-out war; at war he fortifies a counter-base.',
  days: 14,
  setup: (s) => {
    s.entities['rivalry:blue'] = {
      id: 'rivalry:blue', type: 'rivalry', tags: ['feud'], attrs: { stage: 'wary', rival: 'npc:blue' }, magnitude: 0,
      relations: [{ to: 'player', rel: 'grievance', weight: 1 }, { to: 'npc:blue', rel: 'grievance', weight: 1 }],
      thresholds: [
        { channel: 'magnitude', level: 25, up: [{ t: 'setTag', e: { var: 'each' }, tag: 'hostile' }, { t: 'setAttr', e: { var: 'each' }, key: 'stage', v: 'hostile' }, { t: 'logEvent', key: 'rivalry_hostile' }], down: [] },
        { channel: 'magnitude', level: 50, up: [{ t: 'setTag', e: { var: 'each' }, tag: 'feud' }, { t: 'setAttr', e: { var: 'each' }, key: 'stage', v: 'feud' }, { t: 'logEvent', key: 'rivalry_feud' }], down: [] },
        { channel: 'magnitude', level: 75, up: [{ t: 'setTag', e: { var: 'each' }, tag: 'war' }, { t: 'setAttr', e: { var: 'each' }, key: 'stage', v: 'war' }, { t: 'placeBuildingValidly', map: 'viridian', kind: 'hideout', owner: 'blue', name: 'Rival Counter-Base' }, { t: 'logEvent', key: 'rivalry_war' }], down: [] },
      ],
    };
  },
  rules: [
    { id: 'escalate', when: { t: 'exists', id: 'rivalry:blue' }, then: [{ t: 'addMagnitude', e: { id: 'rivalry:blue' }, delta: 6 }], throttleDays: 0 },
  ],
  thresholds: {},
};

// SHAPE D — a protective institution. Rangers turn Route 1 into a protected wild
// sanctuary that calves its own grounds. Distinct: a NEW location seeded from a
// route (not a town), ranger-owned, no crime, no player holdings.
const ROUTE1 = 'town:route1';
export const RANGER_BUNDLE: AuthoredBundle = {
  id: 'ranger_sanctuary',
  describe: 'Rangers turn Route 1 into a protected wild sanctuary with its own grounds.',
  days: 14,
  rules: [
    { id: 'protect', when: { t: 'exists', id: ROUTE1 }, then: [{ t: 'addMagnitude', e: { id: ROUTE1 }, delta: 6 }], throttleDays: 0 },
  ],
  thresholds: {
    [ROUTE1]: [
      { channel: 'magnitude', level: 40, up: [{ t: 'placeBuildingValidly', map: 'route1', kind: 'lab', owner: 'rangers', name: 'Ranger Station' }, { t: 'logEvent', key: 'ranger_station' }], down: [] },
      { channel: 'magnitude', level: 70, up: [{ t: 'createLocation', newMapId: 'sanctuary', seedMap: 'route1', biome: 'forest', tags: ['ranger_sanctuary'], name: 'Wild Sanctuary' }, { t: 'wireConnection', fromMap: 'sanctuary', fromX: 12, fromY: 18, toMap: 'route1', toX: 12, toY: 1 }, { t: 'logEvent', key: 'sanctuary_opens' }], down: [] },
    ],
  },
};

// SHAPE E — an economic boom (no conflict, no calving). Viridian's prosperity
// compounds into new homes and shops. Distinct: townsfolk-owned growth, no
// location, no faction takeover — a peaceful world.
const VIRIDIAN = 'town:viridian';
export const BOOM_BUNDLE: AuthoredBundle = {
  id: 'viridian_boom',
  describe: 'Viridian booms — new homes and shops rise as prosperity compounds.',
  days: 13,
  rules: [
    { id: 'boom', when: { t: 'exists', id: VIRIDIAN }, then: [{ t: 'addMagnitude', e: { id: VIRIDIAN }, delta: 6 }], throttleDays: 0 },
  ],
  thresholds: {
    [VIRIDIAN]: [
      { channel: 'magnitude', level: 35, up: [{ t: 'placeBuildingValidly', map: 'viridian', kind: 'house', owner: 'townsfolk', name: 'New Homes' }, { t: 'logEvent', key: 'viridian_grows' }], down: [] },
      { channel: 'magnitude', level: 65, up: [{ t: 'placeBuildingValidly', map: 'viridian', kind: 'mart', owner: 'townsfolk', name: 'Market Row' }, { t: 'logEvent', key: 'viridian_thrives' }], down: [] },
    ],
  },
};

export const BUNDLES: AuthoredBundle[] = [WAREHOUSE_BUNDLE, GANG_BUNDLE, RIVALRY_BUNDLE, RANGER_BUNDLE, BOOM_BUNDLE];
