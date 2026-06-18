// Action-combat simulation, ported from experiments/soulslike-battle.
//
// Framework-agnostic: owns all combat + juice state, exposes step()/onPress()/
// setMove() and a read-only snapshot the renderer consumes. The boss is a single
// blob (real sprite), so hit-tests are circle-based; the player's typed moves are
// ranged specials carrying super-effective/resisted/immune pressure via the
// game's typeMultiplier.
import { typeMultiplier } from '../../world/monsters';
import { vfxEl, type ActionKit, type BossKit, type ActionSpecial, type ActionEl } from './kit';

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const hyp = Math.hypot;
const norm = (x: number, y: number) => { const l = hyp(x, y) || 1; return { x: x / l, y: y / l }; };

export const STAGE_W = 960;
export const STAGE_H = 540;

export type EnginePhase = 'fighting' | 'boss_ko' | 'player_ko';

interface BossMoveDef {
  kind: 'sweep' | 'spear' | 'slam' | 'ring' | 'combo';
  name: string;
  tell: number; active: number; recover: number;
  mult: number;          // damage = round(atkBase * mult)
  reach?: number; len?: number; hw?: number; hh?: number; radius?: number; inner?: number; outer?: number;
}

const BOSS_MOVES: Record<string, BossMoveDef> = {
  sweep: { kind: 'sweep', name: 'Tail Sweep', tell: 700, active: 175, recover: 700, mult: 1.0, reach: 150 },
  spear: { kind: 'spear', name: 'Spear Line', tell: 800, active: 210, recover: 560, mult: 1.35, len: 760, hw: 46 },
  slam: { kind: 'slam', name: 'Crushing Slam', tell: 1000, active: 195, recover: 780, mult: 1.85, radius: 100 },
  ring: { kind: 'ring', name: 'Shockwave Ring', tell: 720, active: 230, recover: 600, mult: 1.2, inner: 76, outer: 196 },
  combo: { kind: 'combo', name: "Pressure Combo", tell: 470, active: 140, recover: 420, mult: 0.85, hw: 130, hh: 74 },
};

export interface PlayerState {
  kit: ActionKit;
  x: number; y: number; r: number;
  hp: number; maxHp: number; hpShown: number;
  stamina: number; maxStamina: number; focus: number; maxFocus: number;
  faceX: number; faceY: number; dir: number; moving: boolean;
  dodge: number; inv: number; vx: number; vy: number;
  atk: PlayerAttack | null;
  heal: { t: number; dur: number; amount: number } | null;
  cd: Record<string, number>; cdMax: Record<string, number>;
  refunded: Record<string, boolean>; regenLock: number;
  combo: number; comboT: number; chain: number; dead: number; just: number;
}
interface PlayerAttack {
  kind: 'light' | 'heavy' | 'cone' | 'castpose';
  el: ActionEl; t: number; total: number; hit: boolean;
  dmg: number; posture: number; range: number;
  arc?: number; slot?: string; ticks?: number; tickT?: number;
  chain?: number; finisher?: boolean;
}
export interface BossState {
  kit: BossKit;
  x: number; y: number; r: number;
  hp: number; maxHp: number; hpShown: number;
  type1: string; type2: string | null; name: string; element: string; level: number; roleLabel: string;
  face: number; posture: number; maxPosture: number; lastHit: number;
  state: 'idle' | 'tell' | 'active' | 'recover' | 'broken';
  timer: number; tellTotal: number; move: BossMoveDef | null;
  target: { x: number; y: number }; hit: boolean;
  phase: number; broken: number; flash: number; atkBase: number;
}

interface Particle { type: string; x: number; y: number; vx?: number; vy?: number; life: number; max: number; col?: string; w?: number; rot?: number; vr?: number; grav?: number; r?: number; r0?: number; r1?: number; }
interface Shot { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; el: ActionEl; dmg: number; posture: number; slot: string; rot: number; vr: number; kind: string; angle: number; }
interface FloatText { x: number; y: number; txt: string; rgb: string; size: number; life: number; max: number; }
interface Ghost { x: number; y: number; life: number; max: number; color: string; }

function freshPlayer(kit: ActionKit): PlayerState {
  return {
    kit, x: 300, y: 372, r: 14, hp: kit.hp, maxHp: kit.hp, hpShown: kit.hp,
    stamina: 100, maxStamina: 100, focus: 0, maxFocus: 100,
    faceX: 1, faceY: 0, dir: 1, moving: false,
    dodge: 0, inv: 0, vx: 0, vy: 0, atk: null, heal: null,
    cd: { U: 0, I: 0, O: 0 }, cdMax: {}, refunded: { U: false, I: false, O: false }, regenLock: 0,
    combo: 0, comboT: 0, chain: 0, dead: 0, just: 0,
  };
}
function freshBoss(kit: BossKit): BossState {
  return {
    kit, x: 650, y: 300, r: kit.radius, hp: kit.hpPool, maxHp: kit.hpPool, hpShown: kit.hpPool,
    type1: kit.type1, type2: kit.type2, name: kit.name, element: kit.element, level: kit.level, roleLabel: kit.roleLabel,
    face: -1, posture: 0, maxPosture: kit.maxPosture, lastHit: 999,
    state: 'idle', timer: 1100, tellTotal: 1, move: null, target: { x: 0, y: 0 }, hit: false,
    phase: 1, broken: 0, flash: 0, atkBase: kit.atkBase,
  };
}

export class ActionEngine {
  readonly W = STAGE_W;
  readonly H = STAGE_H;
  p: PlayerState;
  b: BossState;
  phase: EnginePhase = 'fighting';

  // juice / camera globals
  time = 0; private prev = 0; started = false;
  hitstop = 0; shake = 0; slow = 1; flash = 0; zoom = 1; introT = 2400;
  camX = STAGE_W / 2; camY = STAGE_H / 2; kickX = 0; kickY = 0;
  impact = 0; impactX = 0; impactY = 0;
  groundFlash = 0; groundFlashX = 0; groundFlashY = 0;
  winT = 0; comboPop = 0;
  log = '';
  isWildBattle = false;   // set by the scene; drives the catch/flee HUD hint
  potions = 0;            // set by the scene each frame; drives the heal HUD count

  fx: Particle[] = []; texts: FloatText[] = []; ghosts: Ghost[] = [];
  decals: Particle[] = []; shots: Shot[] = []; dust: Particle[] = [];
  cracks: { x: number; y: number }[][] = []; pebbles: { x: number; y: number; r: number; s: number }[] = [];

  // input
  private mv = { x: 0, y: 0 };
  private dodgeBuf = 0; private atkBuf = 0; private atkBufType: 'light' | 'heavy' = 'light';
  catchRequested = false; fleeRequested = false;

  constructor(playerKit: ActionKit, bossKit: BossKit, intro = '') {
    this.p = freshPlayer(playerKit);
    this.b = freshBoss(bossKit);
    this.log = intro;
    for (let i = 0; i < 46; i++) this.dust.push({ type: 'dust', x: rnd(0, this.W), y: rnd(this.H * 0.4, this.H), r: rnd(0.6, 2.2), vx: rnd(-6, 6), vy: rnd(-16, -4), life: 1, max: 1, col: String(rnd(0.05, 0.22)) });
    for (let k = 0; k < 5; k++) { const pts: { x: number; y: number }[] = []; let cx = rnd(this.W * 0.28, this.W * 0.72), cy = rnd(this.H * 0.56, this.H * 0.84), a = rnd(0, TAU); for (let s = 0; s < 5; s++) { pts.push({ x: cx, y: cy }); a += rnd(-0.8, 0.8); const d = rnd(26, 60); cx += Math.cos(a) * d; cy += Math.sin(a) * d * 0.5; } this.cracks.push(pts); }
    for (let k = 0; k < 22; k++) this.pebbles.push({ x: rnd(80, this.W - 80), y: rnd(this.H * 0.50, this.H - 30), r: rnd(2, 6), s: rnd(0.4, 0.9) });
  }

  // ——— public API ———
  setMove(x: number, y: number) { this.mv = norm(x, y); if (!x && !y) this.mv = { x: 0, y: 0 }; }
  setLog(s: string) { this.log = s; }

  onPress(action: 'light' | 'heavy' | 'dodge' | 'U' | 'I' | 'O' | 'catch' | 'flee') {
    if (this.phase !== 'fighting') return;
    switch (action) {
      case 'light': this.atkBuf = 160; this.atkBufType = 'light'; break;
      case 'heavy': this.atkBuf = 160; this.atkBufType = 'heavy'; break;
      case 'dodge': this.dodgeBuf = 160; break;
      case 'U': case 'I': case 'O': this.useSpecial(action); break;
      case 'catch': this.catchRequested = true; break;
      case 'flee': this.fleeRequested = true; break;
    }
  }

  // swap a defeated boss for the opponent's next party member (multi-mon)
  swapBoss(kit: BossKit, intro: string) {
    this.b = freshBoss(kit);
    this.winT = 0; this.introT = 900; this.phase = 'fighting';
    this.shots.length = 0; this.log = intro;
  }
  // swap a fainted player mon for the next healthy party member
  swapPlayer(kit: ActionKit, intro: string) {
    const stamina = 100;
    this.p = freshPlayer(kit); this.p.stamina = stamina;
    this.introT = 700; this.phase = 'fighting'; this.log = intro;
  }

  step(now: number) {
    if (!this.started) { this.prev = now; this.started = true; }
    this.time = now;
    if (this.phase !== 'fighting') { this.prev = now; return; }
    let dt = Math.min(32, now - this.prev); this.prev = now;
    if (this.hitstop > 0) { this.hitstop -= dt; dt *= 0.04; }
    dt *= this.slow;
    this.playerUpdate(dt);
    this.bossThink(dt);
    this.updateShots(dt);
    this.updateFx(dt);
  }

  // ——— combat ———
  private input() { return this.mv; }
  private aim() { const v = this.mv; if (v.x || v.y) return v; return norm(this.b.x - this.p.x, this.b.y - this.p.y); }
  private busy() { const p = this.p; return !!(p.dead || this.winT > 0 || p.atk || p.heal); }

  // Begin a Potion channel. Returns false (so the scene doesn't spend the item) if
  // the player can't heal right now or is already at full HP. Vulnerable: a hit cancels it.
  startHeal(amount: number): boolean {
    const p = this.p;
    if (this.phase !== 'fighting' || this.busy() || p.dodge > 0) return false;
    if (p.hp >= p.maxHp) { this.pulseText(p.x, p.y - 36, 'full HP', '150,200,160', 12); return false; }
    p.heal = { t: 700, dur: 700, amount };
    this.log = 'Drinking a Potion — hold steady!';
    return true;
  }

  private bodyHit(x: number, y: number, fx: number, fy: number, reach: number, cosArc: number) {
    const b = this.b; const dx = b.x - x, dy = b.y - y, l = hyp(dx, dy); const dd = l - b.r;
    if (dd > reach) return null;
    if (cosArc > -1 && l > 0.001 && (dx / l * fx + dy / l * fy) < cosArc) return null;
    return { x: b.x, y: b.y, dd };
  }
  private bodyDist(x: number, y: number) { const b = this.b; return { d: hyp(x - b.x, y - b.y) - b.r, x: b.x, y: b.y }; }

  private tryAttack() {
    const p = this.p;
    if (this.busy() || p.dodge > 0) return false;
    const type = this.atkBufType; const m = type === 'heavy' ? p.kit.heavy : p.kit.light; const heavy = type === 'heavy';
    if (p.stamina < m.sta) { this.atkBuf = 0; this.pulseText(p.x, p.y - 36, 'no stamina', '239,81,72', 13); return false; }
    p.stamina -= m.sta;
    const bi = this.bodyDist(p.x, p.y);
    if (bi.d < m.range * 0.6 + 40) { const f = norm(bi.x - p.x, bi.y - p.y); p.faceX = f.x; p.faceY = f.y; if (f.x) p.dir = Math.sign(f.x); }
    const inCombo = p.comboT > 0;
    let total: number, dmg = m.dmg, posture = m.posture, chain = 0, finisher = false, label = m.name + '.';
    if (heavy) {
      total = 560; p.chain = 0;
      if (inCombo) { finisher = true; dmg = Math.round(dmg * 1.35); posture = Math.round(posture * 1.45); label = m.name + ' — FINISHER!'; }
    } else {
      chain = inCombo ? (p.chain + 1) % 3 : 0; p.chain = chain;
      if (chain === 2) { total = 300; posture = Math.round(posture * 1.7); dmg = Math.round(dmg * 1.3); finisher = true; label = m.name + ' — flurry finish!'; }
      else total = chain === 1 ? 195 : 230;
    }
    p.comboT = 820;
    p.atk = { kind: type, el: m.el, t: total, total, hit: false, dmg, posture, range: m.range, chain, finisher };
    this.log = label;
    return true;
  }

  private tryDodge() {
    const p = this.p;
    if (this.busy() || p.dodge > 0) return false;
    if (p.stamina < p.kit.dodgeCost) { this.dodgeBuf = 0; this.pulseText(p.x, p.y - 36, 'no stamina', '239,81,72', 13); return false; }
    p.stamina -= p.kit.dodgeCost;
    const v = this.input(); const dv = p.kit.dodgeVel; p.dodge = 310; p.inv = 210;
    p.vx = (v.x || p.faceX) * dv; p.vy = (v.y || p.faceY) * dv; if (v.x) p.dir = Math.sign(v.x);
    if (this.ghosts.length < 64) this.ghosts.push({ x: p.x, y: p.y, life: 300, max: 300, color: '#67c9ff' });
    if (p.kit.dodgeEl === 'water') { this.splashRing(p.x, p.y); }
    this.atkBuf = 0;
    return true;
  }

  private useSpecial(slot: 'U' | 'I' | 'O') {
    const p = this.p;
    if (this.busy() || p.dodge > 0) return;
    const s = p.kit.specials.find(x => x.slot === slot); if (!s) return;
    if (p.cd[slot] > 0) { this.pulseText(p.x, p.y - 36, 'on cooldown', '150,180,200', 12); return; }
    if (p.stamina < s.sta) { this.pulseText(p.x, p.y - 36, 'no stamina', '239,81,72', 12); return; }
    p.stamina -= s.sta; p.regenLock = 600;
    const fireCd = p.kit.element === 'fire' ? 0.85 : 1;
    p.refunded[slot] = false;
    p.cd[slot] = s.cd * fireCd; p.cdMax[slot] = p.cd[slot];
    const a = this.aim();
    if (s.kind === 'cone') {
      p.atk = { kind: 'cone', el: s.el, t: s.active ?? 250, total: s.active ?? 250, hit: false, dmg: s.dmg, posture: s.posture, range: s.range, arc: s.arc ?? 0.9, slot, ticks: Math.max(1, Math.round((s.active ?? 250) / 110)), tickT: 0 };
      if (a.x || a.y) { p.faceX = a.x; p.faceY = a.y; if (a.x) p.dir = Math.sign(a.x); }
    } else {
      this.spawnSpread(s, a, slot);
      p.atk = { kind: 'castpose', el: s.el, t: 200, total: 200, hit: true, dmg: 0, posture: 0, range: 0 };
      if (a.x) p.dir = Math.sign(a.x);
    }
    this.log = s.name + '!';
  }

  private spawnSpread(s: ActionSpecial, a: { x: number; y: number }, slot: string) {
    const p = this.p; const base = Math.atan2(a.y, a.x); const n = s.count || 1; const speed = s.speed ?? 540;
    for (let i = 0; i < n && this.shots.length < 48; i++) {
      const off = n === 1 ? 0 : (i - (n - 1) / 2) * (s.spread || 0);
      const ang = base + off;
      const vfx = vfxEl(s.el);
      this.shots.push({ x: p.x + Math.cos(base) * 18, y: p.y + Math.sin(base) * 18 - 6, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, life: (s.range / speed) * 1000, max: (s.range / speed) * 1000, r: s.pr ?? 8, el: s.el, dmg: s.dmg, posture: s.posture, slot, rot: 0, vr: rnd(-12, 12), kind: vfx === 'water' ? 'lance' : vfx === 'grass' ? 'leaf' : vfx === 'fire' ? 'blast' : 'orb', angle: ang });
    }
  }

  // shared hit resolver — type math via the game's typeMultiplier
  private resolveHit(o: { el: ActionEl; tEl?: ActionEl; dmg: number; posture: number; isSpecial?: boolean; finisher?: boolean; slot?: string; cx: number; cy: number; heavy?: boolean; big?: boolean }) {
    if (this.winT > 0) return;
    const p = this.p, b = this.b;
    const tel = o.tEl !== undefined ? o.tEl : o.el;
    const punish = b.state === 'recover' || b.broken > 0 || p.just > 0;
    const elMult = tel ? typeMultiplier(tel, b.type1, b.type2) : 1;          // 0 / 0.7 / 1 / 1.6
    const postFactor = elMult > 1 ? 1.4 : elMult === 0 ? 0 : elMult < 1 ? 0.85 : 1;
    let dmg = o.dmg || 0;
    if (p.kit.element === 'fire' && !tel) dmg *= 1.12;
    dmg = Math.round(dmg * elMult * (punish ? 1.45 : 1));
    let post = (o.posture || 0) * postFactor * (punish ? 1.45 : 1);
    const cm = 1 + Math.min(p.combo, 12) * 0.025;
    dmg = Math.round(dmg * cm); post *= cm;
    p.combo++; p.comboT = Math.max(p.comboT, 820); this.comboPop = 1;
    if (dmg > 0) b.hp = clamp(b.hp - dmg, 0, b.maxHp);
    b.posture = clamp(b.posture + post, 0, b.maxPosture); b.lastHit = 0;
    p.focus = clamp(p.focus + 5 + (o.posture || 0) * 0.18, 0, p.maxFocus);
    b.flash = 120;
    const cx = o.cx, cy = o.cy;
    this.hitVfx(o.el, cx, cy, o.big);
    if (o.finisher) { this.shake = Math.max(this.shake, 13); this.hitstop = Math.max(this.hitstop, 110); this.flash = Math.max(this.flash, 55); this.ring(cx, cy, vfxEl(o.el) === 'water' ? '150,210,255' : vfxEl(o.el) === 'grass' ? '150,230,160' : '255,200,120', 95); this.spark(cx, cy, '255,240,200', 18); }
    const justHit = p.just > 0;
    if (elMult === 0) this.pulseText(cx, cy - 28, 'no effect', '150,170,190', 14);
    else if (dmg > 0) this.pulseText(cx, cy - 28, String(dmg), justHit ? '120,230,255' : punish ? '236,203,115' : '237,247,255', justHit ? 24 : punish ? 22 : 18);
    if (o.isSpecial && elMult > 1 && o.slot && !p.refunded[o.slot]) { p.refunded[o.slot] = true; p.cd[o.slot] = Math.max(0, p.cd[o.slot] * 0.65); this.pulseText(cx, cy - 50, 'CD -35%', '150,230,160', 12); }
    this.hitstop = Math.max(this.hitstop, o.heavy ? 100 : 56); this.shake = Math.max(this.shake, o.heavy ? 11 : 6); this.zoom = Math.max(this.zoom, o.heavy ? 1.05 : 1.02);
    this.impact = 1; this.impactX = cx; this.impactY = cy;
    this.log = punish ? (elMult > 1 ? 'Super-effective punish — posture buckles.' : 'Clean punish. Posture buckles.') : (elMult > 1 ? 'Super-effective hit.' : elMult < 1 ? 'Resisted — chip it down.' : 'Hit.');
    if (b.posture >= b.maxPosture && b.broken <= 0 && b.hp > 0) this.doPostureBreak(cx, cy);
    if (b.hp <= 0) { this.winT = 1700; b.broken = 1e9; b.state = 'broken'; b.move = null; this.flash = 100; this.ring(b.x, b.y, '236,203,115', 180); this.ring(b.x, b.y, '255,240,180', 240); this.spark(b.x, b.y, '255,230,160', 30); this.shake = Math.max(this.shake, 10); this.log = `${b.name} is defeated!`; }
  }
  private doPostureBreak(cx: number, cy: number) { const b = this.b; b.posture = 0; b.broken = 1450; b.state = 'broken'; b.move = null; this.flash = 130; this.ring(b.x, b.y, '236,203,115', 120); this.ring(b.x, b.y, '255,240,180', 170); this.spark(b.x, b.y, '236,203,115', 26); this.pulseText(b.x, b.y - 120, 'POSTURE BREAK', '236,203,115', 22); this.log = `${b.name} is staggered — heavy attack now!`; }

  private checkPlayerHit() {
    const p = this.p; const a = p.atk!;
    if (a.hit && a.kind !== 'cone') return;
    if (a.kind === 'cone') {
      const seg = this.bodyHit(p.x, p.y, p.faceX, p.faceY, a.range, Math.cos((a.arc ?? 0.9) + 0.2));
      if (seg) this.resolveHit({ el: a.el, dmg: a.dmg / (a.ticks || 1), posture: a.posture / (a.ticks || 1), isSpecial: true, slot: a.slot, cx: seg.x, cy: seg.y, big: true });
      return;
    }
    const reach = a.range * 0.6 + 10;
    const seg = this.bodyHit(p.x, p.y, p.faceX, p.faceY, reach, Math.cos(1.4));
    if (!seg) return;
    a.hit = true;
    // melee (light + heavy) is reliable PHYSICAL chip (tEl null); typed pressure comes from specials
    this.resolveHit({ el: a.el, tEl: null, dmg: a.dmg, posture: a.posture, isSpecial: false, finisher: a.finisher, cx: seg.x, cy: seg.y, heavy: a.kind === 'heavy', big: a.kind === 'heavy' || a.finisher });
  }

  // ——— boss AI ———
  private bossThink(dt: number) {
    const p = this.p, b = this.b;
    if (b.hp <= 0 || p.dead) return;
    b.phase = b.hp < b.maxHp * 0.38 ? 3 : b.hp < b.maxHp * 0.68 ? 2 : 1;
    if (b.broken > 0) { b.broken -= dt; if (b.broken <= 0) { b.state = 'idle'; b.timer = 520; this.log = `${b.name} recovers. Phase ${b.phase}.`; } return; }
    b.lastHit += dt;
    if ((b.state === 'idle' || b.state === 'recover') && b.lastHit > 700) b.posture = Math.max(0, b.posture - dt * 0.045);
    b.timer -= dt;
    if (b.state === 'idle' && b.timer <= 0) {
      const close = hyp(p.x - b.x, p.y - b.y) < 175;
      const pool = close ? ['sweep', 'combo', 'slam'] : ['spear', 'slam', 'sweep'];
      if (b.phase >= 2) pool.push('ring');
      if (b.phase >= 3) pool.push('combo', 'spear');
      b.move = BOSS_MOVES[pool[Math.floor(Math.random() * pool.length)]];
      b.target = { x: p.x, y: p.y }; b.state = 'tell';
      b.timer = b.move.tell * (b.phase === 3 ? 0.78 : b.phase === 2 ? 0.88 : 1); b.tellTotal = b.timer; b.hit = false;
      this.log = 'Tell: ' + b.move.name + '.';
    } else if (b.state === 'tell' && b.timer <= 0) {
      b.state = 'active'; b.timer = b.move!.active; this.shake = 8;
      if (b.move!.kind === 'slam') this.slamImpact(b.target.x, b.target.y);
    } else if (b.state === 'active') {
      if (!b.hit && this.bossMoveHits()) {
        if (p.inv > 0) {
          b.hit = true; p.just = 700; this.slow = 0.45; this.hitstop = 80; this.flash = 80;
          this.ring(p.x, p.y, '150,220,255', 70); this.ring(p.x, p.y, '255,255,255', 120); this.spark(p.x, p.y, '150,225,255', 18); this.spark(b.x, b.y, '120,230,255', 10);
          this.pulseText(p.x, p.y - 46, 'PERFECT', '120,210,255', 26); this.log = 'Perfect dodge. Punish now.';
        } else { this.hurt(Math.max(4, Math.round(b.atkBase * b.move!.mult))); b.hit = true; }
      }
      if (b.timer <= 0) { b.state = 'recover'; b.timer = b.move!.recover; }
    } else if (b.state === 'recover' && b.timer <= 0) {
      b.state = 'idle'; b.timer = b.phase === 3 ? 340 : b.phase === 2 ? 470 : 650;
    }
  }

  private bossMoveHits(): boolean {
    const p = this.p, b = this.b, mv = b.move!, t = b.target;
    switch (mv.kind) {
      case 'sweep': { if (hyp(p.x - b.x, p.y - b.y) > (mv.reach ?? 150)) return false; const v = norm(t.x - b.x, t.y - b.y); const pv = norm(p.x - b.x, p.y - b.y); return (v.x * pv.x + v.y * pv.y) > Math.cos(1.5); }
      case 'spear': { const v = norm(t.x - b.x, t.y - b.y); const px = p.x - b.x, py = p.y - b.y; const along = px * v.x + py * v.y; const side = Math.abs(px * -v.y + py * v.x); return along > -20 && along < (mv.len ?? 760) && side < (mv.hw ?? 46); }
      case 'slam': return hyp(p.x - t.x, p.y - t.y) < (mv.radius ?? 100);
      case 'ring': { const d = hyp(p.x - b.x, p.y - b.y); return d > (mv.inner ?? 76) && d < (mv.outer ?? 196); }
      case 'combo': return Math.abs(p.x - b.x) < (mv.hw ?? 130) && Math.abs(p.y - b.y) < (mv.hh ?? 74);
    }
    return false;
  }

  private slamImpact(x: number, y: number) {
    this.groundFlash = 1; this.groundFlashX = x; this.groundFlashY = y;
    this.decals.push({ type: 'decal', x, y, life: 2600, max: 2600, r1: 64 });
    this.ring(x, y, '255,150,60', 110); this.debris(x, y, 12);
    for (let i = 0; i < 10; i++) { const a = rnd(0, TAU); this.fx.push({ type: 'ember', x, y, vx: Math.cos(a) * rnd(60, 160), vy: Math.sin(a) * rnd(-120, -40), life: rnd(300, 600), max: 600, col: '255,120,40', w: 2 }); }
    this.shake = Math.max(this.shake, 15);
  }

  private hurt(n: number) {
    const p = this.p, b = this.b;
    if (p.heal) { p.heal = null; this.pulseText(p.x, p.y - 40, 'interrupted!', '220,180,120', 13); }  // a hit cancels the channel
    // single-hit cap so an over-leveled boss can't one-shot a frail mon, plus a
    // last-stand: a clean burst from healthy leaves you at 1 instead of dead.
    n = Math.min(n, Math.ceil(p.maxHp * 0.55));
    if (p.hp - n <= 0 && p.hp > p.maxHp * 0.35) n = p.hp - 1;
    p.hp = clamp(p.hp - n, 0, p.maxHp); p.combo = 0; p.comboT = 0; p.chain = 0;
    this.shake = 13; this.hitstop = 95; this.flash = 110; this.zoom = 1.06;
    const k = norm(p.x - b.x, p.y - b.y); this.kickX = k.x * 11; this.kickY = k.y * 11;
    this.spark(p.x, p.y, '255,90,80', 16); this.ring(p.x, p.y, '255,90,80', 56); this.pulseText(p.x, p.y - 34, '-' + n, '255,90,80', 20);
    this.log = 'Hit. Read the next tell.';
    if (p.hp <= 0) { p.dead = 1600; this.log = `${p.kit.name} fainted.`; }
  }

  // ——— player update ———
  private playerUpdate(dt: number) {
    const p = this.p;
    if (this.winT > 0) { this.winT -= dt; if (this.winT <= 0) this.phase = 'boss_ko'; return; }
    if (p.dead) { p.dead -= dt; if (p.dead <= 0) this.phase = 'player_ko'; return; }
    p.inv = Math.max(0, p.inv - dt); p.just = Math.max(0, p.just - dt); p.moving = false;
    for (const k of ['U', 'I', 'O']) p.cd[k] = Math.max(0, p.cd[k] - dt);
    if (p.regenLock > 0) p.regenLock -= dt;
    this.dodgeBuf = Math.max(0, this.dodgeBuf - dt); this.atkBuf = Math.max(0, this.atkBuf - dt);

    // Potion channel: locked + vulnerable while drinking (a hit cancels it in hurt())
    if (p.heal) {
      p.heal.t -= dt;
      p.hp = clamp(p.hp + p.heal.amount * dt / p.heal.dur, 0, p.maxHp);
      if (Math.random() < 0.4 && this.fx.length < 260) this.fx.push({ type: 'ember', x: p.x + rnd(-12, 12), y: p.y + rnd(-4, 10), vx: rnd(-8, 8), vy: rnd(-50, -20), life: rnd(400, 800), max: 800, col: '160,230,150', w: 2 });
      if (p.heal.t <= 0) { this.pulseText(p.x, p.y - 40, '+' + Math.round(p.heal.amount), '120,230,150', 18); p.heal = null; }
      this.clampPos();
      return;
    }

    if (!p.atk && p.dodge <= 0 && p.regenLock <= 0) p.stamina = clamp(p.stamina + dt * p.kit.regen, 0, p.maxStamina);
    if (this.dodgeBuf > 0 && this.tryDodge()) this.dodgeBuf = 0;
    if (this.atkBuf > 0 && this.tryAttack()) this.atkBuf = 0;

    if (p.dodge > 0) {
      p.dodge = Math.max(0, p.dodge - dt); p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; p.vx *= 0.89; p.vy *= 0.89;
      if (this.ghosts.length < 64 && Math.random() < 0.4) this.ghosts.push({ x: p.x, y: p.y, life: 220, max: 220, color: p.inv > 0 ? '#67c9ff' : '#8a99a6' });
    } else if (!p.atk) {
      const v = this.input();
      if (v.x || v.y) { p.faceX = v.x; p.faceY = v.y; p.moving = true; if (v.x) p.dir = Math.sign(v.x); const sp = p.just ? p.kit.speed * 1.33 : p.kit.speed; p.x += v.x * sp * dt / 1000; p.y += v.y * sp * dt / 1000; }
    }
    if (p.atk) {
      p.atk.t -= dt; const elapsed = p.atk.total - p.atk.t;
      if (p.atk.kind === 'cone') { p.atk.tickT! -= dt; if (p.atk.tickT! <= 0) { p.atk.tickT = p.atk.total / (p.atk.ticks || 1); this.checkPlayerHit(); } }
      else if (p.atk.kind !== 'castpose') { const lo = p.atk.kind === 'heavy' ? 0.24 : 0.34, hi = p.atk.kind === 'heavy' ? 0.46 : 0.6; const act = elapsed > p.atk.total * lo && elapsed < p.atk.total * hi; if (act && !p.atk.hit) this.checkPlayerHit(); }
      if (p.atk.t <= 0) p.atk = null;
    }
    this.clampPos();
  }
  private clampPos() { const p = this.p; p.x = clamp(p.x, 74, this.W - 74); p.y = clamp(p.y, this.H * 0.42, this.H - 60); }

  private updateShots(dt: number) {
    const b = this.b;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]; s.life -= dt; s.x += s.vx * dt / 1000; s.y += s.vy * dt / 1000; s.rot += s.vr * dt / 1000;
      if (s.kind === 'blast' && Math.random() < 0.6) this.fx.push({ type: 'ember', x: s.x, y: s.y, vx: rnd(-30, 30), vy: rnd(-30, 30), life: rnd(200, 400), max: 400, col: '255,150,50', w: 2 });
      else if (s.kind === 'lance' && Math.random() < 0.7) this.fx.push({ type: 'debris', x: s.x, y: s.y, vx: rnd(-20, 20), vy: rnd(10, 70), life: rnd(150, 300), max: 300, col: '150,210,255', w: rnd(1.5, 3), rot: 0, vr: 0, grav: 0.6 });
      else if (s.kind === 'leaf' && Math.random() < 0.45) this.fx.push({ type: 'ember', x: s.x, y: s.y, vx: rnd(-15, 15), vy: rnd(-15, 15), life: rnd(160, 320), max: 320, col: '120,230,150', w: 2 });
      const bi = b.hp > 0 ? this.bodyDist(s.x, s.y) : null;
      if (bi && bi.d < s.r + 4) {
        const big = s.kind === 'blast';
        this.resolveHit({ el: s.el, tEl: s.el, dmg: s.dmg, posture: s.posture, isSpecial: true, slot: s.slot, cx: s.x, cy: s.y, big, heavy: big });
        if (big) { this.ring(s.x, s.y, '255,150,60', 140); this.groundFlash = 1; this.groundFlashX = s.x; this.groundFlashY = s.y; this.shake = Math.max(this.shake, 12); }
        this.shots.splice(i, 1); continue;
      }
      if (s.life <= 0) this.shots.splice(i, 1);
    }
  }

  // ——— particles ———
  private spark(x: number, y: number, rgb: string, n: number) { for (let i = 0; i < n && this.fx.length < 340; i++) { const a = rnd(0, TAU), s = rnd(120, 380); this.fx.push({ type: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(220, 460), max: 460, col: rgb, w: rnd(1.4, 3) }); } }
  private debris(x: number, y: number, n: number) { for (let i = 0; i < n && this.fx.length < 340; i++) this.fx.push({ type: 'debris', x, y, vx: rnd(-180, 180), vy: rnd(-300, -80), life: rnd(500, 900), max: 900, col: '120,110,98', w: rnd(3, 7), rot: rnd(0, TAU), vr: rnd(-9, 9), grav: 1 }); }
  private droplets(x: number, y: number, n: number, rgb: string) { for (let i = 0; i < n && this.fx.length < 340; i++) { const a = rnd(-Math.PI, 0), s = rnd(80, 240); this.fx.push({ type: 'debris', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: rnd(300, 560), max: 560, col: rgb, w: rnd(2, 4), rot: 0, vr: 0, grav: 1 }); } }
  private leaves(x: number, y: number, n: number) { for (let i = 0; i < n && this.fx.length < 340; i++) { const a = rnd(0, TAU), s = rnd(60, 200); this.fx.push({ type: 'leaf', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life: rnd(360, 640), max: 640, col: '127,216,154', w: rnd(3, 5), rot: rnd(0, TAU), vr: rnd(-12, 12), grav: 0.4 }); } }
  private splashRing(x: number, y: number) { this.fx.push({ type: 'splash', x, y, r0: 6, r1: 60, life: 380, max: 380, col: '150,210,255' }); }
  ring(x: number, y: number, rgb: string, r1: number) { this.fx.push({ type: 'ring', x, y, r0: 6, r1, life: 380, max: 380, col: rgb }); }
  pulseText(x: number, y: number, txt: string | number, rgb: string, size: number) { if (this.texts.length < 80) this.texts.push({ x, y, txt: String(txt), rgb, size: size || 18, life: 760, max: 760 }); }
  private hitVfx(el: ActionEl, x: number, y: number, big?: boolean) {
    const v = vfxEl(el);
    if (v === 'water') { this.splashRing(x, y); this.droplets(x, y, big ? 12 : 8, '150,210,255'); this.spark(x, y, '200,235,255', big ? 8 : 5); }
    else if (v === 'grass') { this.leaves(x, y, big ? 8 : 5); this.ring(x, y, '150,230,160', big ? 54 : 40); }
    else if (v === 'fire') { this.spark(x, y, '255,170,60', big ? 22 : 14); this.ring(x, y, '255,160,60', big ? 60 : 42); }
    else if (v === 'electric') { this.spark(x, y, '255,238,120', big ? 18 : 12); this.ring(x, y, '255,240,150', big ? 54 : 40); }
    else { this.spark(x, y, '240,248,255', big ? 14 : 10); this.debris(x, y, big ? 7 : 4); this.ring(x, y, '230,240,255', big ? 56 : 40); }
  }

  private updateFx(dt: number) {
    const p = this.p, b = this.b;
    for (let i = this.fx.length - 1; i >= 0; i--) { const o = this.fx[i]; o.life -= dt; if (o.type !== 'ring' && o.type !== 'splash') { o.x += (o.vx || 0) * dt / 1000; o.y += (o.vy || 0) * dt / 1000; if (o.grav) { o.vy = (o.vy || 0) + 900 * o.grav * dt / 1000; o.rot = (o.rot || 0) + (o.vr || 0) * dt / 1000; o.vx = (o.vx || 0) * 0.99; } else { o.vx = (o.vx || 0) * 0.92; o.vy = (o.vy || 0) * 0.92; } if (o.type === 'ember') o.vy = (o.vy || 0) - 40 * dt / 1000; if (o.type === 'leaf') o.rot = (o.rot || 0) + (o.vr || 0) * dt / 1000; } if (o.life <= 0) this.fx.splice(i, 1); }
    for (let i = this.texts.length - 1; i >= 0; i--) { const o = this.texts[i]; o.life -= dt; o.y -= dt * 0.028; if (o.life <= 0) this.texts.splice(i, 1); }
    for (let i = this.ghosts.length - 1; i >= 0; i--) { const o = this.ghosts[i]; o.life -= dt; if (o.life <= 0) this.ghosts.splice(i, 1); }
    for (let i = this.decals.length - 1; i >= 0; i--) { const o = this.decals[i]; o.life -= dt; if (o.life <= 0) this.decals.splice(i, 1); }
    for (const d of this.dust) { d.x += (d.vx || 0) * dt / 1000; d.y += (d.vy || 0) * dt / 1000; if (d.y < this.H * 0.4) { d.y = this.H + 4; d.x = rnd(0, this.W); } if (d.x < -4) d.x = this.W; if (d.x > this.W + 4) d.x = 0; }
    if (!p.dead && this.fx.length < 260 && p.kit.element === 'fire' && Math.random() < 0.35) this.fx.push({ type: 'ember', x: p.x - (p.dir || 1) * 14, y: p.y - 16, vx: rnd(-15, 15), vy: rnd(-55, -22), life: rnd(300, 620), max: 620, col: '255,140,40', w: 2 });
    if (p.moving && this.fx.length < 260 && Math.random() < 0.16) this.fx.push({ type: 'debris', x: p.x - (p.dir || 1) * 8, y: p.y + 17, vx: rnd(-18, 18), vy: rnd(-28, -6), life: rnd(170, 320), max: 320, col: '110,120,120', w: rnd(2, 3.5), rot: 0, vr: 0, grav: 0.5 });
    if (b.hp > 0 && b.phase >= 2 && this.fx.length < 260 && Math.random() < 0.05 * b.phase) this.fx.push({ type: 'ember', x: b.x + rnd(-40, 40), y: b.y + rnd(-60, 20), vx: rnd(-10, 10), vy: rnd(-45, -12), life: rnd(400, 820), max: 820, col: b.phase >= 3 ? '255,90,40' : '255,150,50', w: 2 });
    const tf = p.x < b.x ? -1 : 1; b.face += (tf - b.face) * 0.05;
    const fxp = (p.x + b.x) / 2, fyp = (p.y + b.y) / 2;
    this.camX += (clamp(this.lerp(this.W / 2, fxp, 0.32), this.W / 2 - 42, this.W / 2 + 42) - this.camX) * 0.06;
    this.camY += (clamp(this.lerp(this.H / 2, fyp, 0.26), this.H / 2 - 30, this.H / 2 + 30) - this.camY) * 0.06;
    this.kickX *= 0.82; this.kickY *= 0.82;
    const zoomBase = 1 + (b.state === 'tell' ? 0.03 : 0); this.zoom += (zoomBase - this.zoom) * 0.06;
    this.shake = Math.max(0, this.shake - dt * 0.05); this.flash = Math.max(0, this.flash - dt); b.flash = Math.max(0, b.flash - dt); this.introT = Math.max(0, this.introT - dt); this.impact = Math.max(0, this.impact - dt * 0.012); this.groundFlash = Math.max(0, this.groundFlash - dt * 0.004); this.slow += (1 - this.slow) * 0.08;
    if (p.comboT > 0) { p.comboT -= dt; if (p.comboT <= 0) { p.combo = 0; p.chain = 0; } } this.comboPop = Math.max(0, this.comboPop - dt * 0.006);
    b.hpShown += (b.hp - b.hpShown) * Math.min(1, dt * 0.005); p.hpShown += (p.hp - p.hpShown) * Math.min(1, dt * 0.01);
  }
  private lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
}
