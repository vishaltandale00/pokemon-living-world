import type { WorldState } from './types';
import { world } from './store';

// The STORY SPINE. The simulation is still emergent, but a hand-authored
// throughline gives the player a goal at every moment and a reason for the
// world's events to connect. Each chapter is grounded entirely in the seed's
// existing NPCs / slots / flags — the spine surfaces the story that was always
// latent in the data (Brock wants a successor; Archer runs Rocket from the
// Pewter warehouse; Giovanni is secretly the Rocket boss).
//
// The Director (llm/director.ts) reads the CURRENT chapter and advances THAT
// thread each night instead of emitting disconnected random events.

export interface Chapter {
  id: string;
  objective: string;   // one line shown in the HUD ("▶ ...")
  directive: string;   // shown once when this chapter becomes current
  hint: string;        // where to go, surfaced in the objective tooltip/banner
  talkTo?: string;     // npc id whose conversation advances this chapter
  done: (w: WorldState) => boolean;
  onComplete?: (w: WorldState) => string; // side effects; returns the payoff toast
}

const flag = (w: WorldState, k: string) => !!w.player.flags[k];

export const STORY: Chapter[] = [
  {
    id: 'boulder_badge',
    objective: 'Earn the Boulder Badge',
    hint: 'Travel north to Pewter City and defeat Brock at the Gym.',
    directive:
      "PROF. OAK: \"Every trainer starts the same way — prove yourself in a Gym.\n" +
      "Head north through Route 1 to Pewter City and challenge Brock for the\n" +
      "Boulder Badge. Earn it, and the League will start to take you seriously.\"",
    done: w => flag(w, 'badge_brock'),
    onComplete: () =>
      'The Boulder Badge is yours. Brock smiles: "You earned that. The League is watching you now."',
  },
  {
    id: 'the_warehouse',
    objective: 'Hear out Elder Rosa',
    hint: 'Find Elder Rosa in Pewter City and ask what is troubling the town.',
    directive:
      "Brock lowers his voice: \"Before you go — talk to Elder Rosa here in Pewter.\n" +
      "She's worried about the old warehouse on the south edge of town. Something's\n" +
      "moving through there at night, and it isn't honest business.\"",
    talkTo: 'elder_rosa',
    done: w => flag(w, 'story_the_warehouse'),
    onComplete: w => {
      const rosa = w.npcs.elder_rosa;
      if (rosa) rosa.attitude = Math.min(100, rosa.attitude + 15);
      w.rumors = ['Team Rocket has been seen hauling crates into the old Pewter warehouse after dark.', ...w.rumors].slice(0, 8);
      return 'ELDER ROSA: "Team Rocket. Their officer Archer runs the warehouse. Drive him out — please. Pewter can\'t take much more."';
    },
  },
  {
    id: 'bust_rocket',
    objective: 'Drive Archer out of the warehouse',
    hint: 'Confront the Rocket officer Archer at the warehouse on the south edge of Pewter.',
    directive:
      "The warehouse looms on Pewter's south edge, its doors scarred and patched.\n" +
      "Inside, the Rocket officer Archer is waiting. Beat him, and Team Rocket\n" +
      "loses its grip on this town.",
    done: w => flag(w, 'beat_archer'),
    onComplete: w => {
      const wh = w.buildings.rocket_warehouse;
      if (wh) { wh.condition = 'ruined'; wh.owner = 'townsfolk'; }
      const pewter = w.towns.pewter;
      if (pewter) pewter.rocketInfluence = Math.max(0, pewter.rocketInfluence - 25);
      world.addRep({ civic: 10, rocket: -10 }, 'breaking Team Rocket\'s hold on Pewter');
      return 'Archer flees, but spits a name as he goes: "You think this ends here? GIOVANNI will bury you." — Giovanni, the Viridian Gym Leader?';
    },
  },
  {
    id: 'viridian_secret',
    objective: 'Confront Giovanni at the Viridian Gym',
    hint: 'Return to Viridian City and challenge Giovanni — the man behind Team Rocket.',
    directive:
      "It fits. The respected Viridian Gym Leader and the unseen boss of Team\n" +
      "Rocket are the same man: Giovanni. He won't confess — but beat him in his\n" +
      "own Gym and the truth comes out. Return to Viridian City.",
    done: w => flag(w, 'beat_giovanni'),
    onComplete: w => {
      const viridian = w.towns.viridian;
      if (viridian) viridian.rocketInfluence = Math.max(0, viridian.rocketInfluence - 30);
      world.addRep({ league: 15, civic: 10, rocket: -20 }, 'exposing Giovanni as the boss of Team Rocket');
      world.logEvent('world_news', 'Giovanni was exposed as the secret boss of Team Rocket and driven from the Viridian Gym.');
      return 'Giovanni\'s double life is exposed. Team Rocket scatters without its head. Kanto will never see the League the same way.';
    },
  },
  {
    id: 'champion',
    objective: 'Become the League Champion',
    hint: 'You hold both badges and the League\'s respect — claim the title of Champion.',
    directive:
      "With Rocket broken and two badges earned, only one seat remains empty: the\n" +
      "Champion of the Pokémon League. Meet its requirements and the title — and\n" +
      "the Kanto you reshaped — is yours.",
    done: w => w.slots.champion?.holder === 'player',
    onComplete: () =>
      '★ You are the Champion of a Kanto you reshaped with your own hands. The region is at peace — for now.',
  },
];

export function currentChapter(w: WorldState): Chapter | null {
  return STORY[w.player.story ?? 0] ?? null;
}

export function objectiveLine(w: WorldState): string {
  const c = currentChapter(w);
  if (!c) return 'Champion of Kanto — your story is complete.';
  // for the final chapter, surface the concrete requirements so it's never a mystery
  if (c.id === 'champion') {
    const slot = w.slots.champion;
    const need = slot?.requires ?? {};
    const bits: string[] = [];
    if (need.badges) bits.push(`${w.player.badges}/${need.badges} badges`);
    if (need.minRep?.league !== undefined) bits.push(`League ${w.player.reputation.league}/${need.minRep.league}`);
    return bits.length ? `${c.objective} (${bits.join(', ')})` : c.objective;
  }
  return c.objective;
}

export function objectiveHint(w: WorldState): string {
  const c = currentChapter(w);
  return c ? c.hint : 'Wander the region you reshaped.';
}

// Called when the player talks to an NPC: advances any talk-gated chapter.
export function markTalk(w: WorldState, npcId: string): void {
  const c = currentChapter(w);
  if (c?.talkTo === npcId) w.player.flags['story_' + c.id] = true;
}

export interface StoryUpdate {
  toasts: string[];       // payoff lines for chapters completed just now
  directive: string | null; // opening text for a freshly-started chapter
}

// Advances the spine as far as the current world state allows, firing each
// completed chapter's side effects. Returns payoff toasts + the directive of
// the now-current chapter (shown once).
export function advanceStory(w: WorldState): StoryUpdate {
  if (w.player.story === undefined) w.player.story = 0;
  // the Champion title is the one slot no battle claims — auto-claim it the
  // moment the player meets its requirements while on the final chapter
  const cur0 = STORY[w.player.story];
  if (cur0?.id === 'champion' && w.slots.champion && w.slots.champion.holder !== 'player') {
    world.claimSlot('champion', false);
  }
  const toasts: string[] = [];
  // complete every chapter whose predicate is now satisfied, in order
  for (let guard = 0; guard < STORY.length + 1; guard++) {
    const c = STORY[w.player.story];
    if (!c || !c.done(w)) break;
    const t = c.onComplete?.(w);
    if (t) toasts.push(t);
    w.player.story += 1;
  }
  // surface the directive for the chapter the player is now on (once)
  let directive: string | null = null;
  const cur = STORY[w.player.story];
  if (cur && !w.player.flags['seen_' + cur.id]) {
    w.player.flags['seen_' + cur.id] = true;
    directive = cur.directive;
  }
  world.save();
  return { toasts, directive };
}
