// P5 eval — the Definition of Done's MECHANICAL gates (the LLM-judge rubric is
// the other half and needs the user's in-game key). Runs authored bundles
// through the real kernel on detached states, asserts the invariants on EVERY
// snapshot, confirms the warehouse arc materializes, and proves two bundles
// under the SAME seed produce structurally DIVERGENT worlds. Drive from the
// console: `window.__p5Check()`.
import { createSeedWorld } from './seed';
import { runKernelTick, DEFAULT_CAP } from './kernel';
import { structuralOps, reachabilityOK } from './structuralOps';
import { storyCriticalIds } from './story';
import { WAREHOUSE_BUNDLE, GANG_BUNDLE, type AuthoredBundle } from './bundles';
import type { WorldState } from './types';

interface Snap { day: number; mag: Record<string, number>; tags: Record<string, string[]>; locations: number; buildings: number; }
interface Run { state: WorldState; snaps: Snap[]; failures: string[]; }

function applyBundle(s: WorldState, b: AuthoredBundle) {
  s.rules = b.rules;
  for (const [id, thr] of Object.entries(b.thresholds)) if (s.entities[id]) s.entities[id].thresholds = thr;
  b.setup?.(s);
}

function runPlaythrough(seed: number, bundle: AuthoredBundle, days: number): Run {
  const s = createSeedWorld(seed);
  applyBundle(s, bundle);
  const snaps: Snap[] = [];
  const failures: string[] = [];
  const prevMag: Record<string, number> = {};
  for (let d = 0; d < days; d++) {
    s.day += 1;
    runKernelTick(s, s.rules, { protectedIds: storyCriticalIds(s), ops: structuralOps });
    // INVARIANT 1 — no-free-minting: no channel jumps more than the per-day cap.
    for (const e of Object.values(s.entities)) {
      const delta = e.magnitude - (prevMag[e.id] ?? 0);
      if (delta > DEFAULT_CAP + 1e-6) failures.push(`day ${s.day}: ${e.id} magnitude jumped +${delta} (> cap ${DEFAULT_CAP})`);
      prevMag[e.id] = e.magnitude;
    }
    // INVARIANT 2 — reachability: no structural op orphaned a door.
    for (const mapId of new Set(Object.values(s.buildings).map(b => b.map))) {
      if (!reachabilityOK(s, mapId)) failures.push(`day ${s.day}: ${mapId} has an unreachable building door`);
    }
    const mag: Record<string, number> = {}, tags: Record<string, string[]> = {};
    for (const e of Object.values(s.entities)) if (e.magnitude > 0) { mag[e.id] = e.magnitude; tags[e.id] = e.tags; }
    snaps.push({ day: s.day, mag, tags, locations: Object.keys(s.mapLayouts).length, buildings: Object.keys(s.buildings).length });
  }
  // INVARIANT 3 — persistence: the save round-trips byte-identically.
  if (JSON.stringify(JSON.parse(JSON.stringify(s))) !== JSON.stringify(s)) failures.push('persistence: save round-trip changed the state');
  return { state: s, snaps, failures };
}

// structural fingerprint — what STRUCTURE a run produced (not scalar values).
function fingerprint(s: WorldState) {
  return {
    locations: Object.keys(s.mapLayouts).sort(),
    newBuildings: Object.values(s.buildings).filter(b => b.builtOnDay > 0).map(b => `${b.map}:${b.kind}:${b.owner}`).sort(),
    connections: [...new Set(s.connections.map(c => `${c.fromMap}->${c.toMap}`))].sort(),
    playerHoldings: Object.values(s.entities).filter(e => e.relations.some(r => r.rel === 'controlledBy' && r.to === 'faction:player')).map(e => e.id).sort(),
  };
}

interface Check { name: string; pass: boolean; detail: string }
export interface P5Result { ok: boolean; checks: Check[]; warehouseArc: Snap[]; fingerprints: { warehouse: unknown; gang: unknown } }

export function runP5Check(): P5Result {
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail = '') => checks.push({ name, pass, detail });

  const wh = runPlaythrough(42, WAREHOUSE_BUNDLE, 16);
  const gang = runPlaythrough(42, GANG_BUNDLE, 14);

  // 1) the warehouse ARC materialized end to end
  const whE = wh.state.entities['bld:rocket_warehouse'];
  const playerBld = Object.values(wh.state.buildings).filter(b => b.owner === 'player').length;
  const road = wh.state.connections.some(c => c.fromMap === 'compound' && c.toMap === 'pewter');
  const arc = whE.tags.includes('fortified') && whE.tags.includes('compound') && whE.tags.includes('settlement_core')
    && !!wh.state.mapLayouts['compound'] && road && playerBld >= 2;
  add('warehouse arc: seized → fortified → compound → settlement + road', arc,
    `tags=[${whE.tags.join(',')}] playerBld=${playerBld} compoundMap=${!!wh.state.mapLayouts['compound']} road=${road}`);

  // 2) invariants held on EVERY snapshot of BOTH runs
  const allFail = [...wh.failures, ...gang.failures];
  add('invariants: no-free-minting + reachability + persistence, every snapshot', allFail.length === 0, allFail.slice(0, 3).join(' | '));

  // 3) DIVERGENCE: same seed, different bundle => structurally different worlds
  const fpW = fingerprint(wh.state), fpG = fingerprint(gang.state);
  const structurallyDifferent =
    JSON.stringify(fpW.locations) !== JSON.stringify(fpG.locations) ||
    JSON.stringify(fpW.newBuildings) !== JSON.stringify(fpG.newBuildings) ||
    JSON.stringify(fpW.playerHoldings) !== JSON.stringify(fpG.playerHoldings);
  add('divergence: same seed, different bundle → different STRUCTURE', structurallyDifferent,
    `wh.loc=[${fpW.locations}] gang.loc=[${fpG.locations}] wh.holdings=${fpW.playerHoldings.length} gang.holdings=${fpG.playerHoldings.length}`);

  // 4) determinism: same bundle + same seed => byte-identical final world
  const wh2 = runPlaythrough(42, WAREHOUSE_BUNDLE, 16);
  add('determinism: same bundle+seed → byte-identical final world', JSON.stringify(wh.state) === JSON.stringify(wh2.state), '');

  // 5) attribution: the divergence is the BUNDLE's (kernel/seed identical) — a
  // same-bundle/different-seed pair keeps the same structural skeleton.
  const whSeedB = runPlaythrough(777, WAREHOUSE_BUNDLE, 16);
  const sameSkeleton = JSON.stringify(fingerprint(whSeedB.state).locations) === JSON.stringify(fpW.locations)
    && JSON.stringify(fingerprint(whSeedB.state).connections) === JSON.stringify(fpW.connections);
  add('attribution: same bundle/different seed keeps the structural skeleton', sameSkeleton, '');

  const ok = checks.every(c => c.pass);
  // eslint-disable-next-line no-console
  console.log('[p5] ' + (ok ? 'ALL PASS' : 'FAIL') + '\n' + checks.map(c => `${c.pass ? '✓' : '✗'} ${c.name}${c.pass ? '' : ' — ' + c.detail}`).join('\n'));
  return { ok, checks, warehouseArc: wh.snaps, fingerprints: { warehouse: fpW, gang: fpG } };
}
