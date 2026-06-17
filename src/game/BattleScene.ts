import Phaser from 'phaser';
import { world } from '../world/store';
import { SPECIES, MOVES, typeMultiplier, makeMonster, xpToNext, type MonsterInstance } from '../world/monsters';
import type { NPC } from '../world/types';
import { MAP_W, MAP_H, TILE } from './maps';

// Turn-based battle. Type chart, speed order, party switching, items, XP/
// level-ups, catching, and a real blackout on loss. Winning NPC battles has
// WORLD consequences (reputation, slot claims).

interface BattleData { kind: 'npc' | 'wild'; npcId?: string; wild?: MonsterInstance }
const POTION_HEAL = 35;

export class BattleScene extends Phaser.Scene {
  private data2!: BattleData;
  private npc: NPC | null = null;
  private enemyParty: MonsterInstance[] = [];
  private enemyIdx = 0;
  private playerIdx = 0;
  private mode: 'main' | 'item' = 'main';
  private log!: Phaser.GameObjects.Text;
  private menu!: Phaser.GameObjects.Text;
  private info!: Phaser.GameObjects.Text;
  private foeHpBar!: Phaser.GameObjects.Graphics;
  private playerHpBar!: Phaser.GameObjects.Graphics;
  private busy = false;
  private over = false;
  private enemySprite?: Phaser.GameObjects.Image;
  private playerSpriteImg?: Phaser.GameObjects.Image;

  constructor() { super('battle'); }

  init(data: BattleData) {
    this.data2 = data;
    this.enemyIdx = 0;
    this.mode = 'main';
    this.busy = false;
    this.over = false;
    const party = world.state.player.party;
    this.playerIdx = Math.max(0, party.findIndex(m => m.hp > 0));
    if (this.playerIdx < 0) this.playerIdx = 0;
    if (data.kind === 'npc' && data.npcId) {
      this.npc = world.state.npcs[data.npcId];
      this.enemyParty = this.npc.party.map(m => ({ ...m, hp: m.maxHp }));
    } else {
      this.npc = null;
      this.enemyParty = [data.wild!];
    }
  }

  private get player(): MonsterInstance { return world.state.player.party[this.playerIdx]; }
  private get enemy(): MonsterInstance { return this.enemyParty[this.enemyIdx]; }

  create() {
    const W = MAP_W * TILE, H = MAP_H * TILE;
    this.add.rectangle(0, 0, W, H, 0xf8f8f0).setOrigin(0);
    this.add.ellipse(W - 90, 112, 120, 28, 0xb8d8a0);
    this.add.ellipse(98, H - 96, 140, 32, 0xb8d8a0);

    const eSpec = SPECIES[this.enemy.speciesId];
    const pSpec = SPECIES[this.player.speciesId];
    const eKey = `mon_${eSpec.dexId}`, pKey = `mon_back_${pSpec.dexId}`;
    const place = () => {
      this.enemySprite = this.add.image(W - 90, 84, eKey).setScale(1.2);
      this.playerSpriteImg = this.add.image(98, H - 126, pKey).setScale(1.5);
    };
    const needs: [string, string][] = [];
    if (!this.textures.exists(eKey)) needs.push([eKey, `/sprites/${eSpec.dexId}.png`]);
    if (!this.textures.exists(pKey)) needs.push([pKey, `/sprites/back_${pSpec.dexId}.png`]);
    if (needs.length) {
      needs.forEach(([k, url]) => this.load.image(k, url));
      this.load.once('complete', place);
      this.load.start();
    } else place();

    this.info = this.add.text(10, 8, '', { fontFamily: 'monospace', fontSize: '11px', color: '#22303c' });
    this.foeHpBar = this.add.graphics();
    this.playerHpBar = this.add.graphics();
    const logBg = this.add.rectangle(0, H - 100, W, 100, 0x101820, 0.94).setOrigin(0);
    logBg.setStrokeStyle(2, 0x2e4a63);
    this.log = this.add.text(10, H - 92, '', {
      fontFamily: 'monospace', fontSize: '11px', color: '#ffe9a0', wordWrap: { width: W - 20 },
    });
    this.menu = this.add.text(10, H - 52, '', { fontFamily: 'monospace', fontSize: '10px', color: '#9fd4ff', lineSpacing: 2 });

    const title = this.npc ? `${this.npc.name} challenges you!` : `A wild ${eSpec.name} appears!`;
    this.setLog(title);
    this.refresh();

    this.input.keyboard!.on('keydown', (ev: KeyboardEvent) => this.onKey(ev.key));
  }

  // ——— rendering ———
  private hpColor(ratio: number): number {
    return ratio > 0.5 ? 0x58c860 : ratio > 0.2 ? 0xe8c850 : 0xe05848;
  }
  private drawHpBar(g: Phaser.GameObjects.Graphics, x: number, y: number, ratio: number) {
    const w = 96, h = 7;
    g.clear();
    g.fillStyle(0x101820, 1); g.fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle(0x39424a, 1); g.fillRect(x, y, w, h);
    g.fillStyle(this.hpColor(ratio), 1); g.fillRect(x, y, Math.max(0, Math.round(w * ratio)), h);
  }

  private refresh() {
    const e = this.enemy, p = this.player;
    const eS = SPECIES[e.speciesId], pS = SPECIES[p.speciesId];
    const W = MAP_W * TILE, H = MAP_H * TILE;
    this.info.setText(
      `FOE  ${eS.name} Lv${e.level}` +
      (this.npc && this.enemyParty.length > 1 ? `  (${this.enemyIdx + 1}/${this.enemyParty.length})` : '') +
      `\nYOU  ${pS.name} Lv${p.level}  ${Math.max(0, p.hp)}/${p.maxHp} HP`,
    );
    this.drawHpBar(this.foeHpBar, W - 138, 40, Math.max(0, e.hp) / e.maxHp);
    this.drawHpBar(this.playerHpBar, 50, H - 150, Math.max(0, p.hp) / p.maxHp);

    if (this.over) { this.menu.setText('[SPACE] continue'); return; }
    if (this.mode === 'item') {
      const items = world.state.player.items;
      this.menu.setText(
        `ITEMS — [1] Potion x${items.potion ?? 0} (+${POTION_HEAL} HP)` +
        (this.data2.kind === 'wild' ? `   [2] Poké Ball x${items.pokeball ?? 0}` : '') +
        `   [B] back`,
      );
      return;
    }
    const moves = p.moves.map((m: string, i: number) => `[${i + 1}] ${MOVES[m].name}`).join('  ');
    const alive = world.state.player.party.filter(m => m.hp > 0).length;
    this.menu.setText(
      `${moves}\n[I] item${alive > 1 ? '   [P] switch' : ''}${this.data2.kind === 'wild' ? '   [C] catch' : ''}   [R] run`,
    );
  }

  private setLog(t: string) { this.log.setText(t); }

  private swapEnemySprite() {
    const spec = SPECIES[this.enemy.speciesId];
    const key = `mon_${spec.dexId}`;
    const apply = () => this.enemySprite?.setTexture(key);
    if (this.textures.exists(key)) apply();
    else { this.load.image(key, `/sprites/${spec.dexId}.png`); this.load.once('complete', apply); this.load.start(); }
  }
  private swapPlayerSprite() {
    const spec = SPECIES[this.player.speciesId];
    const key = `mon_back_${spec.dexId}`;
    const apply = () => this.playerSpriteImg?.setTexture(key);
    if (this.textures.exists(key)) apply();
    else { this.load.image(key, `/sprites/back_${spec.dexId}.png`); this.load.once('complete', apply); this.load.start(); }
  }

  // ——— input ———
  private onKey(key: string) {
    if (this.busy) return;
    if (this.over) { if (key === ' ') this.exit(''); return; }
    const k = key.toLowerCase();
    if (this.mode === 'item') {
      if (k === 'b' || key === 'Escape') { this.mode = 'main'; this.refresh(); return; }
      if (key === '1') this.usePotion();
      else if (key === '2' && this.data2.kind === 'wild') this.tryCatch();
      return;
    }
    const p = this.player;
    if (key >= '1' && key <= String(p.moves.length)) this.playerTurn(p.moves[Number(key) - 1]);
    else if (k === 'i') { this.mode = 'item'; this.refresh(); }
    else if (k === 'p') this.trySwitch();
    else if (k === 'c' && this.data2.kind === 'wild') this.tryCatch();
    else if (k === 'r') this.run();
  }

  private dmg(att: MonsterInstance, def: MonsterInstance, moveId: string): { dmg: number; eff: number } {
    const mv = MOVES[moveId];
    const defSpec = SPECIES[def.speciesId];
    const eff = typeMultiplier(mv.type, defSpec.type1, defSpec.type2);
    const stab = SPECIES[att.speciesId].type1 === mv.type ? 1.5 : 1;
    // softened defense term so high-def walls still take meaningful chip damage
    const base = (((2 * att.level) / 5 + 2) * mv.power * (att.atk / (def.def * 0.6 + 8))) / 50 + 2;
    return { dmg: Math.max(1, Math.floor(base * stab * eff * (0.85 + Math.random() * 0.15))), eff };
  }

  // an enemy turn against the player (shared by move/item turns)
  private async enemyAttack(): Promise<void> {
    const e = this.enemy, p = this.player;
    if (e.hp <= 0 || p.hp <= 0) return;
    const em = e.moves[Math.floor(Math.random() * e.moves.length)];
    const { dmg, eff } = this.dmg(e, p, em);
    p.hp -= dmg;
    this.setLog(`Foe ${SPECIES[e.speciesId].name} used ${MOVES[em].name}! ${effText(eff)}`);
    this.refresh();
    await wait(this, 700);
  }

  private async playerTurn(moveId: string) {
    this.busy = true;
    const p = this.player, e = this.enemy;
    const order = p.spd >= e.spd ? ['p', 'e'] : ['e', 'p'];
    for (const who of order) {
      if (p.hp <= 0 || e.hp <= 0) break;
      if (who === 'p') {
        const { dmg, eff } = this.dmg(p, e, moveId);
        e.hp -= dmg;
        this.setLog(`${SPECIES[p.speciesId].name} used ${MOVES[moveId].name}! ${effText(eff)}`);
        this.refresh();
        await wait(this, 700);
      } else {
        await this.enemyAttack();
      }
    }
    if (e.hp <= 0) return this.onEnemyFaint();
    if (p.hp <= 0) return this.onPlayerFaint();
    this.busy = false;
    this.refresh();
  }

  private async usePotion() {
    const items = world.state.player.items;
    if (!items.potion) { this.setLog('You have no Potions!'); return; }
    const p = this.player;
    if (p.hp >= p.maxHp) { this.setLog(`${SPECIES[p.speciesId].name} is already at full HP.`); return; }
    this.busy = true; this.mode = 'main';
    items.potion -= 1;
    p.hp = Math.min(p.maxHp, p.hp + POTION_HEAL);
    world.save();
    this.setLog(`You used a Potion. ${SPECIES[p.speciesId].name} recovered ${POTION_HEAL} HP!`);
    this.refresh();
    await wait(this, 700);
    await this.enemyAttack();          // using an item takes your turn
    if (p.hp <= 0) return this.onPlayerFaint();
    this.busy = false;
    this.refresh();
  }

  private async trySwitch() {
    const party = world.state.player.party;
    const next = party.findIndex((m, i) => i !== this.playerIdx && m.hp > 0);
    if (next < 0) { this.setLog('No other Pokémon can fight!'); return; }
    this.busy = true;
    this.playerIdx = next;
    this.swapPlayerSprite();
    this.setLog(`Go, ${SPECIES[this.player.speciesId].name}!`);
    this.refresh();
    await wait(this, 600);
    await this.enemyAttack();          // switching takes your turn
    if (this.player.hp <= 0) return this.onPlayerFaint();
    this.busy = false;
    this.refresh();
  }

  private async onEnemyFaint() {
    const fainted = this.enemy;
    this.setLog(`Foe ${SPECIES[fainted.speciesId].name} fainted!`);
    this.tweens.add({ targets: this.enemySprite, alpha: 0, y: '+=14', duration: 400 });
    await wait(this, 800);
    this.awardXp(fainted); // XP for every Pokémon you defeat
    if (this.npc && this.enemyIdx < this.enemyParty.length - 1) {
      this.enemyIdx++;
      if (this.enemySprite) { this.enemySprite.setAlpha(1); this.enemySprite.y -= 14; }
      this.swapEnemySprite();
      const lvl = this.pendingLevel ? ` (${this.pendingLevel})` : '';
      this.pendingLevel = '';
      this.setLog(`${this.npc.name} sends out ${SPECIES[this.enemy.speciesId].name}!${lvl}`);
      this.busy = false;
      this.refresh();
      return;
    }
    this.onWin();
  }

  // accumulate XP and level the active mon (with a visible message + a small heal)
  private awardXp(defeated: MonsterInstance) {
    const p = this.player;
    if (p.hp <= 0) return;
    const gain = Math.max(6, Math.round(defeated.level * 3.2 * (this.npc ? 1.3 : 1)));
    p.xp += gain;
    let leveled = false;
    while (p.hp > 0 && p.xp >= xpToNext(p.level)) {
      p.xp -= xpToNext(p.level);
      const hpRatio = p.hp / p.maxHp;
      const fresh = makeMonster(p.speciesId, p.level + 1, p.nickname);
      Object.assign(p, fresh, { xp: p.xp, hp: Math.max(1, Math.round(fresh.maxHp * hpRatio)) });
      leveled = true;
    }
    if (leveled) this.pendingLevel = `${SPECIES[p.speciesId].name} grew to Lv${p.level}!`;
  }
  private pendingLevel = '';

  private async onWin() {
    this.over = true; this.busy = false;
    let msg: string;
    if (this.npc) {
      this.npc.defeated = true;
      world.state.player.flags['beat_' + this.npc.id] = true;
      const isGymLeader = ['giovanni', 'brock'].includes(this.npc.id);
      const slot = Object.values(world.state.slots).find(sl => sl.holder === this.npc!.id);
      if (isGymLeader && !world.state.player.flags['badge_' + this.npc.id]) {
        world.state.player.flags['badge_' + this.npc.id] = true;
        world.state.player.badges++;
        world.state.player.money += 800;
        world.addRep({ league: 12, civic: 5 }, `defeating ${this.npc.name} in an official gym battle`);
        world.logEvent('battle_won', `Player defeated gym leader ${this.npc.name} and earned a badge (${world.state.player.badges} total).`);
        msg = `You earned a badge! (${world.state.player.badges} total, +¥800)`;
      } else {
        world.state.player.money += 200;
        const repKey = this.npc.faction === 'rocket' ? 'civic' : this.npc.faction === 'league' ? 'league' : 'civic';
        world.addRep({ [repKey]: 4 } as never, `defeating ${this.npc.name}`);
        if (this.npc.faction === 'rocket') world.addRep({ rocket: -6 }, `humiliating Team Rocket's ${this.npc.name}`);
        world.logEvent('battle_won', `Player defeated ${this.npc.name} (${this.npc.faction}) in battle.`);
        msg = `You beat ${this.npc.name}! (+¥200)`;
      }
      if (slot?.requires.defeatHolder) {
        const res = world.claimSlot(slot.id, true);
        if (res.ok) msg += `\n★ ${res.reason}`;
        else msg += `\n(${slot.title} could be yours: ${res.reason})`;
      }
      this.npc.attitude = Math.max(-100, this.npc.attitude - 5);
    } else {
      world.logEvent('battle_won', `Player defeated a wild ${SPECIES[this.enemy.speciesId].name}.`);
      msg = `The wild ${SPECIES[this.enemy.speciesId].name} fainted!`;
    }
    if (this.pendingLevel) { msg += `\n${this.pendingLevel}`; this.pendingLevel = ''; }
    world.save();
    this.setLog(msg);
    this.refresh();
  }

  // active mon fainted — switch to the next healthy one, or black out
  private async onPlayerFaint() {
    this.busy = true;
    this.setLog(`${SPECIES[this.player.speciesId].name} fainted!`);
    this.tweens.add({ targets: this.playerSpriteImg, alpha: 0, y: '+=14', duration: 400 });
    await wait(this, 900);
    const party = world.state.player.party;
    const next = party.findIndex(m => m.hp > 0);
    if (next >= 0) {
      this.playerIdx = next;
      if (this.playerSpriteImg) { this.playerSpriteImg.setAlpha(1); this.playerSpriteImg.y -= 14; }
      this.swapPlayerSprite();
      this.setLog(`Go, ${SPECIES[this.player.speciesId].name}!`);
      this.busy = false;
      this.refresh();
      return;
    }
    this.onBlackout();
  }

  private onBlackout() {
    this.over = true; this.busy = false;
    const pl = world.state.player;
    const penalty = Math.max(50, Math.floor(pl.money * 0.15));
    pl.money = Math.max(0, pl.money - penalty);
    pl.party.forEach(m => { m.hp = m.maxHp; }); // revived at the Center
    // respawn at the nearest town's safe spawn
    const town = townOf(pl.map);
    pl.map = town; pl.x = 10; pl.y = 16;
    world.logEvent('battle_lost', `Player blacked out${this.npc ? ` against ${this.npc.name}` : ''} and paid ¥${penalty}.`);
    world.save();
    this.setLog(`Your team has no fight left...\nYou scrambled back to ${world.state.towns[town]?.name ?? town} and paid ¥${penalty}. Your Pokémon were healed at the Center.`);
    this.refresh();
  }

  private async tryCatch() {
    if (world.state.player.party.length >= 6) {
      this.mode = 'main';
      this.setLog('Your party is full — you can\'t carry another Pokémon right now.');
      this.refresh();
      return;
    }
    const items = world.state.player.items;
    if (!items.pokeball) { this.mode = 'main'; this.setLog('You\'re out of Poké Balls! Buy more at the Mart.'); this.refresh(); return; }
    this.busy = true; this.mode = 'main';
    items.pokeball -= 1;
    const e = this.enemy;
    const spec = SPECIES[e.speciesId];
    const hpFactor = 1 - e.hp / e.maxHp;           // weaker = easier
    const chance = Math.min(0.92, spec.catchRate * 0.5 + hpFactor * 0.55);
    this.setLog(`You threw a Poké Ball... (${items.pokeball} left)`);
    world.save();
    await wait(this, 900);
    if (Math.random() < chance) {
      world.state.player.party.push({ ...e, hp: e.hp });
      world.logEvent('catch', `Player caught a ${spec.name} (Lv${e.level}).`);
      world.addRep({ research: 3 }, 'field research: new capture');
      world.save();
      this.over = true; this.busy = false;
      this.setLog(`Gotcha! ${spec.name} was caught!`);
      this.refresh();
      return;
    }
    this.setLog(`${spec.name} broke free!`);
    await wait(this, 600);
    await this.enemyAttack();
    if (this.player.hp <= 0) return this.onPlayerFaint();
    this.busy = false;
    this.refresh();
  }

  private run() {
    if (this.data2.kind === 'npc') { this.setLog("You can't run from a trainer battle!"); return; }
    const p = this.player, e = this.enemy;
    const odds = p.spd >= e.spd ? 0.9 : 0.55;
    if (Math.random() < odds) { this.exit('Got away safely.'); return; }
    this.busy = true;
    this.setLog("Can't escape!");
    this.time.delayedCall(700, async () => {
      await this.enemyAttack();
      if (this.player.hp <= 0) return this.onPlayerFaint();
      this.busy = false; this.refresh();
    });
  }

  private exit(result: string) {
    this.scene.stop();
    this.scene.resume('world', { battleResult: result || this.log.text.split('\n')[0] });
  }
}

function townOf(mapId: string): string {
  if (mapId.startsWith('int:')) return world.state.buildings[mapId.slice(4)]?.map ?? 'viridian';
  return world.state.towns[mapId] ? mapId : 'viridian';
}

function effText(eff: number): string {
  if (eff === 0) return 'It had no effect...';
  if (eff > 1) return "It's super effective!";
  if (eff < 1) return "It's not very effective...";
  return '';
}

function wait(scene: Phaser.Scene, ms: number) {
  return new Promise<void>(res => scene.time.delayedCall(ms, res));
}
