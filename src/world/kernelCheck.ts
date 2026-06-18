// P2 acceptance: prove the kernel execution contract holds. Each adversarial
// attack from the design review must be BLOCKED by a check here, plus legit
// accretion + reversible decay must work. Drive from the console:
// `window.__kernelCheck()`. Pure/detached — never touches localStorage.
import { createSeedWorld } from './seed';
import { runKernelTick, DEFAULT_CAP, type Rule } from './kernel';
import { structuralOps } from './structuralOps';
import type { WorldState } from './types';
import type { Entity } from './entity';
import { hasTag } from './entity';

function mkEnt(id: string, opts: Partial<Entity> = {}): Entity {
  return { id, type: opts.type ?? 'test', tags: opts.tags ?? [], attrs: opts.attrs ?? {}, magnitude: opts.magnitude ?? 0, relations: opts.relations ?? [], thresholds: opts.thresholds ?? [] };
}
// fresh detached world with a clean entity set for isolated kernel tests
function fresh(seed = 1): WorldState { const s = createSeedWorld(seed); s.entities = {}; return s; }
function tick(s: WorldState, rules: Rule[], days = 1) {
  for (let i = 0; i < days; i++) { const log = runKernelTick(s, rules); s.day += 1; if (i === days - 1) return log; }
  return runKernelTick(s, rules);
}
const mag = (s: WorldState, id: string) => s.entities[id].magnitude;
const controlled = (s: WorldState, id: string, faction: string) =>
  s.entities[id].relations.some(r => r.rel === 'controlledBy' && r.to === `faction:${faction}`);

interface Check { name: string; pass: boolean; detail: string; }
const checks: Check[] = [];
const check = (name: string, pass: boolean, detail = '') => checks.push({ name, pass, detail });

// 1) VELOCITY CAP: a rule demanding +100/day can only move a channel by DEFAULT_CAP.
function testVelocityCap() {
  const s = fresh(); s.entities['t:a'] = mkEnt('t:a', { magnitude: 0 });
  const rules: Rule[] = [{ id: 'r', when: { t: 'exists', id: 't:a' }, then: [{ t: 'addMagnitude', e: { id: 't:a' }, delta: 100 }], throttleDays: 0 }];
  runKernelTick(s, rules);
  check('velocity-cap: +100 demand clamped to cap', mag(s, 't:a') === DEFAULT_CAP, `magnitude=${mag(s, 't:a')} (want ${DEFAULT_CAP})`);
}

// 2) CASCADE-MINT BLOCKED: magnitude crossing fires addAttr(reach,+100); reach
// crossing would transfer control. Deferral must stop the second cross this tick,
// and the cap must throttle reach so control transfers only after real accretion.
function testCascadeBlocked() {
  const s = fresh();
  s.entities['territory:1'] = mkEnt('territory:1', { type: 'location' });
  s.entities['gang:x'] = mkEnt('gang:x', {
    type: 'faction', magnitude: 0, attrs: { reach: 0 },
    thresholds: [
      { channel: 'magnitude', level: 5, up: [{ t: 'addAttr', e: { var: 'each' }, key: 'reach', delta: 100 }], down: [] },
      { channel: 'reach', level: 50, up: [{ t: 'transferControl', e: { id: 'territory:1' }, toFaction: 'xgang' }], down: [] },
    ],
  });
  const rules: Rule[] = [{ id: 'push', when: { t: 'exists', id: 'gang:x' }, then: [{ t: 'addMagnitude', e: { id: 'gang:x' }, delta: 6 }], throttleDays: 0 }];
  // tick 1: magnitude 0->6 crosses 5; reach jump is DEFERRED -> reach stays 0, no transfer
  runKernelTick(s, rules); s.day += 1;
  const t1ok = s.entities['gang:x'].attrs.reach === 0 && !controlled(s, 'territory:1', 'xgang');
  // tick 2: deferred reach+100 lands but CAPPED to +6 -> reach=6, still no transfer
  runKernelTick(s, rules); s.day += 1;
  const reach2 = Number(s.entities['gang:x'].attrs.reach);
  const t2ok = reach2 === DEFAULT_CAP && !controlled(s, 'territory:1', 'xgang');
  check('cascade-mint: no same-tick second crossing', t1ok, `reach@t1=${s.entities['gang:x'].attrs.reach}, transferred=${controlled(s, 'territory:1', 'xgang')}`);
  check('cascade-mint: reach throttled by cap, no instant transfer', t2ok, `reach@t2=${reach2}, transferred=${controlled(s, 'territory:1', 'xgang')}`);
}

// 3) ONE CROSS PER CHANNEL PER TICK: a single +6 spanning two levels fires only one.
function testOneCrossPerTick() {
  const s = fresh();
  s.entities['t:b'] = mkEnt('t:b', {
    magnitude: 0,
    thresholds: [
      { channel: 'magnitude', level: 2, up: [{ t: 'setTag', e: { var: 'each' }, tag: 'L2' }], down: [] },
      { channel: 'magnitude', level: 4, up: [{ t: 'setTag', e: { var: 'each' }, tag: 'L4' }], down: [] },
    ],
  });
  const rules: Rule[] = [{ id: 'r', when: { t: 'exists', id: 't:b' }, then: [{ t: 'addMagnitude', e: { id: 't:b' }, delta: 6 }], throttleDays: 0 }];
  const log = runKernelTick(s, rules);
  const e = s.entities['t:b'];
  check('one-cross-per-tick: only highest level fires', hasTag(e, 'L4') && !hasTag(e, 'L2') && log.crossings.length === 1,
    `tags=${e.tags.join(',')} crossings=${log.crossings.length}`);
}

// 4) LEGIT ACCRETION + REVERSIBLE DECAY: climb to fortify, then neglect to revert.
function testAccretionAndDecay() {
  const s = fresh();
  s.entities['w'] = mkEnt('w', {
    type: 'location', magnitude: 0, attrs: { held: 1 },
    thresholds: [{ channel: 'magnitude', level: 30, up: [{ t: 'setTag', e: { var: 'each' }, tag: 'fortified' }], down: [{ t: 'clearTag', e: { var: 'each' }, tag: 'fortified' }] }],
  });
  const maintain: Rule = { id: 'maintain', when: { t: 'attrEquals', e: { id: 'w' }, key: 'held', v: 1 }, then: [{ t: 'addMagnitude', e: { id: 'w' }, delta: 6 }], throttleDays: 0 };
  const decay: Rule = { id: 'decay', when: { t: 'not', of: { t: 'attrEquals', e: { id: 'w' }, key: 'held', v: 1 } }, then: [{ t: 'addMagnitude', e: { id: 'w' }, delta: -5 }], throttleDays: 0 };
  const rules = [maintain, decay];
  tick(s, rules, 6); // +6/day -> 36, crosses 30
  const climbed = mag(s, 'w') >= 30 && hasTag(s.entities['w'], 'fortified');
  s.entities['w'].attrs.held = 0; // neglect
  tick(s, rules, 8); // -5/day -> below 30, crosses down
  const reverted = mag(s, 'w') < 30 && !hasTag(s.entities['w'], 'fortified');
  check('accretion: sustained tension fortifies', climbed, `mag=${mag(s, 'w')} fortified=${hasTag(s.entities['w'], 'fortified')}`);
  check('decay: neglect reverts the structural gain', reverted, `mag=${mag(s, 'w')} fortified=${hasTag(s.entities['w'], 'fortified')}`);
}

// 5) DETERMINISM: identical setup + ticks -> byte-identical entity state.
function testDeterminism() {
  const build = () => {
    const s = fresh(7);
    s.entities['w'] = mkEnt('w', { magnitude: 0, attrs: { held: 1 }, thresholds: [{ channel: 'magnitude', level: 12, up: [{ t: 'setTag', e: { var: 'each' }, tag: 'up' }], down: [] }] });
    s.entities['z'] = mkEnt('z', { magnitude: 0 });
    return s;
  };
  const rules: Rule[] = [
    { id: 'a', when: { t: 'attrEquals', e: { id: 'w' }, key: 'held', v: 1 }, then: [{ t: 'addMagnitude', e: { id: 'w' }, delta: 4 }, { t: 'addMagnitude', e: { id: 'z' }, delta: 3 }], throttleDays: 0 },
  ];
  const a = build(); tick(a, rules, 10);
  const b = build(); tick(b, rules, 10);
  check('determinism: identical ticks -> identical entities', JSON.stringify(a.entities) === JSON.stringify(b.entities), '');
}

// 6) TERMINATION: a mutually-triggering threshold pair must not hang; cross-entity
// bumps are deferred so each tick advances at most one hop, bounded by the cap.
function testTermination() {
  const s = fresh();
  s.entities['p'] = mkEnt('p', { magnitude: 4, thresholds: [{ channel: 'magnitude', level: 3, up: [{ t: 'addMagnitude', e: { id: 'q' }, delta: 6 }], down: [] }] });
  s.entities['q'] = mkEnt('q', { magnitude: 0, thresholds: [{ channel: 'magnitude', level: 3, up: [{ t: 'addMagnitude', e: { id: 'p' }, delta: 6 }], down: [] }] });
  let completed = true;
  try { tick(s, [], 5); } catch { completed = false; }
  // neither channel can exceed the cap per day regardless of the cycle
  const bounded = mag(s, 'p') <= 100 && mag(s, 'q') <= 100;
  check('termination: cyclic thresholds settle without hang', completed && bounded, `p=${mag(s, 'p')} q=${mag(s, 'q')}`);
}

// 7) PROTECTED SET: retire/transfer of a story-critical entity must be refused
// (a softlock would reload byte-identical forever), but work when unprotected.
function testProtectedSet() {
  const s = fresh();
  s.entities['npc:giovanni'] = mkEnt('npc:giovanni', { type: 'npc' });
  s.entities['territory:1'] = mkEnt('territory:1', { type: 'location' });
  const rules: Rule[] = [
    { id: 'retire', when: { t: 'exists', id: 'npc:giovanni' }, then: [{ t: 'retireEntity', e: { id: 'npc:giovanni' } }], throttleDays: 0 },
    { id: 'grab', when: { t: 'exists', id: 'territory:1' }, then: [{ t: 'transferControl', e: { id: 'territory:1' }, toFaction: 'x' }], throttleDays: 0 },
  ];
  runKernelTick(s, rules, { protectedIds: new Set(['npc:giovanni', 'territory:1']) });
  check('protected-set: retire of story-critical entity refused', !hasTag(s.entities['npc:giovanni'], '__retired'), `tags=${s.entities['npc:giovanni'].tags.join(',')}`);
  check('protected-set: transferControl of protected entity refused', !controlled(s, 'territory:1', 'x'), '');
  // sanity: unprotected, the same ops DO apply
  const s2 = fresh(); s2.entities['npc:giovanni'] = mkEnt('npc:giovanni', { type: 'npc' });
  runKernelTick(s2, [{ id: 'retire', when: { t: 'exists', id: 'npc:giovanni' }, then: [{ t: 'retireEntity', e: { id: 'npc:giovanni' } }], throttleDays: 0 }], {});
  check('protected-set: unprotected retire still works (not over-blocking)', hasTag(s2.entities['npc:giovanni'], '__retired'), '');
}

// 8) GEOMETRIC STRUCTURAL OPS: place a building (reachable), calve a location,
// wire a road — all through the kernel, all self-validating + deterministic.
function geomRules(): Rule[] {
  return [
    { id: 'a_build', when: { t: 'exists', id: 'town:pewter' }, then: [{ t: 'placeBuildingValidly', map: 'pewter', kind: 'hideout', owner: 'rocket', name: 'Den' }], throttleDays: 0 },
    { id: 'b_calve', when: { t: 'exists', id: 'town:pewter' }, then: [{ t: 'createLocation', newMapId: 'compound', seedMap: 'pewter', biome: 'urban', tags: ['player_holdfast'], name: 'The Compound' }], throttleDays: 0 },
    { id: 'c_road', when: { t: 'exists', id: 'town:pewter' }, then: [{ t: 'wireConnection', fromMap: 'compound', fromX: 12, fromY: 18, toMap: 'pewter', toX: 12, toY: 1 }], throttleDays: 0 },
  ];
}
function testGeometry() {
  const s = createSeedWorld(3);            // seed entities intact (town:pewter exists)
  const before = Object.keys(s.buildings).length;
  runKernelTick(s, geomRules(), { ops: structuralOps });
  const newBlds = Object.values(s.buildings).filter(b => b.map === 'pewter' && b.name === 'Den');
  const placed = Object.keys(s.buildings).length === before + 1 && newBlds.length === 1
    && !!s.entities[`bld:${newBlds[0]?.id}`];
  check('geometry: placeBuildingValidly adds one reachable building + entity', placed, `count ${before}->${Object.keys(s.buildings).length}`);
  const calved = !!s.mapLayouts['compound'] && !!s.towns['compound'] && !!s.entities['town:compound'];
  check('geometry: createLocation registers a renderable, entity-backed node', calved, '');
  const wired = s.connections.some(c => c.fromMap === 'compound' && c.toMap === 'pewter')
    && s.connections.some(c => c.fromMap === 'pewter' && c.toMap === 'compound');
  check('geometry: wireConnection lays a bidirectional link', wired, `conns=${s.connections.length}`);
  // determinism of the geometric path (seeded placement)
  const a = createSeedWorld(9); runKernelTick(a, geomRules(), { ops: structuralOps });
  const b = createSeedWorld(9); runKernelTick(b, geomRules(), { ops: structuralOps });
  check('geometry: deterministic placement/calving/wiring', JSON.stringify(a.buildings) === JSON.stringify(b.buildings) && JSON.stringify(a.mapLayouts) === JSON.stringify(b.mapLayouts) && JSON.stringify(a.connections) === JSON.stringify(b.connections), '');
}

export interface KernelCheckResult { ok: boolean; checks: Check[] }
export function runKernelCheck(): KernelCheckResult {
  checks.length = 0;
  testVelocityCap(); testCascadeBlocked(); testOneCrossPerTick();
  testAccretionAndDecay(); testDeterminism(); testTermination(); testProtectedSet(); testGeometry();
  const ok = checks.every(c => c.pass);
  // eslint-disable-next-line no-console
  console.log('[kernel] ' + (ok ? 'ALL PASS' : 'FAIL') + '\n' + checks.map(c => `${c.pass ? '✓' : '✗'} ${c.name}${c.pass ? '' : ' — ' + c.detail}`).join('\n'));
  return { ok, checks };
}
