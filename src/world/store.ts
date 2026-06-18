import type { WorldState, WorldEvent, Development, RoleSlot, Reputation, Building } from './types';
import { createSeedWorld } from './seed';
import { nextUnit } from './rng';
import { buildEntitiesFromWorld } from './entity';

// The simulation core. Owns the world state, validates ALL mutations
// (including LLM director proposals), persists to localStorage.

const SAVE_KEY = 'living-kanto-save-v1';

export class WorldStore {
  state: WorldState;
  private listeners: (() => void)[] = [];
  private persist: boolean;

  // `persist` defaults true (the real game, backed by localStorage). Pass an
  // explicit `initial` state + persist=false to get a detached store for tests
  // and the determinism check — it never touches localStorage.
  constructor(initial?: WorldState, persist = true) {
    this.persist = persist;
    this.state = initial ?? this.load() ?? createSeedWorld();
  }

  // ——— persistence ———
  private load(): WorldState | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const state = JSON.parse(raw) as WorldState;
      // migrate older saves that predate later features
      const p = state.player;
      if (p) {
        if (p.story === undefined) p.story = 0;
        if (!p.items) p.items = { potion: 3, pokeball: 5 };
        for (const m of p.party ?? []) if (m.xp === undefined) m.xp = 0;
        for (const npc of Object.values(state.npcs ?? {}))
          for (const m of npc.party ?? []) if (m.xp === undefined) m.xp = 0;
      }
      if (!state.dialogueCache) state.dialogueCache = {};
      // determinism anchors for saves that predate P0
      if (!state.rng) state.rng = { seed: 1, cursors: {} };
      if (!state.idSeq) state.idSeq = {};
      // kernel Entity substrate for saves that predate P1 (derive from structs)
      if (!state.entities) state.entities = buildEntitiesFromWorld(state);
      // kernel runtime for saves that predate P2
      if (!state.kernel) state.kernel = { lastFired: {}, channelDay: 0, channelUsed: {}, deferred: [] };
      // structural-op data homes for saves that predate P3
      if (!state.connections) state.connections = [];
      if (!state.mapLayouts) state.mapLayouts = {};
      // migrate NPCs to interiors: add any new NPCs (nurses/clerk) the save is
      // missing, and relocate the structural cast to their canonical spots so
      // gym leaders / Oak / Sal actually live inside their buildings
      const fresh = createSeedWorld();
      const RELOCATE = new Set(['giovanni', 'oak', 'sal', 'brock', 'archer', 'blue']);
      state.npcs = state.npcs ?? {};
      for (const [id, fn] of Object.entries(fresh.npcs)) {
        if (!state.npcs[id]) state.npcs[id] = fn;
        else if (RELOCATE.has(id)) {
          const n = state.npcs[id];
          n.map = fn.map; n.x = fn.x; n.y = fn.y;
        }
      }
      return state;
    } catch { return null; }
  }
  save() { if (this.persist) localStorage.setItem(SAVE_KEY, JSON.stringify(this.state)); }
  reset(seed?: number) { if (this.persist) localStorage.removeItem(SAVE_KEY); this.state = createSeedWorld(seed); this.save(); this.emit(); }

  // ——— deterministic RNG + ids (world-sim layer; see world/rng.ts) ———
  // Every save-reaching random choice draws from a NAMED stream so runs are
  // reproducible from (seed, actions) and streams don't desync each other.
  private unit(stream: string): number { return nextUnit(this.state.rng, stream); }
  rngInt(stream: string, loInclusive: number, hiExclusive: number): number {
    return loInclusive + Math.floor(this.unit(stream) * (hiExclusive - loInclusive));
  }
  rngChance(stream: string, p: number): boolean { return this.unit(stream) < p; }
  rngPick<T>(stream: string, arr: T[]): T { return arr[Math.floor(this.unit(stream) * arr.length)]; }
  // Deterministic unique id (replaces Date.now-based ids): `${prefix}_${n}`.
  nextId(prefix: string): string {
    const n = (this.state.idSeq[prefix] ?? 0) + 1;
    this.state.idSeq[prefix] = n;
    return `${prefix}_${n}`;
  }

  onChange(fn: () => void) { this.listeners.push(fn); }
  private emit() { this.listeners.forEach(f => f()); }

  // ——— event log (facts the LLM retrieves) ———
  logEvent(kind: string, summary: string, data?: Record<string, unknown>) {
    this.state.events.push({ day: this.state.day, kind, summary, data });
    if (this.state.events.length > 400) this.state.events.splice(0, this.state.events.length - 400);
    this.save();
  }

  recentEvents(n = 25): WorldEvent[] { return this.state.events.slice(-n); }

  // ——— reputation ———
  addRep(changes: Partial<Reputation>, reason: string) {
    const rep = this.state.player.reputation;
    for (const [k, v] of Object.entries(changes)) {
      const key = k as keyof Reputation;
      rep[key] = Math.max(-100, Math.min(100, rep[key] + (v ?? 0)));
    }
    this.logEvent('reputation', `Reputation shift (${reason}): ` +
      Object.entries(changes).map(([k, v]) => `${k} ${v! >= 0 ? '+' : ''}${v}`).join(', '));
    this.emit();
  }

  // ——— role slots: the heart of emergent paths ———
  meetsRequirements(slot: RoleSlot): { ok: boolean; missing: string[] } {
    const p = this.state.player;
    const missing: string[] = [];
    if (slot.requires.badges && p.badges < slot.requires.badges)
      missing.push(`${slot.requires.badges} badge(s) (have ${p.badges})`);
    if (slot.requires.minRep) {
      for (const [k, v] of Object.entries(slot.requires.minRep)) {
        const key = k as keyof Reputation;
        if (p.reputation[key] < (v ?? 0)) missing.push(`${k} reputation ≥ ${v} (have ${p.reputation[key]})`);
      }
    }
    if (slot.requires.invitation && !this.state.pendingOffers.some(o => o.slotId === slot.id))
      missing.push('an invitation (impress the right people)');
    // defeatHolder is checked at claim time via battle result
    return { ok: missing.length === 0, missing };
  }

  claimSlot(slotId: string, viaBattle: boolean): { ok: boolean; reason: string } {
    const slot = this.state.slots[slotId];
    if (!slot) return { ok: false, reason: 'No such position.' };
    const req = this.meetsRequirements(slot);
    if (!req.ok) return { ok: false, reason: 'Missing: ' + req.missing.join('; ') };
    if (slot.requires.defeatHolder && slot.holder && slot.holder !== 'player' && !viaBattle)
      return { ok: false, reason: 'You must defeat the current holder in battle.' };

    const oldHolder = slot.holder;
    slot.holder = 'player';
    if (!this.state.player.roles.includes(slot.role)) this.state.player.roles.push(slot.role);
    if (oldHolder && this.state.npcs[oldHolder]) {
      this.state.npcs[oldHolder].role = 'trainer'; // deposed holder becomes a regular figure
    }
    this.state.pendingOffers = this.state.pendingOffers.filter(o => o.slotId !== slotId);
    this.logEvent('role_acquired', `Player became ${slot.title}` + (oldHolder ? `, succeeding ${this.state.npcs[oldHolder]?.name ?? oldHolder}` : '') + '.');
    this.save(); this.emit();
    return { ok: true, reason: `You are now ${slot.title}!` };
  }

  // ——— director proposal validation: the LLM proposes, the sim disposes ———
  applyProposal(p: { developments?: Development[]; rumors?: string[]; townMoods?: { town: string; mood: string }[] }): string[] {
    const applied: string[] = [];
    for (const d of (p.developments ?? []).slice(0, 4)) {
      try {
        const msg = this.applyDevelopment(d);
        if (msg) applied.push(msg);
      } catch { /* invalid proposal — skip silently */ }
    }
    if (p.rumors?.length) {
      this.state.rumors = [...p.rumors.slice(0, 4), ...this.state.rumors].slice(0, 8);
    }
    for (const tm of p.townMoods ?? []) {
      const t = this.state.towns[tm.town];
      if (t && typeof tm.mood === 'string' && tm.mood.length < 30) t.mood = tm.mood;
    }
    this.save(); this.emit();
    return applied;
  }

  private applyDevelopment(d: Development): string | null {
    switch (d.kind) {
      case 'faction_shift': {
        const t = this.state.towns[d.town];
        if (!t) return null;
        t.rocketInfluence = clamp(t.rocketInfluence + clamp(d.rocketDelta, -15, 15), 0, 100);
        t.prosperity = clamp(t.prosperity + clamp(d.prosperityDelta, -15, 15), 0, 100);
        this.logEvent('faction_shift', `${t.name}: ${d.reason}`);
        return d.reason;
      }
      case 'npc_attitude': {
        const n = this.state.npcs[d.npc];
        if (!n) return null;
        n.attitude = clamp(n.attitude + clamp(d.delta, -25, 25), -100, 100);
        this.logEvent('npc_shift', `${n.name}: ${d.reason}`);
        return null; // quiet change, shows up in dialogue
      }
      case 'role_offer': {
        const slot = this.state.slots[d.slotId];
        const from = this.state.npcs[d.fromNpc];
        if (!slot || !from || slot.holder === 'player') return null;
        if (this.state.pendingOffers.some(o => o.slotId === d.slotId)) return null;
        this.state.pendingOffers.push({
          id: this.nextId('offer'), slotId: d.slotId, fromNpc: d.fromNpc,
          text: d.text.slice(0, 200), expiresDay: this.state.day + 5,
        });
        this.logEvent('role_offer', `${from.name} extends an opportunity: ${slot.title}.`);
        return `${from.name} wants to talk to you about something. (${slot.title})`;
      }
      case 'building_change': {
        return this.applyBuildingChange(d);
      }
      case 'vacate_slot': {
        const slot = this.state.slots[d.slotId];
        if (!slot || !slot.holder || slot.holder === 'player') return null;
        const old = this.state.npcs[slot.holder];
        slot.holder = null;
        if (old) old.role = 'trainer';
        this.logEvent('slot_vacated', `${slot.title} is now vacant: ${d.reason}`);
        return `${slot.title} is now VACANT — ${d.reason}`;
      }
      case 'world_news': {
        this.logEvent('world_news', d.summary.slice(0, 250));
        return d.summary;
      }
      default: return null;
    }
  }

  private applyBuildingChange(d: Extract<Development, { kind: 'building_change' }>): string | null {
    const town = this.state.towns[d.town];
    if (!town) return null;
    if (d.action === 'build') {
      // Procedural placement: find a free rect on the town map (validated against existing buildings)
      const spot = this.findBuildingSpot(d.town);
      if (!spot) return null;
      const id = this.nextId(`bld_${d.town}`);
      const b: Building = {
        id, kind: d.buildingKind, name: d.name.slice(0, 40), map: d.town,
        x: spot.x, y: spot.y, w: spot.w, h: spot.h,
        owner: null, condition: 'new', builtOnDay: this.state.day,
      };
      this.state.buildings[id] = b;
      this.logEvent('building_built', `${b.name} was built in ${town.name}: ${d.reason}`);
      return `New construction in ${town.name}: ${b.name}`;
    } else {
      // damage/repair/ruin an existing building in that town
      const targets = Object.values(this.state.buildings).filter(b => b.map === d.town);
      if (!targets.length) return null;
      const b = this.rngPick('bld_target', targets);
      const map: Record<string, Building['condition']> = { damage: 'damaged', repair: 'normal', ruin: 'ruined' };
      b.condition = map[d.action] ?? b.condition;
      this.logEvent('building_change', `${b.name} is now ${b.condition}: ${d.reason}`);
      return `${b.name} is now ${b.condition} — ${d.reason}`;
    }
  }

  private findBuildingSpot(mapId: string): { x: number; y: number; w: number; h: number } | null {
    const w = 4, h = 3;
    const existing = Object.values(this.state.buildings).filter(b => b.map === mapId);
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = 3 + this.rngInt('bld_spot', 0, 18);
      const y = 3 + this.rngInt('bld_spot', 0, 14);
      const clash = existing.some(b => x < b.x + b.w + 1 && x + w + 1 > b.x && y < b.y + b.h + 1 && y + h + 1 > b.y);
      if (!clash) return { x, y, w, h };
    }
    return null;
  }
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

export const world = new WorldStore();
