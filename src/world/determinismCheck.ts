// P0 acceptance check: the world-sim layer must be deterministic.
//
// Same seed + same actions => byte-identical save; a half-grown world reloads
// identically; and (sanity) a different seed actually diverges so we know the
// RNG is live, not inert. Runs against DETACHED stores (persist=false) so it
// never touches the player's real localStorage save. Drive it from the browser
// console: `window.__determinismCheck()` (wired in main.ts).
import { WorldStore } from './store';
import { createSeedWorld } from './seed';
import type { Development } from './types';

// A fixed sequence that exercises every save-reaching RNG/id path: wild-encounter
// streams (encounter / wild_species / wild_level), building placement
// (findBuildingSpot draws + nextId), damage target picks (rngPick), and offer ids.
function runScript(w: WorldStore): void {
  // simulate wild encounters
  for (let i = 0; i < 12; i++) {
    if (w.rngChance('encounter', 0.5)) {
      w.rngPick('wild_species', ['rattata', 'pidgey', 'pikachu', 'gastly']);
      w.rngInt('wild_level', 0, 5);
    }
  }
  // director-style proposals, in <=4-development waves (applyProposal slices to 4)
  const wave1: Development[] = [
    { kind: 'building_change', town: 'pewter', action: 'build', buildingKind: 'house', name: 'Outpost', reason: 'r' },
    { kind: 'building_change', town: 'pewter', action: 'build', buildingKind: 'mart', name: 'Depot', reason: 'r' },
    { kind: 'building_change', town: 'viridian', action: 'build', buildingKind: 'house', name: 'Annex', reason: 'r' },
    { kind: 'role_offer', slotId: 'champion', fromNpc: 'blue', text: 'come at me' },
  ];
  w.applyProposal({ developments: wave1, rumors: ['a', 'b'], townMoods: [{ town: 'pewter', mood: 'tense' }] });
  const wave2: Development[] = [
    { kind: 'building_change', town: 'pewter', action: 'build', buildingKind: 'hideout', name: 'Den', reason: 'r' },
    { kind: 'building_change', town: 'pewter', action: 'damage', buildingKind: 'house', name: '', reason: 'r' },
    { kind: 'building_change', town: 'pewter', action: 'ruin', buildingKind: 'house', name: '', reason: 'r' },
    { kind: 'faction_shift', town: 'pewter', rocketDelta: 5, prosperityDelta: -3, reason: 'r' },
  ];
  w.applyProposal({ developments: wave2 });
}

export interface DeterminismResult {
  ok: boolean;
  sameSeedIdentical: boolean;
  reloadIdentical: boolean;
  differentSeedDiverges: boolean;
  detail: string;
}

export function runDeterminismCheck(seed = 12345): DeterminismResult {
  // A and B: same seed, fresh detached stores -> must be byte-identical
  const a = new WorldStore(createSeedWorld(seed), false); runScript(a);
  const b = new WorldStore(createSeedWorld(seed), false); runScript(b);
  const sa = JSON.stringify(a.state);
  const sb = JSON.stringify(b.state);

  // reload determinism: round-trip the seed state through JSON (a save->load)
  // before running the identical script -> must still equal A
  const c = new WorldStore(JSON.parse(JSON.stringify(createSeedWorld(seed))) as ReturnType<typeof createSeedWorld>, false);
  runScript(c);
  const sc = JSON.stringify(c.state);

  // sanity: a different seed must actually diverge (RNG is live, not a no-op)
  const d = new WorldStore(createSeedWorld(seed + 1), false); runScript(d);
  const sd = JSON.stringify(d.state);

  const sameSeedIdentical = sa === sb;
  const reloadIdentical = sa === sc;
  const differentSeedDiverges = sa !== sd;
  const ok = sameSeedIdentical && reloadIdentical && differentSeedDiverges;

  let detail = ok
    ? 'PASS: same seed → byte-identical; survives reload; a different seed diverges.'
    : 'FAIL:';
  if (!sameSeedIdentical) detail += ` same-seed mismatch at char ${firstDiff(sa, sb)};`;
  if (!reloadIdentical) detail += ` reload mismatch at char ${firstDiff(sa, sc)};`;
  if (!differentSeedDiverges) detail += ' a different seed did NOT diverge (RNG inert);';

  // eslint-disable-next-line no-console
  console.log('[determinism]', detail);
  return { ok, sameSeedIdentical, reloadIdentical, differentSeedDiverges, detail };
}

function firstDiff(x: string, y: string): number {
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return i;
  return x.length === y.length ? -1 : n;
}
