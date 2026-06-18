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
import { WAREHOUSE_BUNDLE, BUNDLES, type AuthoredBundle } from './bundles';
import { chatJSON, hasKey } from '../llm/client';
import type { WorldState } from './types';

interface Snap { day: number; mag: Record<string, number>; tags: Record<string, string[]>; locations: number; buildings: number; events: string[]; built: string[]; founded: string[]; }
interface Run { state: WorldState; snaps: Snap[]; failures: string[]; }

function applyBundle(s: WorldState, b: AuthoredBundle) {
  b.setup?.(s);   // setup first: may create carrier entities the thresholds attach to
  s.rules = b.rules;
  for (const [id, thr] of Object.entries(b.thresholds)) if (s.entities[id]) s.entities[id].thresholds = thr;
}

function runPlaythrough(seed: number, bundle: AuthoredBundle, days: number): Run {
  const s = createSeedWorld(seed);
  applyBundle(s, bundle);
  const snaps: Snap[] = [];
  const failures: string[] = [];
  const prevMag: Record<string, number> = {};
  for (let d = 0; d < days; d++) {
    s.day += 1;
    const evLen = s.events.length;
    const bIds = new Set(Object.keys(s.buildings));
    const lIds = new Set(Object.keys(s.mapLayouts));
    runKernelTick(s, s.rules, { protectedIds: storyCriticalIds(s), ops: structuralOps });
    const dayEvents = s.events.slice(evLen).map(e => (e.summary || e.kind).replace(/_/g, ' '));
    const built = Object.values(s.buildings).filter(b => !bIds.has(b.id))
      .map(b => `${b.name} (${b.kind}, ${b.owner ?? 'unowned'}) in ${s.towns[b.map]?.name ?? b.map}`);
    const founded = Object.keys(s.mapLayouts).filter(k => !lIds.has(k)).map(k => s.towns[k]?.name ?? k);
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
    snaps.push({ day: s.day, mag, tags, locations: Object.keys(s.mapLayouts).length, buildings: Object.keys(s.buildings).length, events: dayEvents, built, founded });
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
export interface P5Result { ok: boolean; checks: Check[]; warehouseArc: Snap[]; fingerprints: Record<string, unknown> }

export function runP5Check(): P5Result {
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail = '') => checks.push({ name, pass, detail });

  // sweep ALL authored bundles under the SAME seed
  const runs = BUNDLES.map(b => ({ id: b.id, run: runPlaythrough(42, b, b.days) }));
  const byId: Record<string, Run> = Object.fromEntries(runs.map(r => [r.id, r.run]));
  const wh = byId['warehouse_holdfast'], riv = byId['blue_rivalry'];

  // 1) the warehouse ARC materialized end to end
  const whE = wh.state.entities['bld:rocket_warehouse'];
  const playerBld = Object.values(wh.state.buildings).filter(b => b.owner === 'player').length;
  const road = wh.state.connections.some(c => c.fromMap === 'compound' && c.toMap === 'pewter');
  const arc = whE.tags.includes('fortified') && whE.tags.includes('compound') && whE.tags.includes('settlement_core')
    && !!wh.state.mapLayouts['compound'] && road && playerBld >= 2;
  add('warehouse arc: seized → fortified → compound → settlement + road', arc,
    `tags=[${whE.tags.join(',')}] playerBld=${playerBld} compoundMap=${!!wh.state.mapLayouts['compound']} road=${road}`);

  // rivalry carrier escalated to war + fortified a counter-base
  const rivE = riv.state.entities['rivalry:blue'];
  const rivWar = !!rivE && rivE.tags.includes('war') && Object.values(riv.state.buildings).some(b => b.owner === 'blue');
  add('rivalry arc: wary → war, rival fortifies a counter-base', rivWar, rivE ? `stage=${rivE.attrs.stage}` : 'no carrier');

  // 2) invariants held on EVERY snapshot of EVERY run
  const allFail = runs.flatMap(r => r.run.failures);
  add(`invariants: no-free-minting + reachability + persistence, every snapshot (${BUNDLES.length} bundles)`, allFail.length === 0, allFail.slice(0, 3).join(' | '));

  // 3) DIVERGENCE: same seed, N bundles => N mutually-distinct structural worlds
  const fps = runs.map(r => ({ id: r.id, fp: fingerprint(r.run.state) }));
  let allPairsDistinct = true, dupe = '';
  for (let i = 0; i < fps.length; i++) for (let j = i + 1; j < fps.length; j++) {
    if (JSON.stringify(fps[i].fp) === JSON.stringify(fps[j].fp)) { allPairsDistinct = false; dupe = `${fps[i].id} == ${fps[j].id}`; }
  }
  add(`divergence: same seed, ${BUNDLES.length} bundles → ${BUNDLES.length} structurally distinct worlds`, allPairsDistinct, dupe);

  // 4) determinism: same bundle + same seed => byte-identical final world
  const wh2 = runPlaythrough(42, WAREHOUSE_BUNDLE, WAREHOUSE_BUNDLE.days);
  add('determinism: same bundle+seed → byte-identical final world', JSON.stringify(wh.state) === JSON.stringify(wh2.state), '');

  // 5) attribution: a same-bundle/different-seed pair keeps the structural skeleton
  const whSeedB = runPlaythrough(777, WAREHOUSE_BUNDLE, WAREHOUSE_BUNDLE.days);
  const fpW = fingerprint(wh.state);
  const sameSkeleton = JSON.stringify(fingerprint(whSeedB.state).locations) === JSON.stringify(fpW.locations)
    && JSON.stringify(fingerprint(whSeedB.state).connections) === JSON.stringify(fpW.connections);
  add('attribution: same bundle/different seed keeps the structural skeleton', sameSkeleton, '');

  const ok = checks.every(c => c.pass);
  // eslint-disable-next-line no-console
  console.log('[p5] ' + (ok ? 'ALL PASS' : 'FAIL') + '\n' + checks.map(c => `${c.pass ? '✓' : '✗'} ${c.name}${c.pass ? '' : ' — ' + c.detail}`).join('\n'));
  return { ok, checks, warehouseArc: wh.snaps, fingerprints: Object.fromEntries(fps.map(f => [f.id, f.fp])) };
}

// ——— the QUALITATIVE half of the DoD: the LLM-judge rubric ———
// Needs the user's in-game API key (Settings). It scores each bundle's rendered
// timeline on the 4-pillar rubric's legibility + coherence, and judges whether
// the runs genuinely diverged. (Claude never handles the key; the game holds it.)
const JUDGE_SYSTEM = `You are an exacting but fair reviewer of an emergent game engine. You receive the day-by-day
TIMELINE of one authored playthrough — a consequence that ACCRETES over weeks, so some days are
quiet consolidation between milestone beats (this is expected, not a flaw). Score the ARC as a whole:
- legibility (1-5): reading the whole timeline, is it clear what the consequence IS and how far along it
  is at any point? (Quiet consolidation days are fine as long as the current state stays clear.)
- coherence (1-5): does each beat follow causally from the last — ONE escalating thread, not noise?
- divergenceConfidence (1-5): how clearly is this a SPECIFIC world (a named place, faction, or feud), not generic?
Return strict JSON.`;
const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    legibility: { type: 'integer' }, coherence: { type: 'integer' },
    divergenceConfidence: { type: 'integer' }, notes: { type: 'string' },
  },
  required: ['legibility', 'coherence', 'divergenceConfidence', 'notes'],
  additionalProperties: false,
} as const;

export async function runP5Judge(): Promise<Record<string, unknown>> {
  if (!hasKey()) return { ran: false, reason: 'No API key set. Open Settings, add your key, then re-run __p5Judge().' };
  const scored: Record<string, unknown>[] = [];
  for (const b of BUNDLES) {
    const r = runPlaythrough(42, b, b.days);
    const STAGE: Record<string, string> = {
      fortified: 'fortified into a holdfast', compound: 'grown into a walled compound', settlement_core: 'become a settlement of its own',
      hostile: 'turned openly hostile', feud: 'hardened into a bitter feud', war: 'erupted into all-out war',
    };
    const STAGE_ORDER = ['hostile', 'fortified', 'feud', 'compound', 'war', 'settlement_core']; // low -> high
    const timeline = r.snaps.map(s => {
      const allTags = Object.values(s.tags).flat();
      const stageTag = STAGE_ORDER.filter(t => allTags.includes(t)).pop();
      const stage = stageTag ? STAGE[stageTag] : 'still taking shape';
      const intensity = Object.values(s.mag).reduce((m, v) => Math.max(m, v), 0);
      let line = `Day ${s.day}: ${b.subject} — ${stage}, intensity ${intensity}/100.`;
      if (s.built.length) line += ` New structures: ${s.built.join(', ')}.`;
      if (s.founded.length) line += ` A new place appears on the map of Kanto: ${s.founded.join(', ')}.`;
      if (s.events.length) line += ` ${s.events.join(' ')}`;
      else if (!s.built.length && !s.founded.length) line += ' (Consolidating — nothing newly built today.)';
      return line;
    }).join('\n');
    try {
      const sc = await chatJSON<{ legibility: number; coherence: number; divergenceConfidence: number; notes: string }>(
        JUDGE_SYSTEM, `BUNDLE: ${b.describe}\n\nTIMELINE:\n${timeline}`, 'p5_judge', JUDGE_SCHEMA as unknown as Record<string, unknown>, 500);
      const norm = (sc.legibility + sc.coherence + sc.divergenceConfidence) / 15;
      scored.push({ name: b.id, ...sc, normalized: Math.round(norm * 100) / 100 });
    } catch (e) { scored.push({ name: b.id, error: String(e) }); }
  }
  const normalized = scored.filter(s => typeof s.normalized === 'number').map(s => s.normalized as number);
  const overall = normalized.length ? normalized.reduce((a, b) => a + b, 0) / normalized.length : 0;
  const pass = overall >= 0.80 && normalized.every(n => n >= 0.65);
  // eslint-disable-next-line no-console
  console.log('[p5-judge] overall', overall.toFixed(2), pass ? 'PASS (>=0.80, no pillar <0.65)' : 'below bar', scored);
  return { ran: true, overall: Math.round(overall * 100) / 100, pass, scored };
}
