// The kernel tick — the fixed instruction set that runs every playthrough.
//
// Authored bundles (per-playthrough, LLM-written) are expressed PURELY in the
// closed vocabulary below; the kernel evaluates them. This file implements the
// non-negotiable EXECUTION CONTRACT the adversarial review demanded:
//
//   1. The velocity cap is a property of the CHANNEL, not an effect. Every
//      numeric accretion write (addMagnitude / addAttr / clampedRep) routes
//      through ONE capped per-day accumulator shared across all triggers.
//      setAttr is forbidden on a channel that has a threshold table.
//   2. Two-phase, snapshot-based tick: evaluate every rule against a FROZEN
//      snapshot -> apply collected effects -> detect threshold crossings and
//      resolve them in a SEPARATE bounded pass, at most ONE cross per channel
//      per tick; channel writes fired BY thresholds are DEFERRED to next tick
//      (re-capped), which kills same-tick cascades AND guarantees termination.
//      forEach binds over a frozen, id-ordered match-set.
//   3. Determinism: total order by entity id everywhere; integer channels (no
//      IEEE-754 straddle); strict >= up-cross, < down-cross.
//
// (The protected-set + global-reachability invariants and the geometric
// structural ops land in the next steps; this file is the evaluator core and
// the non-geometric effects.)
import type { WorldState, KernelState } from './types';
import type { Entity, Ref, Predicate, Effect, Rule } from './entity';
import { hasTag, addTag, removeTag } from './entity';

export type { Ref, Predicate, Effect, Rule } from './entity';

export const DEFAULT_CAP = 6;        // max |delta| per channel per day
const CLAMP = { rep: [-100, 100] as const, other: [0, 100] as const };

const RETIRED = '__retired';       // kernel-reserved soft-delete tag

// ——— snapshot view ———
// Entities sorted by id give a TOTAL deterministic order for all iteration.
function entitiesById(state: WorldState): Entity[] {
  return Object.keys(state.entities).sort().map(id => state.entities[id]);
}
function live(e: Entity): boolean { return !hasTag(e, RETIRED); }

function resolveId(ref: Ref, each: string | null): string | null {
  if ('id' in ref) return ref.id;
  if ('var' in ref) return each;
  return null; // 'self' is meaningful only inside a threshold context; rules use explicit/each refs
}

function channelValue(e: Entity, channel: string): number {
  if (channel === 'magnitude') return e.magnitude;
  const v = e.attrs[channel];
  return typeof v === 'number' ? v : 0;
}
function setChannelValue(e: Entity, channel: string, v: number): void {
  if (channel === 'magnitude') e.magnitude = v; else e.attrs[channel] = v;
}
// A channel is any attr key (or 'magnitude') that some threshold table targets.
function channelsOf(e: Entity): string[] {
  return [...new Set(e.thresholds.map(t => t.channel))];
}
function isThresholdChannel(e: Entity, key: string): boolean {
  return e.thresholds.some(t => t.channel === key);
}

// ——— predicate evaluation (always against the frozen snapshot) ———
export function evalPredicate(snap: WorldState, p: Predicate, each: string | null): boolean {
  const ent = (ref: Ref): Entity | null => {
    const id = resolveId(ref, each);
    return id ? snap.entities[id] ?? null : null;
  };
  switch (p.t) {
    case 'and': return p.of.every(q => evalPredicate(snap, q, each));
    case 'or': return p.of.some(q => evalPredicate(snap, q, each));
    case 'not': return !evalPredicate(snap, p.of, each);
    case 'magnitudeAtLeast': { const e = ent(p.e); return !!e && live(e) && e.magnitude >= p.n; }
    case 'attrAtLeast': { const e = ent(p.e); return !!e && live(e) && channelValue(e, p.key) >= p.n; }
    case 'attrEquals': { const e = ent(p.e); return !!e && live(e) && e.attrs[p.key] === p.v; }
    case 'hasTag': { const e = ent(p.e); return !!e && live(e) && hasTag(e, p.tag); }
    case 'relationAtLeast': {
      const a = ent(p.a); const bId = resolveId(p.b, each);
      if (!a || !live(a) || !bId) return false;
      const edge = a.relations.find(r => r.to === bId && r.rel === p.rel);
      return !!edge && edge.weight >= p.n;
    }
    case 'playerHasRole': return snap.player.roles.includes(p.role as never);
    case 'playerRepAtLeast': return snap.player.reputation[p.axis] >= p.n;
    case 'playerControls': { const e = ent(p.e); return !!e && live(e) && e.relations.some(r => r.rel === 'controlledBy' && r.to === 'faction:player'); }
    case 'controlledBy': { const e = ent(p.e); return !!e && live(e) && e.relations.some(r => r.rel === 'controlledBy' && r.to === `faction:${p.faction}`); }
    case 'daysSince': {
      let last = -Infinity;
      for (const ev of snap.events) if (ev.kind === p.eventKey || ev.data?.key === p.eventKey) last = ev.day;
      return (snap.day - last) >= p.n;
    }
    case 'countMatching': {
      let c = 0;
      for (const e of entitiesById(snap)) if (live(e) && evalPredicate(snap, p.match, e.id)) c++;
      return c >= p.n;
    }
    case 'exists': { const e = snap.entities[p.id]; return !!e && live(e); }
  }
}

// ——— capped channel writes (the single accretion path) ———
function clampRange(channel: string): readonly [number, number] {
  return channel.startsWith('rep:') ? CLAMP.rep : CLAMP.other;
}
// Apply a capped delta to (entityId, channel) on the REAL state. Returns applied.
function capWrite(state: WorldState, entityId: string, channel: string, delta: number, cap = DEFAULT_CAP): number {
  const e = state.entities[entityId];
  if (!e || !live(e)) return 0;
  const key = `${entityId}|${channel}`;
  const used = state.kernel.channelUsed[key] ?? 0;
  const remaining = cap - Math.abs(used);
  if (remaining <= 0) return 0;
  const want = Math.trunc(delta);
  const applied = Math.sign(want) * Math.min(Math.abs(want), remaining);
  if (applied === 0) return 0;
  state.kernel.channelUsed[key] = used + Math.abs(applied);
  const [lo, hi] = clampRange(channel);
  setChannelValue(e, channel, Math.max(lo, Math.min(hi, channelValue(e, channel) + applied)));
  return applied;
}

// ——— effect application (non-threshold path: applied after the eval pass) ———
interface ApplyCtx { state: WorldState; each: string | null; fromThreshold: boolean; protectedIds: Set<string>; }
function applyEffect(eff: Effect, ctx: ApplyCtx): void {
  const { state, each } = ctx;
  const ent = (ref: Ref) => { const id = resolveId(ref, each); return id ? state.entities[id] ?? null : null; };
  switch (eff.t) {
    // ——— channel writes go through the capped path ———
    case 'addMagnitude': {
      const id = resolveId(eff.e, each); if (!id) return;
      if (ctx.fromThreshold) { state.kernel.deferred.push({ id, channel: 'magnitude', delta: eff.delta }); return; }
      capWrite(state, id, 'magnitude', eff.delta); return;
    }
    case 'addAttr': {
      const id = resolveId(eff.e, each); if (!id) return;
      const e = state.entities[id]; if (!e) return;
      if (isThresholdChannel(e, eff.key)) {
        if (ctx.fromThreshold) { state.kernel.deferred.push({ id, channel: eff.key, delta: eff.delta }); return; }
        capWrite(state, id, eff.key, eff.delta); return;
      }
      // plain numeric attr (no threshold table) — still capped to prevent farming
      capWrite(state, id, eff.key, eff.delta); return;
    }
    case 'clampedRep': {
      if (ctx.fromThreshold) { state.kernel.deferred.push({ id: 'player', channel: `rep:${eff.axis}`, delta: eff.delta }); return; }
      capWrite(state, 'player', `rep:${eff.axis}`, eff.delta);
      // mirror onto the typed player struct the renderer reads
      state.player.reputation[eff.axis] = Math.max(-100, Math.min(100, channelValue(state.entities['player'], `rep:${eff.axis}`)));
      return;
    }
    // ——— non-channel effects ———
    case 'setAttr': {
      const e = ent(eff.e); if (!e) return;
      if (isThresholdChannel(e, eff.key)) return; // FORBIDDEN: can't bypass the cap on a channel
      e.attrs[eff.key] = eff.v; return;
    }
    case 'addRelation': {
      const e = ent(eff.a); const bId = resolveId(eff.b, each); if (!e || !bId) return;
      const edge = e.relations.find(r => r.to === bId && r.rel === eff.rel);
      if (edge) edge.weight += eff.delta; else e.relations.push({ to: bId, rel: eff.rel, weight: eff.delta });
      return;
    }
    case 'setTag': { const e = ent(eff.e); if (e) addTag(e, eff.tag); return; }
    case 'clearTag': { const e = ent(eff.e); if (e) removeTag(e, eff.tag); return; }
    case 'logEvent': { state.events.push({ day: state.day, kind: eff.key, summary: eff.key, data: { key: eff.key } }); return; }
    case 'retireEntity': {
      const id = resolveId(eff.e, each); if (!id) return;
      if (ctx.protectedIds.has(id)) return;        // PROTECTED-SET: refuse — would softlock the story
      const e = state.entities[id]; if (e) addTag(e, RETIRED); return;
    }
    case 'transferControl': {
      const id = resolveId(eff.e, each); if (!id) return;
      if (ctx.protectedIds.has(id)) return;        // PROTECTED-SET: refuse control transfer of a story-critical entity
      const e = state.entities[id]; if (!e) return;
      e.relations = e.relations.filter(r => r.rel !== 'controlledBy');
      e.relations.push({ to: `faction:${eff.toFaction}`, rel: 'controlledBy', weight: 1 });
      return;
    }
    case 'spawnEntity': {
      if (state.entities[eff.id]) { removeTag(state.entities[eff.id], RETIRED); return; } // idempotent-by-id
      const rels = eff.atLocation && state.entities[eff.atLocation] ? [{ to: eff.atLocation, rel: 'in', weight: 1 }] : [];
      state.entities[eff.id] = { id: eff.id, type: eff.entityType, tags: [...new Set(eff.tags)].sort(), attrs: { ...eff.attrs }, magnitude: 0, relations: rels, thresholds: [] };
      return;
    }
  }
}

export interface KernelTickLog { firedRules: string[]; crossings: { id: string; channel: string; level: number; dir: 'up' | 'down' }[]; }
export interface TickOpts { protectedIds?: Set<string>; }

// ——— the tick ———
// Advances the kernel ONE day. The caller owns state.day; this reads it.
export function runKernelTick(state: WorldState, rules: Rule[], opts: TickOpts = {}): KernelTickLog {
  const k: KernelState = state.kernel;
  const protectedIds = opts.protectedIds ?? new Set<string>();
  // new day -> fresh velocity budget
  if (k.channelDay !== state.day) { k.channelDay = state.day; k.channelUsed = {}; }

  // FROZEN snapshot for ALL predicate evaluation this tick.
  const snap: WorldState = JSON.parse(JSON.stringify(state));

  // pre-tick channel values (for crossing detection), per thresholded channel.
  const pre: Record<string, number> = {};
  for (const e of entitiesById(state)) for (const ch of channelsOf(e)) pre[`${e.id}|${ch}`] = channelValue(e, ch);

  // carry in deferred cross-entity bumps from last tick (re-capped now).
  const carried = k.deferred; k.deferred = [];
  for (const d of carried) capWrite(state, d.id, d.channel, d.delta);

  // PASS 1 — evaluate every rule against the snapshot; apply effects to real state.
  const fired: string[] = [];
  for (const rule of [...rules].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const lastDay = k.lastFired[rule.id];
    if (lastDay !== undefined && (state.day - lastDay) < rule.throttleDays) continue;
    const bindings: (string | null)[] = rule.forEach
      ? entitiesById(snap).filter(e => live(e) && evalPredicate(snap, rule.forEach!, e.id)).map(e => e.id) // frozen, id-ordered
      : [null];
    let didFire = false;
    for (const each of bindings) {
      if (!evalPredicate(snap, rule.when, each)) continue;
      didFire = true;
      for (const eff of rule.then) applyEffect(eff, { state, each, fromThreshold: false, protectedIds });
    }
    if (didFire) { k.lastFired[rule.id] = state.day; fired.push(rule.id); }
  }

  // PASS 2 — threshold crossings: at most ONE level per channel this tick.
  // Threshold-fired CHANNEL writes are deferred (see applyEffect) so they cannot
  // cause a second crossing this tick -> no cascade, guaranteed termination.
  const crossings: KernelTickLog['crossings'] = [];
  for (const e of entitiesById(state)) {
    if (!live(e)) continue;
    for (const ch of channelsOf(e)) {
      const before = pre[`${e.id}|${ch}`] ?? channelValue(e, ch);
      const after = channelValue(e, ch);
      if (after === before) continue;
      const levels = e.thresholds.filter(t => t.channel === ch);
      if (after > before) {
        // highest level strictly crossed upward (>= after-side, > before-side)
        const crossed = levels.filter(t => before < t.level && after >= t.level).sort((a, b) => b.level - a.level)[0];
        if (crossed) { crossings.push({ id: e.id, channel: ch, level: crossed.level, dir: 'up' }); for (const eff of crossed.up) applyEffect(eff, { state, each: e.id, fromThreshold: true, protectedIds }); }
      } else {
        const crossed = levels.filter(t => after < t.level && before >= t.level).sort((a, b) => a.level - b.level)[0];
        if (crossed) { crossings.push({ id: e.id, channel: ch, level: crossed.level, dir: 'down' }); for (const eff of crossed.down) applyEffect(eff, { state, each: e.id, fromThreshold: true, protectedIds }); }
      }
    }
  }
  return { firedRules: fired, crossings };
}
