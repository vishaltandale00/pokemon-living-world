import { chatJSON, hasKey } from './client';
import { world } from '../world/store';
import type { NPC } from '../world/types';
import { authoredDialogue, type DialogueTurn } from '../world/dialogueContent';
import { getCached, setCached } from './dialogueCache';

export type { DialogueChoice, DialogueTurn } from '../world/dialogueContent';

// NPC dialogue: with an API key the LLM speaks AS the NPC, grounded in real
// world state + event history, and returns player choices with structured
// effects the sim can validate and apply. Without a key, rich authored
// per-character dialogue (world/dialogueContent.ts) keeps the game alive.

const DIALOGUE_SCHEMA = {
  type: 'object',
  properties: {
    npcLine: { type: 'string' },
    choices: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          repEffects: {
            type: 'object',
            properties: {
              league: { type: 'integer' }, rocket: { type: 'integer' },
              civic: { type: 'integer' }, research: { type: 'integer' },
            },
            required: ['league', 'rocket', 'civic', 'research'],
            additionalProperties: false,
          },
          attitudeDelta: { type: 'integer' },
          startsBattle: { type: 'boolean' },
          acceptsOffer: { type: ['string', 'null'] },
        },
        required: ['label', 'repEffects', 'attitudeDelta', 'startsBattle', 'acceptsOffer'],
        additionalProperties: false,
      },
    },
  },
  required: ['npcLine', 'choices'],
  additionalProperties: false,
} as const;

function worldContext(npc: NPC): string {
  const s = world.state;
  const p = s.player;
  const town = s.towns[npc.town];
  const offers = s.pendingOffers
    .filter(o => o.fromNpc === npc.id)
    .map(o => `OFFER ${o.id}: you may offer the player the position "${s.slots[o.slotId]?.title}" — phrased as: ${o.text}`)
    .join('\n');
  const recentHistory = world.recentEvents(20).map(e => `Day ${e.day}: ${e.summary}`).join('\n');
  const slotInfo = Object.values(s.slots)
    .map(sl => `${sl.title}: ${sl.holder === 'player' ? 'THE PLAYER' : sl.holder ? s.npcs[sl.holder]?.name ?? sl.holder : 'VACANT'}`)
    .join('; ');

  return `WORLD DAY: ${s.day}
LOCATION: ${town?.name} (mood: ${town?.mood}, prosperity ${town?.prosperity}/100, Rocket influence ${town?.rocketInfluence}/100)

PLAYER: ${p.name}, roles: [${p.roles.join(', ')}], badges: ${p.badges}, money: ¥${p.money}
PLAYER REPUTATION: League ${p.reputation.league}, Rocket ${p.reputation.rocket}, Civic ${p.reputation.civic}, Research ${p.reputation.research}

POSITIONS OF POWER: ${slotInfo}

YOUR ATTITUDE TOWARD PLAYER: ${npc.attitude} (-100 hostile .. +100 devoted)
${npc.defeated ? 'The player DEFEATED you in battle today.' : ''}
${offers ? '\nPENDING OFFERS YOU CAN EXTEND:\n' + offers : ''}

CURRENT RUMORS: ${s.rumors.slice(0, 4).join(' | ')}

RECENT WORLD HISTORY (real facts — reference them naturally):
${recentHistory}`;
}

export async function npcDialogue(npc: NPC, playerSaid: string | null): Promise<DialogueTurn> {
  if (!hasKey()) return authoredDialogue(npc, playerSaid);
  const cached = getCached(npc, playerSaid);  // prefetched / read-through cache
  if (cached) return cached;
  const system = `You are ${npc.name}, an NPC in a living Pokémon-style world. PERSONALITY: ${npc.personality}
You are NOT an assistant. Stay in character completely. Speak 1-2 SHORT sentences (max ~30 words total) — terse and vivid, like a Game Boy text box.
Reference real world history when relevant. Your attitude toward the player colors your tone.
Offer 2-3 player choices that are meaningfully DIFFERENT (kind/neutral/bold/criminal as fits the situation). Each choice label must be SHORT — under 8 words, a first-person action like "Challenge them" or "Walk away".
repEffects per choice must be small integers (-5..5, usually 0-2 axes nonzero). attitudeDelta -10..10.
Set startsBattle=true on a choice ONLY if it naturally provokes a battle and you have a party (${npc.party.length} monsters).
If you have a PENDING OFFER, weave it into your line and include a choice with acceptsOffer set to that offer id; otherwise acceptsOffer must be null.`;

  const user = `${worldContext(npc)}

${playerSaid ? `The player just said/chose: "${playerSaid}"` : 'The player approaches you and starts a conversation.'}

Respond as ${npc.name} with your line and the player's choices.`;

  try {
    const turn = await chatJSON<DialogueTurn>(system, user, 'dialogue_turn', DIALOGUE_SCHEMA as unknown as Record<string, unknown>);
    // sanitize + keep lengths bounded so the dialogue box stays readable
    turn.choices = (turn.choices ?? []).slice(0, 3).map(c => ({
      label: clip(String(c.label), 64),
      repEffects: {
        league: clampInt(c.repEffects?.league), rocket: clampInt(c.repEffects?.rocket),
        civic: clampInt(c.repEffects?.civic), research: clampInt(c.repEffects?.research),
      },
      attitudeDelta: Math.max(-10, Math.min(10, Math.trunc(c.attitudeDelta ?? 0))),
      startsBattle: Boolean(c.startsBattle) && npc.party.length > 0 && !npc.defeated,
      acceptsOffer: typeof c.acceptsOffer === 'string' ? c.acceptsOffer : null,
    }));
    if (!turn.choices.length) turn.choices = authoredDialogue(npc, playerSaid).choices;
    // LLM returns bare speech; attribute it (authored lines name the speaker themselves)
    const line = clip(String(turn.npcLine ?? '').trim(), 200);
    turn.npcLine = line.startsWith(npc.name) ? line : `${npc.name}: ${line}`;
    setCached(npc, playerSaid, turn);  // cache only successful LLM turns
    return turn;
  } catch {
    return authoredDialogue(npc, playerSaid);
  }
}

// trim to a max length on a word boundary, adding an ellipsis if cut
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:."']+$/, '') + '…';
}

function clampInt(v: unknown): number {
  const n = Math.trunc(Number(v) || 0);
  return Math.max(-5, Math.min(5, n));
}
