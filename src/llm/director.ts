import { chatJSON, hasKey } from './client';
import { world } from '../world/store';
import type { DirectorProposal, Development } from '../world/types';
import { currentChapter, objectiveHint } from '../world/story';
import { prefetchOpenings, bumpCacheGen } from './dialogueCache';

// The Director: once per in-game day, reads the world digest and proposes
// 1-4 developments. The sim validates everything. This is where emergent
// storylines come from — Rocket noticing your crimes, gym leaders retiring,
// buildings going up, role offers appearing.

const DIRECTOR_SCHEMA = {
  type: 'object',
  properties: {
    developments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['faction_shift', 'npc_attitude', 'role_offer', 'building_change', 'vacate_slot', 'world_news'] },
          town: { type: ['string', 'null'] },
          rocketDelta: { type: ['integer', 'null'] },
          prosperityDelta: { type: ['integer', 'null'] },
          npc: { type: ['string', 'null'] },
          delta: { type: ['integer', 'null'] },
          slotId: { type: ['string', 'null'] },
          fromNpc: { type: ['string', 'null'] },
          text: { type: ['string', 'null'] },
          action: { type: ['string', 'null'], enum: ['build', 'damage', 'repair', 'ruin', null] },
          buildingKind: { type: ['string', 'null'], enum: ['house', 'gym', 'center', 'mart', 'hideout', 'lab', 'tower', null] },
          name: { type: ['string', 'null'] },
          reason: { type: ['string', 'null'] },
          summary: { type: ['string', 'null'] },
        },
        required: ['kind', 'town', 'rocketDelta', 'prosperityDelta', 'npc', 'delta', 'slotId', 'fromNpc', 'text', 'action', 'buildingKind', 'name', 'reason', 'summary'],
        additionalProperties: false,
      },
    },
    rumors: { type: 'array', items: { type: 'string' } },
    townMoods: {
      type: 'array',
      items: {
        type: 'object',
        properties: { town: { type: 'string' }, mood: { type: 'string' } },
        required: ['town', 'mood'],
        additionalProperties: false,
      },
    },
  },
  required: ['developments', 'rumors', 'townMoods'],
  additionalProperties: false,
} as const;

function worldDigest(): string {
  const s = world.state;
  const p = s.player;
  const towns = Object.values(s.towns)
    .map(t => `${t.id} (${t.name}): prosperity ${t.prosperity}, rocketInfluence ${t.rocketInfluence}, mood "${t.mood}"`)
    .join('\n');
  const npcs = Object.values(s.npcs)
    .map(n => `${n.id} (${n.name}, ${n.role}, faction ${n.faction}, town ${n.town}, attitude ${n.attitude}${n.defeated ? ', DEFEATED today' : ''})`)
    .join('\n');
  const slots = Object.values(s.slots)
    .map(sl => `${sl.id} ("${sl.title}"): holder=${sl.holder ?? 'VACANT'}, requires=${JSON.stringify(sl.requires)}`)
    .join('\n');
  const history = world.recentEvents(25).map(e => `Day ${e.day}: [${e.kind}] ${e.summary}`).join('\n');
  const offers = s.pendingOffers.map(o => `${o.slotId} from ${o.fromNpc} (expires day ${o.expiresDay})`).join('; ') || 'none';

  const chapter = currentChapter(s);

  return `DAY ${s.day} ENDS.

CURRENT STORY THREAD (advance THIS — every development tonight should escalate or
color this thread, not invent unrelated events): ${chapter ? `"${chapter.objective}" — ${objectiveHint(s)}` : 'The main quest is complete; the world settles into a quieter aftermath.'}

PLAYER: roles [${p.roles.join(', ')}], badges ${p.badges}, money ¥${p.money}
REPUTATION: League ${p.reputation.league}, Rocket ${p.reputation.rocket}, Civic ${p.reputation.civic}, Research ${p.reputation.research}

TOWNS:
${towns}

NPCS:
${npcs}

POWER SLOTS:
${slots}

PENDING OFFERS: ${offers}

RECENT HISTORY:
${history}`;
}

export interface TickResult {
  headlines: string[];   // what the player sees in the morning
  usedLLM: boolean;
}

export async function runWorldTick(): Promise<TickResult> {
  const s = world.state;
  s.day += 1;
  // expire stale offers; reset daily battle flags
  s.pendingOffers = s.pendingOffers.filter(o => o.expiresDay >= s.day);
  Object.values(s.npcs).forEach(n => { n.defeated = false; });

  let headlines: string[] = [];
  let usedLLM = false;

  if (hasKey()) {
    try {
      const system = `You are the Director of a living Pokémon-style world — a dungeon master advancing ONE evolving storyline, not a random-event generator.
Each night you advance the world ONE day with 1-3 developments that ESCALATE the CURRENT STORY THREAD shown in the digest and react to the player's behavior.
Principles:
- Continuity first: tonight's developments must connect to the current thread and to recent history. Each rumor should read like the NEXT beat of an ongoing story, referencing yesterday — never an unrelated random happening.
- Consequences: if the player helps Rocket, Rocket courts them (role_offer via a rocket NPC). If they're a rising League star, the League takes notice.
- Tools: faction_shift to tighten/loosen a faction's grip on the town in the current thread; npc_attitude for the thread's key NPCs; building_change ONLY when it serves the thread (e.g. the warehouse). vacate_slot is rare and dramatic. role_offer opens a PATH — only offer a slot the player nearly meets, from a credible NPC.
- Use exact ids from the digest (npc ids, slot ids, town ids). Small deltas (-10..10). Fill ONLY the fields relevant to each development's kind; set all others to null.
- 2-3 fresh rumors that foreshadow the NEXT beat of the current thread. Update town moods only if they shifted.`;

      const proposal = await chatJSON<DirectorProposal>(system, worldDigest(), 'director_tick', DIRECTOR_SCHEMA as unknown as Record<string, unknown>, 1400);
      headlines = world.applyProposal(proposal as unknown as { developments: Development[]; rumors: string[]; townMoods: { town: string; mood: string }[] });
      usedLLM = true;
    } catch {
      headlines = heuristicTick();
    }
  } else {
    headlines = heuristicTick();
  }

  world.logEvent('day_start', `Day ${s.day} begins.`);
  world.save();
  // the new day's world is settled — warm this map's NPC dialogue in the
  // background (no-op without a key; never blocks the morning)
  bumpCacheGen();
  void prefetchOpenings(s.player.map);
  return { headlines, usedLLM };
}

// Rule-based fallback tick — the world still breathes without a key, and it
// ADVANCES THE CURRENT STORY THREAD rather than emitting random events. Each
// chapter has a small pool of escalating beats; we pick by day so consecutive
// nights differ but stay on-thread.
function heuristicTick(): string[] {
  const s = world.state;
  const out: string[] = [];
  const p = s.player.reputation;
  const ch = currentChapter(s);
  const pick = (arr: string[]) => arr[s.day % arr.length];
  const clampTown = (id: string, key: 'rocketInfluence' | 'prosperity', d: number) => {
    const t = s.towns[id]; if (!t) return;
    t[key] = Math.max(0, Math.min(100, t[key] + d));
  };

  switch (ch?.id) {
    case 'boulder_badge':
      out.push(pick([
        'Word from Pewter: Brock is taking on challengers at the Gym. They say his Onix is a wall of stone.',
        'A rookie limped back from Pewter today — Brock\'s rock-types are no joke. Grass and water fare best.',
        'Pewter City buzzes with trainers hoping to earn the Boulder Badge.',
      ]));
      break;
    case 'the_warehouse':
      clampTown('pewter', 'rocketInfluence', 3);
      out.push(pick([
        'Lights moved through the old Pewter warehouse again last night. Elder Rosa is asking after you.',
        'Townsfolk whisper that Team Rocket\'s grip on Pewter\'s south end is tightening.',
      ]));
      break;
    case 'bust_rocket': {
      clampTown('pewter', 'rocketInfluence', 4);
      const archer = s.npcs.archer;
      if (archer) archer.attitude = Math.max(-100, archer.attitude - 4);
      out.push(pick([
        'Team Rocket is digging in at the warehouse — Archer was seen barking orders at grunts.',
        'Crates pile up behind the Pewter warehouse. Whatever Archer is planning, it\'s nearly ready.',
      ]));
      break;
    }
    case 'viridian_secret':
      clampTown('viridian', 'rocketInfluence', 3);
      out.push(pick([
        'Strange: Giovanni abruptly cancelled Gym matches in Viridian today. What is he hiding?',
        'Rocket grunts were seen slipping in and out of the Viridian Gym after dark.',
      ]));
      break;
    case 'champion': {
      // help a deserving challenger close the gap to the throne so the final
      // chapter is reachable even offline
      const need = s.slots.champion?.requires?.minRep?.league ?? 40;
      if (s.player.badges >= 2 && p.league < need) {
        s.player.reputation.league = Math.min(100, p.league + 6);
        out.push('The League formally recognizes your victories. The Champion\'s seat draws closer.');
      } else {
        out.push(pick([
          'The League is abuzz — with Rocket broken, they say the Champion\'s seat may soon have a new claimant.',
          'Trainers across Kanto wonder aloud whether YOU will take the Champion\'s throne.',
        ]));
      }
      break;
    }
    default:
      out.push('A peaceful day passes across the region you reshaped.');
  }

  // Rocket still courts a genuinely criminal player — a real alternate path.
  if (p.rocket >= 20 && !s.pendingOffers.length && s.slots.rocket_boss.holder !== 'player') {
    const recruiter = Object.values(s.npcs).find(n => n.faction === 'rocket' && !s.player.flags['beat_' + n.id]);
    if (recruiter) {
      world.applyProposal({ developments: [{ kind: 'role_offer', slotId: 'rocket_boss', fromNpc: recruiter.id, text: 'The organization has noticed your... flexibility. There may be a place for you higher up.' }] });
      out.push(`${recruiter.name} has been asking around for you.`);
    }
  }

  // Rangers court a player who has earned research + civic standing (head_ranger path)
  const hr = s.slots.head_ranger;
  if (hr && hr.holder !== 'player' && p.research >= 30 && p.civic >= 20 &&
      !s.pendingOffers.some(o => o.slotId === 'head_ranger')) {
    const iva = s.npcs.ranger_iva;
    if (iva) {
      world.applyProposal({ developments: [{ kind: 'role_offer', slotId: 'head_ranger', fromNpc: 'ranger_iva', text: 'You\'ve shown the wilds real respect. There\'s a place for you among the Rangers — Head Ranger, even.' }] });
      out.push('Ranger Iva has been looking for you.');
    }
  }

  return out;
}
