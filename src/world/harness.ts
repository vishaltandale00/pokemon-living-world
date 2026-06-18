// The simulation harness (P4). A driver (me-with-personas now, an LLM-player
// later) reasons over observe(), drives the real engine via act() — which maps
// 1:1 onto the real triggers, including a resolveBattle seam since an automated
// policy can't play the real-time action fight — and the recorder captures a
// render-at-state snapshot per step. Installed in the GAME's module context so
// it shares the real `world` singleton (console dynamic-imports do NOT).
import { world } from './store';
import type { Rule } from './entity';
import { runWorldTick } from '../llm/director';
import { applyBattleOutcome, type BattleOutcome, type OutcomeCtx } from './battleOutcome';

// A read-only structured projection a policy/judge can reason over — the same
// world facts the sim runs on, nothing privileged.
export function observe() {
  const s = world.state;
  const p = s.player;
  const accretors = Object.values(s.entities)
    .filter(e => e.magnitude > 0 || e.thresholds.length > 0 || e.tags.some(t => t !== 'building' && t !== 'town'))
    .map(e => ({ id: e.id, type: e.type, magnitude: e.magnitude, tags: e.tags, attrs: e.attrs }));
  return {
    day: s.day,
    player: { map: p.map, x: p.x, y: p.y, roles: p.roles, badges: p.badges, money: p.money, reputation: { ...p.reputation } },
    towns: Object.values(s.towns).map(t => ({ id: t.id, prosperity: t.prosperity, rocketInfluence: t.rocketInfluence, mood: t.mood })),
    slots: Object.values(s.slots).map(sl => ({ id: sl.id, title: sl.title, holder: sl.holder })),
    buildings: Object.values(s.buildings).map(b => ({ id: b.id, kind: b.kind, map: b.map, owner: b.owner, condition: b.condition })),
    locations: Object.keys(s.mapLayouts),
    connections: s.connections.length,
    accretors,
    recentEvents: world.recentEvents(8).map(e => `D${e.day} ${e.summary}`),
    rulesLoaded: s.rules.length,
  };
}

// The ONLY mutation surface. Each command maps to a real trigger or the battle seam.
export async function act(cmd: { type: string; [k: string]: unknown }): Promise<Record<string, unknown>> {
  const s = world.state;
  switch (cmd.type) {
    case 'endDay': {                                   // dayTick: Director + kernel tick
      const r = await runWorldTick();
      return { ok: true, day: s.day, headlines: r.headlines, usedLLM: r.usedLLM };
    }
    case 'resolveBattle': {                            // the deterministic battle seam
      const msg = applyBattleOutcome(cmd.outcome as BattleOutcome, (cmd.ctx ?? {}) as OutcomeCtx);
      return { ok: true, msg };
    }
    case 'loadBundle': {                               // admit an authored rule bundle
      s.rules = (cmd.rules as Rule[]) ?? [];
      world.save();
      return { ok: true, rulesLoaded: s.rules.length };
    }
    case 'setControl': {                               // scenario lever: who controls an entity
      const e = s.entities[cmd.id as string];
      if (e) {
        e.relations = e.relations.filter(r => r.rel !== 'controlledBy');
        e.relations.push({ to: `faction:${cmd.faction as string}`, rel: 'controlledBy', weight: 1 });
        world.save();
      }
      return { ok: !!e };
    }
    case 'setAttr': {                                  // scenario lever: set an entity attr
      const e = s.entities[cmd.id as string];
      if (e && typeof cmd.key === 'string') { e.attrs[cmd.key] = cmd.value as number | string | boolean; world.save(); }
      return { ok: !!e };
    }
    default:
      return { ok: false, error: `unknown act: ${cmd.type}` };
  }
}

// The render-at-state record: machine-checkable world clone + the live canvas PNG.
export function snapshot(): { day: number; world: unknown; png: string | null } {
  const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
  return {
    day: world.state.day,
    world: JSON.parse(JSON.stringify(world.state)),
    png: canvas ? canvas.toDataURL('image/png') : null,
  };
}

export function installHarness(): void {
  (window as { harness?: unknown }).harness = { observe, act, snapshot };
}
