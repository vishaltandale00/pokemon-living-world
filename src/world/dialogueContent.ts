import type { NPC } from './types';
import { world } from './store';
import { currentChapter } from './story';

// Authored, in-character dialogue for every NPC — used when no LLM key is set
// (the default), so the game feels alive offline. Each NPC has a distinct
// voice and reacts to story stage, badges, attitude, and whether you've beaten
// them. Branching is driven by the chosen label (passed back as `said`).
//
// With an API key, llm/dialogue.ts takes over and these serve as the fallback.

export interface DialogueChoice {
  label: string;
  repEffects: { league: number; rocket: number; civic: number; research: number };
  attitudeDelta: number;
  startsBattle: boolean;
  acceptsOffer: string | null;
}
export interface DialogueTurn { npcLine: string; choices: DialogueChoice[]; }

interface ChoiceOpts {
  rep?: Partial<DialogueChoice['repEffects']>;
  att?: number;
  battle?: boolean;
  offer?: string | null;
}
function choice(label: string, opts: ChoiceOpts = {}): DialogueChoice {
  return {
    label,
    repEffects: { league: 0, rocket: 0, civic: 0, research: 0, ...(opts.rep ?? {}) },
    attitudeDelta: opts.att ?? 0,
    startsBattle: opts.battle ?? false,
    acceptsOffer: opts.offer ?? null,
  };
}
export const LEAVE_LABEL = '(Say goodbye)';
const leave = choice(LEAVE_LABEL, { att: 0 });
function canBattle(npc: NPC): boolean { return npc.party.length > 0 && !npc.defeated; }

// If this NPC has a pending role offer, surface an accept choice everywhere.
function offerChoice(npc: NPC): DialogueChoice | null {
  const offer = world.state.pendingOffers.find(o => o.fromNpc === npc.id);
  if (!offer) return null;
  const slot = world.state.slots[offer.slotId];
  return choice(`Accept: ${slot?.title ?? 'their offer'}`, { att: 2, offer: offer.id });
}

const chapterId = () => currentChapter(world.state)?.id ?? null;
const hasBadge = (id: string) => !!world.state.player.flags['badge_' + id];
const beaten = (id: string) => !!world.state.player.flags['beat_' + id];

// ——— per-NPC dialogue trees ———
type Tree = (npc: NPC, said: string | null) => DialogueTurn;

const TREES: Record<string, Tree> = {
  // ——— Brock: kind, dutiful Pewter gym leader who dreams of breeding ———
  brock(npc, said) {
    if (beaten('brock')) {
      if (said === 'Any advice?')
        return { npcLine: 'Brock: "Type matchups win battles. And take care of your team — a rested Pokémon fights twice as hard. Now go, the road north is yours."', choices: [leave] };
      return {
        npcLine: 'Brock: "That was a real battle. The Boulder Badge suits you. Honestly? I\'d rather raise Pokémon than fight — maybe one day I\'ll hand this gym over for good."',
        choices: [choice('Any advice?', { att: 2 }), leave],
      };
    }
    if (said === 'Tell me about the gym')
      return { npcLine: 'Brock: "Rock-types. Slow, but tough as the mountain. My Onix has never fallen to a rookie. Bring water or grass if you\'re smart."', choices: [choice('I challenge you!', { rep: { league: 1 }, battle: canBattle(npc) }), leave] };
    return {
      npcLine: 'Brock crosses his arms and smiles. "Pewter Gym. I\'m Brock — I battle with rock-hard determination. You here for the Boulder Badge?"',
      choices: [
        choice('I challenge you!', { rep: { league: 1 }, battle: canBattle(npc) }),
        choice('Tell me about the gym', { att: 1 }),
        leave,
      ],
    };
  },

  // ——— Giovanni: respected gym leader, secret Rocket boss ———
  giovanni(npc, said) {
    const exposed = beaten('giovanni');
    if (exposed)
      return { npcLine: 'Giovanni\'s composure is gone. "You\'ve cost me everything. Team Rocket scatters... for now. Do not mistake this for the end."', choices: [leave] };
    if (chapterId() === 'viridian_secret' || beaten('archer')) {
      if (said === 'Drop the act, Giovanni.')
        return { npcLine: 'Giovanni\'s smile thins. "Bold. Proof is a fragile thing, challenger. If you believe it — take it from me in battle. If you can."', choices: [choice('Then I\'ll prove it!', { rep: { league: 2 }, battle: canBattle(npc) }), leave] };
      return {
        npcLine: 'Giovanni studies you coldly. "The trainer who broke my Pewter operation. You should have walked away."',
        choices: [
          choice('Drop the act, Giovanni.', { rep: { civic: 1 }, att: -3 }),
          choice('I challenge you for the badge!', { rep: { league: 1 }, battle: canBattle(npc) }),
          leave,
        ],
      };
    }
    if (said === 'Are the rumors about you true?')
      return { npcLine: 'Giovanni laughs softly. "Rumors are for the weak. I am the Viridian Gym Leader. Anything more is... imagination."', choices: [choice('I challenge you!', { rep: { league: 1 }, battle: canBattle(npc) }), leave] };
    return {
      npcLine: 'Giovanni regards you the way a man appraises a tool. "Viridian Gym. I am Giovanni. State your business, and be brief."',
      choices: [
        choice('I challenge you!', { rep: { league: 1 }, battle: canBattle(npc) }),
        choice('Are the rumors about you true?', { rep: { research: 1 }, att: -1 }),
        leave,
      ],
    };
  },

  // ——— Oak: warm professor, guidance + Lugia obsession ———
  oak(_npc, said) {
    const ch = chapterId();
    if (said === 'What should I do next?') {
      const hint = currentChapter(world.state)?.hint ?? 'Explore the region and find your own path.';
      return { npcLine: `Oak: "${hint} Trust your instincts — this Kanto rewards the curious and the brave."`, choices: [choice('Tell me about Lugia', { rep: { research: 1 } }), leave] };
    }
    if (said === 'Tell me about Lugia')
      return { npcLine: 'Oak\'s eyes light up. "A silver guardian of the sea, seen over the northern peaks at dawn. Most call it legend. I call it the work of a lifetime — and I could use sharp eyes like yours."', choices: [choice('I\'ll keep watch for it', { rep: { research: 2 }, att: 3 }), leave] };
    return {
      npcLine: ch === 'boulder_badge'
        ? 'Oak: "Ah, the new trainer! Sketch me a strong bond with that starter of yours. The Boulder Badge in Pewter is the perfect first test."'
        : 'Oak: "Good to see you again! The region is moving faster than ever. Whatever path you walk, walk it well."',
      choices: [
        choice('What should I do next?', { att: 1 }),
        choice('Tell me about Lugia', { rep: { research: 1 } }),
        leave,
      ],
    };
  },

  // ——— Blue: cocky rival who tracks your record ———
  blue(npc, said) {
    if (beaten('blue'))
      return { npcLine: 'Blue scowls. "Tch. Don\'t let it go to your head. I\'ll be Champion before you — you\'ll see. Smell ya later."', choices: [leave] };
    if (said === 'You\'re all talk.')
      return { npcLine: 'Blue smirks. "Big words. Put your Pokémon where your mouth is, then!"', choices: [choice('Gladly — let\'s go!', { rep: { league: 1 }, battle: canBattle(npc) }), leave] };
    return {
      npcLine: `Blue blocks your path with a grin. "Well, if it isn't my rival. ${world.state.player.badges > 0 ? `One badge already? Lucky.` : `Still badgeless? Pathetic.`} Bet I'm stronger. Wanna find out?"`,
      choices: [
        choice('Bring it on!', { rep: { league: 1 }, battle: canBattle(npc) }),
        choice('You\'re all talk.', { att: -2 }),
        leave,
      ],
    };
  },

  // ——— Sal: innkeeper who knows too much about Giovanni ———
  sal(_npc, said) {
    const trusts = _npc.attitude >= 20;
    if (said === 'What do you know about Giovanni?') {
      return trusts
        ? { npcLine: 'Sal lowers his voice. "Between us? No one\'s ever seen Giovanni and the Rocket boss in the same room. Funny coincidence, that. Watch him."', choices: [choice('Thanks, Sal', { rep: { civic: 1 }, att: 2 }), leave] }
        : { npcLine: 'Sal shrugs, careful. "The Viridian Gym Leader? Respected man. I... wouldn\'t want to say more to a stranger."', choices: [choice('I\'ll earn your trust', { att: 3 }), leave] };
    }
    return {
      npcLine: 'Sal wipes down the counter. "Welcome to the inn. I hear every rumor that blows through Viridian — for the right company, I might even share one."',
      choices: [
        choice('What\'s the word around town?', { rep: { civic: 1 }, att: 1 }),
        choice('What do you know about Giovanni?', { rep: { research: 1 } }),
        leave,
      ],
    };
  },

  // ——— Elder Rosa: moral compass, warehouse worry ———
  elder_rosa(_npc, said) {
    if (chapterId() === 'the_warehouse' || chapterId() === 'bust_rocket')
      return { npcLine: 'Elder Rosa grips your hand. "Team Rocket\'s officer, Archer, runs the old warehouse on the south edge. Drive him out — Pewter is counting on you."', choices: [choice('I\'ll handle it', { rep: { civic: 2 }, att: 3 }), leave] };
    if (said === 'How is the town holding up?')
      return { npcLine: 'Rosa sighs. "Pewter is proud, but frightened. The League keeps us standing; Team Rocket would pull us down. Which will you be?"', choices: [choice('A protector of this town', { rep: { civic: 2 }, att: 2 }), leave] };
    return {
      npcLine: 'Elder Rosa studies you with old, sharp eyes. "I remember when the League was founded. I can tell a great deal about a person by how they carry themselves. You — you might matter."',
      choices: [
        choice('How is the town holding up?', { att: 1 }),
        choice('Any wisdom for me?', { rep: { research: 1 } }),
        leave,
      ],
    };
  },

  // ——— James: theatrical Rocket grunt, recruiting ———
  james(npc, said) {
    if (beaten('james'))
      return { npcLine: 'James dusts himself off dramatically. "Beaten again! ...You\'ve got spirit, kid. If you ever want EASY money, you know who to ask."', choices: [leave] };
    if (said === 'Tell me about Team Rocket')
      return { npcLine: 'James preens. "The finest organization in Kanto! Style, ambition, excellent uniforms. We\'re always recruiting talent. Are you talent?"', choices: [choice('Maybe I am', { rep: { rocket: 2 }, att: 3 }), choice('Not a chance', { rep: { civic: 1 }, att: -2 }), leave] };
    return {
      npcLine: 'A theatrical figure strikes a pose. "Prepare for trouble! I\'m James of Team Rocket. You\'ve wandered onto OUR route, little trainer."',
      choices: [
        choice('Get out of my way!', { rep: { league: 1 }, battle: canBattle(npc) }),
        choice('Tell me about Team Rocket', { rep: { research: 1 } }),
        leave,
      ],
    };
  },

  // ——— Ranger Iva: protector of wild Pokémon ———
  ranger_iva(npc, said) {
    if (said === 'How can I help the wild Pokémon?')
      return { npcLine: 'Iva nods approvingly. "Treat them with respect. Don\'t over-hunt the grass. Show me kindness in the wild and there may be a Ranger\'s post in your future."', choices: [choice('I\'d be honored', { rep: { research: 2, civic: 1 }, att: 4 }), leave] };
    return {
      npcLine: 'A weathered ranger looks up from the brush. "I\'m Iva. I keep these wilds safe — from poachers, and from Team Rocket. The Pokémon here remember who\'s kind to them."',
      choices: [
        choice('How can I help the wild Pokémon?', { rep: { research: 1 }, att: 2 }),
        choice('Care for a friendly battle?', { rep: { league: 1 }, battle: canBattle(npc) }),
        leave,
      ],
    };
  },

  // ——— Archer: cold, dangerous Rocket officer ———
  archer(npc, said) {
    if (beaten('archer'))
      return { npcLine: 'Archer regards you with quiet hatred. "Enjoy your little victory. You have no idea whose operation you\'ve disturbed."', choices: [leave] };
    if (said === 'Who do you answer to?')
      return { npcLine: 'Archer\'s expression doesn\'t change. "A name I do not speak. He sees everything. He would even... appreciate someone with your nerve. For a price."', choices: [choice('I\'m listening', { rep: { rocket: 2 }, att: 2 }), choice('Tell him I\'m coming', { rep: { civic: 1 }, att: -4 }), leave] };
    return {
      npcLine: 'A composed man in black blocks the warehouse. "I am Archer. This is private business. Turn around, and we need not become a problem for one another."',
      choices: [
        choice('Team Rocket ends here!', { rep: { league: 1, civic: 1 }, battle: canBattle(npc) }),
        choice('Who do you answer to?', { rep: { research: 1 } }),
        leave,
      ],
    };
  },
};

// Generic fallback for any NPC without an authored tree.
function generic(npc: NPC, said: string | null): DialogueTurn {
  if (said === 'Any rumors?')
    return { npcLine: `${npc.name}: "${world.state.rumors[0] ?? 'Quiet times, mostly.'}"`, choices: [leave] };
  const tone = npc.attitude > 30 ? `${npc.name} smiles warmly. "Good to see a friendly face."`
    : npc.attitude < -20 ? `${npc.name} eyes you warily. "I know what they say about you."`
    : `${npc.name} gives you a nod. "Safe travels, trainer."`;
  const choices = [choice('Any rumors?', { rep: { civic: 1 }, att: 1 })];
  if (canBattle(npc)) choices.push(choice('Care for a battle?', { rep: { league: 1 }, battle: true }));
  choices.push(leave);
  return { npcLine: tone, choices };
}

export function authoredDialogue(npc: NPC, said: string | null): DialogueTurn {
  const tree = TREES[npc.id] ?? generic;
  const turn = tree(npc, said);
  // always allow accepting a pending role offer from this NPC
  const oc = offerChoice(npc);
  if (oc && !turn.choices.some(c => c.acceptsOffer)) {
    turn.choices = [oc, ...turn.choices];
  }
  return turn;
}
