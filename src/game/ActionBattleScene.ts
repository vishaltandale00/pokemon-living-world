import Phaser from 'phaser';
import { world } from '../world/store';
import { SPECIES, type MonsterInstance } from '../world/monsters';
import type { NPC, RoleId } from '../world/types';
import { ActionEngine, STAGE_W, STAGE_H } from './action/engine';
import { BattleRenderer, type BattleAssets, type PoseSet } from './action/render';
import { toActionKit, toBossKit } from './action/kit';
import { applyBattleOutcome, awardXp, catchChance, type BattleOutcome, type OutcomeCtx } from '../world/battleOutcome';
import { GamepadPoller } from './gamepad';

interface BattleData { kind: 'npc' | 'wild'; npcId?: string; wild?: MonsterInstance }
const POTION_HEAL = 35;

// Real-time action battle. Fully replaces the menu BattleScene: same init payload
// and the same pause→launch→resume('world', {battleResult}) handshake, so world
// consequences + the story spine advance exactly as before. Rendering is a
// full-resolution DOM <canvas> overlay (native 960x540) so the hi-fi arena art
// isn't crushed by the world's 400x320 pixelArt framebuffer.
export class ActionBattleScene extends Phaser.Scene {
  private data2!: BattleData;
  private npc: NPC | null = null;
  private playerParty!: MonsterInstance[];
  private playerIdx = 0;
  private enemyParty!: MonsterInstance[];
  private enemyIdx = 0;
  private role?: RoleId;
  private isWild = false;

  private engine!: ActionEngine;
  private battleRenderer!: BattleRenderer;
  private view!: HTMLCanvasElement;       // presented overlay
  private octx!: CanvasRenderingContext2D;
  private stage!: HTMLCanvasElement;       // native 960x540 render target
  private sctx!: CanvasRenderingContext2D;
  private dpr = 1;
  private sprites = new Map<number, HTMLImageElement>();
  private poses = new Map<number, PoseSet>();   // optional AI-generated state frames, keyed by dexId

  private pad = new GamepadPoller();
  private held = new Set<string>();
  private onKeyDown!: (e: KeyboardEvent) => void;
  private onKeyUp!: (e: KeyboardEvent) => void;
  private onResize!: () => void;
  private ended = false;
  private cleaned = false;
  private levelMsgs: string[] = [];

  constructor() { super('actionBattle'); }

  init(data: BattleData) {
    this.data2 = data;
    this.ended = false;
    this.enemyIdx = 0;
    this.levelMsgs = [];
    this.isWild = data.kind === 'wild';
    this.playerParty = world.state.player.party;
    this.playerIdx = Math.max(0, this.playerParty.findIndex(m => m.hp > 0));
    if (this.playerIdx < 0) this.playerIdx = 0;
    if (data.kind === 'npc' && data.npcId) {
      this.npc = world.state.npcs[data.npcId];
      this.role = this.npc.role;
      this.enemyParty = this.npc.party.map(m => ({ ...m, hp: m.maxHp }));
    } else {
      this.npc = null;
      this.role = undefined;
      this.enemyParty = [data.wild!];
    }
  }

  create() {
    this.cleaned = false;
    // bail cleanly if there's nothing to fight (e.g. an NPC with an empty party,
    // or no healthy player mon) — never throw inside create() with the world paused
    if (!this.enemyParty.length || !this.playerParty.length || this.playerParty.every(m => m.hp <= 0)) {
      this.ended = true;
      this.time.delayedCall(0, () => { this.scene.stop(); this.scene.resume('world', { battleResult: '' }); });
      return;
    }
    // register teardown FIRST so a later throw can never orphan the overlay / leak listeners
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    // cap the action overlay at 1.5× device pixels: the full-window blit + per-frame
    // bloom blur is fill-bound, and 1.5× a 960×540 stage is still crisp on retina.
    this.dpr = Math.max(1, Math.min(1.5, window.devicePixelRatio || 1));

    // native render target
    this.stage = document.createElement('canvas');
    this.stage.width = STAGE_W * this.dpr; this.stage.height = STAGE_H * this.dpr;
    this.sctx = this.stage.getContext('2d')!;
    this.sctx.scale(this.dpr, this.dpr);
    this.sctx.imageSmoothingEnabled = true; this.sctx.lineJoin = 'round'; this.sctx.lineCap = 'round';

    // presented full-window overlay
    this.view = document.createElement('canvas');
    this.view.style.cssText = 'position:fixed;inset:0;z-index:60;background:#05080c;';
    document.body.appendChild(this.view);
    this.octx = this.view.getContext('2d')!;
    this.fitView();
    this.onResize = () => this.fitView();
    window.addEventListener('resize', this.onResize);

    this.battleRenderer = new BattleRenderer(this.dpr);

    const lead = this.playerParty[this.playerIdx];
    const opp = this.enemyParty[0];
    const intro = this.npc ? `${this.npc.name} challenges you!` : `A wild ${SPECIES[opp.speciesId].name} appears!`;
    this.engine = new ActionEngine(toActionKit(lead), toBossKit(opp, { role: this.role, wild: this.isWild, playerLevel: lead.level, bossId: this.npc?.id }), intro);
    this.engine.isWildBattle = this.isWild;
    this.engine.p.hp = this.engine.p.hpShown = Math.max(1, Math.min(lead.hp, this.engine.p.maxHp));

    this.preloadSprite(SPECIES[lead.speciesId].dexId);
    for (const m of this.enemyParty) this.preloadSprite(SPECIES[m.speciesId].dexId);

    // input — raw window listeners (capture phase) so they cooperate with main.ts
    // and never leak into the paused WorldScene. Phaser's own keyboard is disabled
    // for the duration so it can't double-handle.
    this.game.input.keyboard!.enabled = false;
    const HANDLED = new Set(['w', 'a', 's', 'd', 'j', 'k', 'l', 'u', 'i', 'o', 'h', 'c', 'f', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'escape']);
    this.onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!HANDLED.has(k)) return;
      e.stopImmediatePropagation(); e.preventDefault();
      if (this.held.has(k)) return; // ignore auto-repeat for action edges
      this.held.add(k);
      switch (k) {
        case 'j': this.engine.onPress('light'); break;
        case 'k': this.engine.onPress('heavy'); break;
        case 'l': this.engine.onPress('dodge'); break;
        case 'u': this.engine.onPress('U'); break;
        case 'i': this.engine.onPress('I'); break;
        case 'o': this.engine.onPress('O'); break;
        case 'h': this.tryHeal(); break;
        case 'c': if (this.isWild) this.engine.onPress('catch'); break;
        case 'f': case 'escape':
          if (this.isWild) this.engine.onPress('flee');
          else this.engine.setLog("Can't run from a trainer battle!");
          break;
      }
    };
    this.onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (HANDLED.has(k)) { e.stopImmediatePropagation(); this.held.delete(k); }
    };
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
  }

  private fitView() {
    if (!this.view) return;
    this.view.width = Math.floor(window.innerWidth * this.dpr);
    this.view.height = Math.floor(window.innerHeight * this.dpr);
    this.view.style.width = window.innerWidth + 'px';
    this.view.style.height = window.innerHeight + 'px';
    this.octx.imageSmoothingEnabled = true;
  }

  private preloadSprite(dexId: number) {
    if (!this.sprites.has(dexId)) {
      const img = new Image();
      img.src = `/sprites/${dexId}.png`;
      this.sprites.set(dexId, img);
    }
    // best-effort: load AI pose frames if they exist (a 404 just leaves width 0 → renderer falls back)
    if (!this.poses.has(dexId)) {
      const mk = (suffix: string) => { const im = new Image(); im.src = `/sprites/${dexId}_${suffix}.png`; return im; };
      this.poses.set(dexId, { idle: mk('idle'), atk: mk('atk'), hurt: mk('hurt') });
    }
  }
  private imgFor(m: MonsterInstance): HTMLImageElement | null {
    return this.sprites.get(SPECIES[m.speciesId].dexId) ?? null;
  }
  private posesFor(m: MonsterInstance): PoseSet | undefined {
    return this.poses.get(SPECIES[m.speciesId].dexId);
  }

  update(time: number) {
    if (this.ended || !this.engine) return;

    // movement vector from held keys, or the left stick / d-pad if a pad is connected
    const L = this.held.has('a') || this.held.has('arrowleft');
    const R = this.held.has('d') || this.held.has('arrowright');
    const U = this.held.has('w') || this.held.has('arrowup');
    const D = this.held.has('s') || this.held.has('arrowdown');
    let mx = (R ? 1 : 0) - (L ? 1 : 0), my = (D ? 1 : 0) - (U ? 1 : 0);
    const pad = this.pad.poll();
    if (pad.connected && (pad.mx || pad.my)) { mx = pad.mx; my = pad.my; }
    this.engine.setMove(mx, my);
    // pad action edges: A light · X heavy · B dodge · Y/LB/RB specials · RT heal · LT catch · Back flee
    if (pad.connected) {
      if (pad.A) this.engine.onPress('light');
      if (pad.X) this.engine.onPress('heavy');
      if (pad.B) this.engine.onPress('dodge');
      if (pad.Y) this.engine.onPress('I');
      if (pad.LB) this.engine.onPress('U');
      if (pad.RB) this.engine.onPress('O');
      if (pad.RT) this.tryHeal();
      if (pad.LT && this.isWild) this.engine.onPress('catch');
      if (pad.back && this.isWild) this.engine.onPress('flee');
    }
    this.engine.potions = world.state.player.items.potion ?? 0;

    this.engine.step(time);
    this.handleRequests();
    if (this.ended) return;   // a catch/flee request may have ended the battle
    this.handlePhase();
    if (this.ended) return;

    const assets: BattleAssets = {
      playerImg: this.imgFor(this.playerParty[this.playerIdx]),
      bossImg: this.imgFor(this.enemyParty[this.enemyIdx]),
      playerPoses: this.posesFor(this.playerParty[this.playerIdx]),
      bossPoses: this.posesFor(this.enemyParty[this.enemyIdx]),
    };
    this.battleRenderer.render(this.sctx, this.engine, assets);
    this.present();
  }

  private present() {
    const o = this.octx, v = this.view;
    o.fillStyle = '#05080c'; o.fillRect(0, 0, v.width, v.height);
    const sdw = STAGE_W * this.dpr, sdh = STAGE_H * this.dpr;
    const scale = Math.min(v.width / sdw, v.height / sdh);
    const dw = sdw * scale, dh = sdh * scale;
    o.drawImage(this.stage, 0, 0, sdw, sdh, (v.width - dw) / 2, (v.height - dh) / 2, dw, dh);
  }

  // catch / flee requests from the engine (wild only)
  private handleRequests() {
    if (this.engine.catchRequested) {
      this.engine.catchRequested = false;
      this.tryCatch();
    }
    if (this.engine.fleeRequested) {
      this.engine.fleeRequested = false;
      this.tryFlee();
    }
  }

  private tryHeal() {
    const items = world.state.player.items;
    if (!items.potion) { this.engine.setLog('No Potions left! Buy more at the Mart.'); return; }
    if (!this.engine.startHeal(POTION_HEAL)) return;   // busy / full HP → don't spend the item
    items.potion -= 1;
    world.save();
  }

  private tryCatch() {
    if (!this.isWild) return;
    const items = world.state.player.items;
    if (this.playerParty.length >= 6) { this.engine.setLog('Your party is full — no room for another.'); return; }
    if (!items.pokeball) { this.engine.setLog("Out of Poké Balls! Buy more at the Mart."); return; }
    items.pokeball -= 1;
    const b = this.engine.b, wild = this.enemyParty[0];
    const ratio = Math.max(0, b.hp / b.maxHp);
    const chance = catchChance(wild.speciesId, ratio);
    this.engine.ring(b.x, b.y, '236,203,115', 90);
    if (Math.random() < chance) {
      const caught: MonsterInstance = { ...wild, hp: Math.max(1, Math.round(wild.maxHp * ratio)) };
      this.finish('wild_caught', { wildSpeciesId: wild.speciesId, caught });
    } else {
      this.engine.setLog(`${SPECIES[wild.speciesId].name} broke free! (${items.pokeball} balls left)`);
      this.engine.pulseText(b.x, b.y - 60, 'broke free', '255,200,120', 14);
      world.save();
    }
  }

  private tryFlee() {
    if (!this.isWild) return;
    const p = this.playerParty[this.playerIdx], e = this.enemyParty[0];
    const odds = p.spd >= e.spd ? 0.9 : 0.55;
    if (Math.random() < odds) this.finish('wild_fled', { wildSpeciesId: e.speciesId });
    else { this.engine.setLog("Couldn't escape!"); this.engine.pulseText(this.engine.p.x, this.engine.p.y - 40, 'blocked!', '255,200,120', 14); }
  }

  // multi-mon party loop — mirrors BattleScene faint/switch semantics
  private handlePhase() {
    const eng = this.engine;
    if (eng.phase === 'boss_ko') {
      const defeated = this.enemyParty[this.enemyIdx];
      // sync surviving player hp, award XP for the kill
      this.playerParty[this.playerIdx].hp = Math.max(1, Math.round(eng.p.hp));
      const lvl = awardXp(this.playerParty[this.playerIdx], defeated, !!this.npc);
      if (lvl) { this.levelMsgs.push(lvl); eng.pulseText(eng.p.x, eng.p.y - 64, 'LEVEL UP!', '120,230,150', 22); }
      if (this.enemyIdx < this.enemyParty.length - 1) {
        this.enemyIdx++;
        const next = this.enemyParty[this.enemyIdx];
        this.preloadSprite(SPECIES[next.speciesId].dexId);
        eng.swapBoss(toBossKit(next, { role: this.role, wild: this.isWild, playerLevel: this.playerParty[this.playerIdx].level, bossId: this.npc?.id }), `${this.npc?.name ?? 'Foe'} sends out ${SPECIES[next.speciesId].name}!`);
      } else {
        this.finish(this.npc ? 'npc_win' : 'wild_win', { npcId: this.npc?.id, wildSpeciesId: defeated.speciesId });
      }
    } else if (eng.phase === 'player_ko') {
      this.playerParty[this.playerIdx].hp = 0;
      const next = this.playerParty.findIndex(m => m.hp > 0);
      if (next >= 0) {
        this.playerIdx = next;
        const m = this.playerParty[next];
        this.preloadSprite(SPECIES[m.speciesId].dexId);
        eng.swapPlayer(toActionKit(m), `Go, ${SPECIES[m.speciesId].name}!`);
        eng.p.hp = eng.p.hpShown = Math.max(1, Math.min(m.hp, eng.p.maxHp));
      } else {
        this.finish('blackout', { npcId: this.npc?.id });
      }
    }
  }

  private finish(outcome: BattleOutcome, ctx: OutcomeCtx) {
    if (this.ended) return;
    this.ended = true;
    let msg = applyBattleOutcome(outcome, ctx);
    if (this.levelMsgs.length) msg += '\n' + this.levelMsgs.join('\n');
    this.cleanup();
    this.scene.stop();
    this.scene.resume('world', { battleResult: msg });
  }

  private cleanup() {
    if (this.cleaned) return;
    this.cleaned = true;
    if (this.onKeyDown) window.removeEventListener('keydown', this.onKeyDown, true);
    if (this.onKeyUp) window.removeEventListener('keyup', this.onKeyUp, true);
    if (this.onResize) window.removeEventListener('resize', this.onResize);
    this.view?.remove();
    this.held.clear();
    if (this.game?.input?.keyboard) this.game.input.keyboard.enabled = true;
    // clear any keys the world might think are still held (it was paused while we ran)
    (this.scene.get('world') as Phaser.Scene | null)?.input?.keyboard?.resetKeys();
  }
}
