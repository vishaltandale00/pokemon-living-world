import { world } from '../world/store';
import { hasKey } from './client';
import { currentChapter } from '../world/story';
import { LEAVE_LABEL, type DialogueTurn } from '../world/dialogueContent';
import { npcDialogue } from './dialogue';
import type { NPC } from '../world/types';

// Prefetch / read-through cache for LLM dialogue. A cached turn is only served
// when the live world SIGNATURE still matches what it was generated under, so a
// cached line can never be shown stale (a mismatch is a miss → regenerate).
// Only used when an API key is set; the no-key authored path never touches it.

const MAX_ENTRIES = 80;     // bound the cache (openings + warmed follow-ups)
const PREFETCH_CONCURRENCY = 2;
// Bump when the dialogue PROMPT changes so stale cached turns auto-invalidate
// (the sig is part of every cache entry; a new version => every read misses).
const DIALOGUE_PROMPT_VERSION = 'v2-voice';

// bumped each world tick; a prefetch batch from a previous day stops itself
let cacheGen = 0;
export function bumpCacheGen() { cacheGen++; }

const inFlight = new Set<string>(); // keys being generated, to avoid double work

// ——— signature: exactly the world inputs worldContext() inlines for an opening ———
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function openingSig(npc: NPC): string {
  const s = world.state;
  const p = s.player;
  const r = p.reputation;
  const chapter = currentChapter(s)?.id ?? '-';
  const offers = s.pendingOffers.filter(o => o.fromNpc === npc.id).map(o => o.id).sort().join(',');
  const town = s.towns[npc.town];
  const slots = Object.entries(s.slots).map(([id, sl]) => `${id}:${sl.holder ?? '-'}`).join(',');
  const events = world.recentEvents(20).map(e => `${e.day}:${e.summary}`).join('|');
  const rumors = s.rumors.slice(0, 4).join('|');
  const raw = [
    DIALOGUE_PROMPT_VERSION,
    npc.id, chapter, p.badges,
    r.league, r.rocket, r.civic, r.research,
    npc.attitude, npc.defeated ? 1 : 0, npc.party.length,
    offers, rumors,
    town ? `${town.mood}/${town.prosperity}/${town.rocketInfluence}` : '-',
    slots, djb2(events),
  ].join('§');
  return djb2(raw);
}

function keyOf(npcId: string, playerSaid: string | null): string {
  return `${npcId}|${(playerSaid ?? '').slice(0, 64)}`;
}

// ——— read / write ———
export function getCached(npc: NPC, playerSaid: string | null): DialogueTurn | null {
  const entry = world.state.dialogueCache?.[keyOf(npc.id, playerSaid)];
  if (!entry) return null;
  if (entry.day < world.state.day) return null;          // cross-day guard
  if (entry.sig !== openingSig(npc)) return null;        // world changed → stale
  return entry.turn;
}

// sync "is there a fresh hit?" — lets the UI skip the "..." loading flash
export function peekCached(npc: NPC, playerSaid: string | null): boolean {
  return getCached(npc, playerSaid) !== null;
}

export function setCached(npc: NPC, playerSaid: string | null, turn: DialogueTurn) {
  const cache = (world.state.dialogueCache ??= {});
  cache[keyOf(npc.id, playerSaid)] = { turn, sig: openingSig(npc), day: world.state.day };
  prune(cache);
}

function prune(cache: Record<string, { day: number }>) {
  const keys = Object.keys(cache);
  if (keys.length <= MAX_ENTRIES) return;
  // drop the oldest-day entries until back under the cap
  keys.sort((a, b) => cache[a].day - cache[b].day);
  for (let i = 0; i < keys.length - MAX_ENTRIES; i++) delete cache[keys[i]];
}

// ——— prefetch ———
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const item = items[i++]; await fn(item); }
  });
  await Promise.all(workers);
}

function warmable(turn: DialogueTurn) {
  // follow-ups worth warming: a choice that continues the conversation
  return turn.choices.filter(c => c.label !== LEAVE_LABEL && !c.startsBattle && !c.acceptsOffer);
}

// Warm the OPENING line of every talkable NPC on a map (background, key-gated).
export async function prefetchOpenings(mapId: string): Promise<void> {
  if (!hasKey()) return;
  const gen = cacheGen;
  const s = world.state;
  const npcs = Object.values(s.npcs).filter(n =>
    n.map === mapId && !n.id.startsWith('nurse') && !n.id.startsWith('clerk'));
  await pool(npcs, PREFETCH_CONCURRENCY, async (n) => {
    if (gen !== cacheGen) return;                 // a new day superseded this batch
    const k = keyOf(n.id, null);
    if (peekCached(n, null) || inFlight.has(k)) return;
    inFlight.add(k);
    try { await npcDialogue(n, null); }           // caches itself on LLM success
    catch { /* leave for realtime */ }
    finally { inFlight.delete(k); }
  });
  world.save();
}

// After a turn renders, warm the responses to its non-terminal choices so the
// NEXT pick is instant too (full-conversation prefetch).
export function prefetchFollowups(npc: NPC, turn: DialogueTurn): void {
  if (!hasKey()) return;
  const labels = warmable(turn).map(c => c.label);
  if (!labels.length) return;
  const gen = cacheGen;
  void pool(labels, PREFETCH_CONCURRENCY, async (label) => {
    if (gen !== cacheGen) return;
    const k = keyOf(npc.id, label);
    if (peekCached(npc, label) || inFlight.has(k)) return;
    inFlight.add(k);
    try { await npcDialogue(npc, label); }
    catch { /* realtime later */ }
    finally { inFlight.delete(k); }
  }).then(() => world.save());
}
