// Shared world-consequence layer for battles. Both the action battle and (in
// future) the menu battle funnel through here so badges / money / reputation /
// role-slot claims / catches stay in exactly one place.
//
// LOSS policy (decision D4): a real money penalty applies on ALL losses incl.
// trainer + gym — the team is healed and you wake at the nearest town, minus
// max(50, 15% of money). (This overrides PLAN.md's earlier no-penalty note.)
import { world } from './store';
import { SPECIES, makeMonster, xpToNext, type MonsterInstance } from './monsters';

export type BattleOutcome = 'npc_win' | 'wild_win' | 'wild_caught' | 'wild_fled' | 'blackout';

export interface OutcomeCtx {
  npcId?: string;
  wildSpeciesId?: string;
  caught?: MonsterInstance;   // the instance to add to the party on a successful catch
}

const GYM_LEADERS = ['giovanni', 'brock'];

function townOf(mapId: string): string {
  if (mapId.startsWith('int:')) return world.state.buildings[mapId.slice(4)]?.map ?? 'viridian';
  return world.state.towns[mapId] ? mapId : 'viridian';
}

// Accumulate XP into the active mon and level it up.
// Returns a "grew to LvN!" line if it leveled, else null.
export function awardXp(player: MonsterInstance, defeated: MonsterInstance, isNpc: boolean): string | null {
  if (player.hp <= 0) return null;
  const gain = Math.max(6, Math.round(defeated.level * 3.2 * (isNpc ? 1.3 : 1)));
  player.xp += gain;
  let leveled = false;
  while (player.hp > 0 && player.xp >= xpToNext(player.level)) {
    player.xp -= xpToNext(player.level);
    const hpRatio = player.hp / player.maxHp;
    const fresh = makeMonster(player.speciesId, player.level + 1, player.nickname);
    Object.assign(player, fresh, { xp: player.xp, hp: Math.max(1, Math.round(fresh.maxHp * hpRatio)) });
    leveled = true;
  }
  return leveled ? `${SPECIES[player.speciesId].name} grew to Lv${player.level}!` : null;
}

// Compute the catch chance for a weakened wild mon.
export function catchChance(speciesId: string, hpRatio: number): number {
  const spec = SPECIES[speciesId];
  return Math.min(0.92, spec.catchRate * 0.5 + (1 - hpRatio) * 0.55);
}

// Apply the world-level consequences of a finished battle and return a banner string.
export function applyBattleOutcome(outcome: BattleOutcome, ctx: OutcomeCtx = {}): string {
  const pl = world.state.player;
  let msg = '';

  if (outcome === 'npc_win' && ctx.npcId) {
    const npc = world.state.npcs[ctx.npcId];
    npc.defeated = true;
    pl.flags['beat_' + npc.id] = true;
    const isGymLeader = GYM_LEADERS.includes(npc.id);
    const slot = Object.values(world.state.slots).find(sl => sl.holder === npc.id);
    if (isGymLeader && !pl.flags['badge_' + npc.id]) {
      pl.flags['badge_' + npc.id] = true;
      pl.badges++;
      pl.money += 800;
      world.addRep({ league: 12, civic: 5 }, `defeating ${npc.name} in an official gym battle`);
      world.logEvent('battle_won', `Player defeated gym leader ${npc.name} and earned a badge (${pl.badges} total).`);
      msg = `You earned a badge! (${pl.badges} total, +¥800)`;
    } else {
      pl.money += 200;
      const repKey = npc.faction === 'rocket' ? 'civic' : npc.faction === 'league' ? 'league' : 'civic';
      world.addRep({ [repKey]: 4 } as never, `defeating ${npc.name}`);
      if (npc.faction === 'rocket') world.addRep({ rocket: -6 }, `humiliating Team Rocket's ${npc.name}`);
      world.logEvent('battle_won', `Player defeated ${npc.name} (${npc.faction}) in battle.`);
      msg = `You beat ${npc.name}! (+¥200)`;
    }
    if (slot?.requires.defeatHolder) {
      const res = world.claimSlot(slot.id, true);
      if (res.ok) msg += `\n★ ${res.reason}`;
      else msg += `\n(${slot.title} could be yours: ${res.reason})`;
    }
    npc.attitude = Math.max(-100, npc.attitude - 5);
  } else if (outcome === 'wild_win') {
    const name = SPECIES[ctx.wildSpeciesId ?? '']?.name ?? 'wild Pokémon';
    world.logEvent('battle_won', `Player defeated a wild ${name}.`);
    msg = `The wild ${name} fainted!`;
  } else if (outcome === 'wild_caught' && ctx.caught) {
    const spec = SPECIES[ctx.caught.speciesId];
    pl.party.push(ctx.caught);
    world.logEvent('catch', `Player caught a ${spec.name} (Lv${ctx.caught.level}).`);
    world.addRep({ research: 3 }, 'field research: new capture');
    msg = `Gotcha! ${spec.name} was caught!`;
  } else if (outcome === 'wild_fled') {
    msg = 'Got away safely.';
  } else if (outcome === 'blackout') {
    // D4: penalty on all losses. Pay max(50, 15% of money), heal, wake at nearest town.
    const penalty = Math.max(50, Math.floor(pl.money * 0.15));
    pl.money = Math.max(0, pl.money - penalty);
    pl.party.forEach(m => { m.hp = m.maxHp; });
    const town = townOf(pl.map);
    pl.map = town; pl.x = 10; pl.y = 16;
    const where = world.state.towns[town]?.name ?? town;
    world.logEvent('battle_lost', `Player's team was downed${ctx.npcId ? ` against ${world.state.npcs[ctx.npcId]?.name ?? ctx.npcId}` : ''} and paid ¥${penalty}, recovering at ${where}.`);
    msg = `Your team was downed — you scrambled to the ${where} Center and paid ¥${penalty}. Your Pokémon were healed.`;
  }

  world.save();
  return msg;
}
