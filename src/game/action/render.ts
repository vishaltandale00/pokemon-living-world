// Canvas2D renderer for the action battle, ported from the prototype.
// Draws the arena, boss telegraphs, particles, bloom/vignette post, and HUD at a
// native 960x540 logical resolution. The two fighters are the game's real sprites
// (hybrid look) instead of the prototype's procedural creature art.
import { type ActionEngine } from './engine';
import { vfxEl } from './kit';

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const hash = (n: number) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
const norm = (x: number, y: number) => { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };
const LIGHT = norm(-0.45, -0.9);

export interface BattleAssets { playerImg: HTMLImageElement | null; bossImg: HTMLImageElement | null; }

const TYPECOL: Record<string, string> = {
  fire: '#ef7a3a', water: '#4aa8e0', grass: '#5fc07a', electric: '#e8c84a', rock: '#b8a878',
  ground: '#c8a85a', ghost: '#8a6fc8', dark: '#6b6478', ice: '#7fd0e0', dragon: '#6878c8',
  psychic: '#e87aa8', normal: '#a8a090', poison: '#a868a8', flying: '#9fb8e8',
};

function makeGlow(rad: number, r: number, gc: number, bc: number) {
  const o = document.createElement('canvas'); o.width = o.height = rad * 2; const og = o.getContext('2d')!;
  const grd = og.createRadialGradient(rad, rad, 0, rad, rad, rad);
  grd.addColorStop(0, `rgba(${r},${gc},${bc},1)`); grd.addColorStop(0.4, `rgba(${r},${gc},${bc},0.5)`); grd.addColorStop(1, `rgba(${r},${gc},${bc},0)`);
  og.fillStyle = grd; og.fillRect(0, 0, rad * 2, rad * 2); return o;
}

export class BattleRenderer {
  private W = 960; private H = 540; private dpr: number;
  private arenaBg: HTMLCanvasElement;
  private bloomC: HTMLCanvasElement; private bgx: CanvasRenderingContext2D;
  private GLOW = makeGlow(32, 255, 255, 255);
  private GLOW_WARM = makeGlow(32, 255, 160, 70);
  private GLOW_COOL = makeGlow(32, 150, 210, 255);
  private GLOW_GRASS = makeGlow(32, 150, 225, 150);
  private vignette!: CanvasGradient; private bossVignette!: CanvasGradient; private lowVignette!: CanvasGradient;

  constructor(dpr: number) {
    this.dpr = dpr;
    this.arenaBg = document.createElement('canvas'); this.arenaBg.width = this.W * dpr; this.arenaBg.height = this.H * dpr;
    const gb = this.arenaBg.getContext('2d')!; gb.scale(dpr, dpr); gb.lineJoin = 'round'; gb.lineCap = 'round';
    this.bakeArena(gb);
    this.bloomC = document.createElement('canvas'); this.bloomC.width = Math.floor(this.W / 2); this.bloomC.height = Math.floor(this.H / 2);
    this.bgx = this.bloomC.getContext('2d')!;
  }

  private bakeArena(gb: CanvasRenderingContext2D) {
    const W = this.W, H = this.H, hor = H * 0.40;
    const sky = gb.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#0a1016'); sky.addColorStop(0.42, '#0c151b'); sky.addColorStop(1, '#070b0f');
    gb.fillStyle = sky; gb.fillRect(-60, -60, W + 120, H + 120);
    for (let i = 0; i < 6; i++) { const px = 60 + i * (W - 120) / 5, pw = 26; const pg = gb.createLinearGradient(px, 0, px + pw, 0); pg.addColorStop(0, '#0d161c'); pg.addColorStop(0.5, '#16242c'); pg.addColorStop(1, '#0a1217'); gb.fillStyle = pg; gb.fillRect(px - pw / 2, 0, pw, hor); gb.fillStyle = 'rgba(140,180,170,.05)'; gb.fillRect(px - pw / 2, 0, 3, hor); }
    const sp = gb.createRadialGradient(W / 2, H * 0.52, 40, W / 2, H * 0.5, W * 0.62); sp.addColorStop(0, 'rgba(130,160,150,.18)'); sp.addColorStop(1, 'rgba(0,0,0,0)'); gb.fillStyle = sp; gb.fillRect(0, 0, W, H);
    const fl = gb.createLinearGradient(0, hor, 0, H); fl.addColorStop(0, '#17232a'); fl.addColorStop(1, '#0a1216'); gb.fillStyle = fl; gb.fillRect(-60, hor, W + 120, H - hor + 60);
    const vpx = W / 2; gb.strokeStyle = 'rgba(120,160,170,.08)'; gb.lineWidth = 1;
    for (let i = -7; i <= 7; i++) { const bx = W / 2 + i * 150; gb.beginPath(); gb.moveTo(bx, H); gb.lineTo(vpx, hor); gb.stroke(); }
    for (let i = 1; i <= 6; i++) { const t = i / 6, yy = hor + (H - hor) * (t * t); gb.beginPath(); gb.moveTo(0, yy); gb.lineTo(W, yy); gb.stroke(); }
    for (let k = 0; k < 22; k++) { const x = rnd(80, W - 80), y = rnd(H * 0.50, H - 30), r = rnd(2, 6), s = rnd(0.4, 0.9); gb.fillStyle = `rgba(40,48,52,${s})`; gb.beginPath(); gb.ellipse(x, y, r, r * 0.6, 0, 0, TAU); gb.fill(); gb.fillStyle = 'rgba(150,170,170,.12)'; gb.beginPath(); gb.ellipse(x - r * 0.3, y - r * 0.3, r * 0.4, r * 0.26, 0, 0, TAU); gb.fill(); }
    gb.save(); gb.translate(W / 2, H * 0.66); gb.scale(1, 0.4); gb.strokeStyle = 'rgba(120,200,180,.16)'; gb.lineWidth = 6; gb.beginPath(); gb.arc(0, 0, 320, 0, TAU); gb.stroke(); gb.strokeStyle = 'rgba(236,203,115,.08)'; gb.lineWidth = 2; gb.beginPath(); gb.arc(0, 0, 268, 0, TAU); gb.stroke(); gb.restore();
  }

  private ensureGradients(g: CanvasRenderingContext2D) {
    if (this.vignette) return;
    const W = this.W, H = this.H;
    this.vignette = g.createRadialGradient(W / 2, H * 0.52, H * 0.3, W / 2, H * 0.52, H * 0.9); this.vignette.addColorStop(0, 'rgba(0,0,0,0)'); this.vignette.addColorStop(1, 'rgba(0,0,0,.62)');
    this.bossVignette = g.createRadialGradient(W / 2, H * 0.52, H * 0.25, W / 2, H * 0.52, H * 0.85); this.bossVignette.addColorStop(0, 'rgba(255,40,30,0)'); this.bossVignette.addColorStop(1, 'rgba(255,40,30,1)');
    this.lowVignette = g.createRadialGradient(W / 2, H * 0.52, H * 0.2, W / 2, H * 0.52, H * 0.85); this.lowVignette.addColorStop(0, 'rgba(200,20,20,0)'); this.lowVignette.addColorStop(1, 'rgba(200,20,20,1)');
  }

  // ——— top-level frame ———
  render(g: CanvasRenderingContext2D, eng: ActionEngine, assets: BattleAssets) {
    this.ensureGradients(g);
    const W = this.W, H = this.H;
    g.clearRect(0, 0, W, H);
    g.save();
    g.translate(eng.camX + eng.kickX, eng.camY + eng.kickY); g.scale(eng.zoom, eng.zoom); g.translate(-(eng.camX + eng.kickX), -(eng.camY + eng.kickY));
    if (eng.shake) g.translate(rnd(-eng.shake, eng.shake), rnd(-eng.shake, eng.shake));
    this.drawArena(g, eng);
    const b = eng.b;
    if (b.move && (b.state === 'tell' || b.state === 'active')) {
      const prog = b.state === 'tell' ? clamp(1 - b.timer / (b.tellTotal || b.move.tell), 0, 1) : clamp(1 - b.timer / b.move.active, 0, 1);
      this.drawTelegraph(g, eng, b.state, prog);
    }
    this.drawBoss(g, eng, assets.bossImg);
    this.drawPlayer(g, eng, assets.playerImg);
    this.drawShots(g, eng);
    this.drawFx(g, eng);
    g.restore();
    this.drawPost(g, eng);
    this.drawHud(g, eng);
  }

  private drawArena(g: CanvasRenderingContext2D, eng: ActionEngine) {
    const W = this.W, H = this.H, time = eng.time;
    g.drawImage(this.arenaBg, 0, 0, W, H);
    g.save(); g.globalCompositeOperation = 'lighter'; const cglow = 0.14 + 0.08 * Math.sin(time * 0.003);
    for (const cr of eng.cracks) { g.beginPath(); g.moveTo(cr[0].x, cr[0].y); for (let i = 1; i < cr.length; i++) g.lineTo(cr[i].x, cr[i].y); g.strokeStyle = `rgba(150,55,25,${cglow * 0.7})`; g.lineWidth = 7; g.stroke(); g.strokeStyle = `rgba(210,90,40,${cglow})`; g.lineWidth = 2.2; g.stroke(); }
    if (eng.groundFlash > 0) for (const cr of eng.cracks) { const near = clamp(1 - Math.hypot(cr[0].x - eng.groundFlashX, cr[0].y - eng.groundFlashY) / 240, 0, 1); if (near <= 0) continue; g.beginPath(); g.moveTo(cr[0].x, cr[0].y); for (let i = 1; i < cr.length; i++) g.lineTo(cr[i].x, cr[i].y); g.strokeStyle = `rgba(255,180,90,${eng.groundFlash * near * 0.85})`; g.lineWidth = 4; g.stroke(); }
    g.restore();
    for (const d of eng.decals) { const a = clamp(d.life / d.max, 0, 1); g.strokeStyle = `rgba(28,20,16,${0.5 * a})`; g.lineWidth = 3; g.beginPath(); g.ellipse(d.x, d.y, d.r1 || 60, (d.r1 || 60) * 0.42, 0, 0, TAU); g.stroke(); }
    for (const d of eng.dust) { g.fillStyle = `rgba(190,210,210,${d.col})`; g.beginPath(); g.ellipse(d.x, d.y, d.r || 1, d.r || 1, 0, 0, TAU); g.fill(); }
  }

  // ——— boss danger zones (kind-driven, generic to any sprite boss) ———
  private zone(g: CanvasRenderingContext2D, kind: string, prog: number, time: number, path: () => void) {
    path();
    if (kind === 'active') {
      g.fillStyle = 'rgba(239,72,64,.42)'; g.fill();
      g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = 'rgba(255,120,90,.40)'; g.lineWidth = 12; g.stroke(); g.restore();
      g.strokeStyle = 'rgba(255,205,185,.95)'; g.lineWidth = 5; g.setLineDash([7, 7]); g.lineDashOffset = -time * 0.2; g.stroke(); g.setLineDash([]);
    } else {
      const a = 0.07 + prog * 0.28; g.fillStyle = `rgba(236,150,80,${a})`; g.fill();
      g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = `rgba(255,180,90,${0.18 + prog * 0.22})`; g.lineWidth = (2 + prog * 2.5) + 8; g.stroke(); g.restore();
      g.strokeStyle = `rgba(255,205,130,${0.45 + prog * 0.5})`; g.lineWidth = 2 + prog * 2.5; g.setLineDash([10, 8]); g.lineDashOffset = -time * 0.05; g.stroke(); g.setLineDash([]);
    }
  }
  private drawTelegraph(g: CanvasRenderingContext2D, eng: ActionEngine, state: string, prog: number) {
    const b = eng.b, mv = b.move!, t = b.target, time = eng.time;
    const z = (path: () => void) => this.zone(g, state, prog, time, path);
    switch (mv.kind) {
      case 'sweep': { const v = norm(t.x - b.x, t.y - b.y); const base = Math.atan2(v.y, v.x); z(() => { g.beginPath(); g.moveTo(b.x, b.y); g.arc(b.x, b.y, mv.reach ?? 150, base - 1.5, base + 1.5); g.closePath(); }); break; }
      case 'spear': { const v = norm(t.x - b.x, t.y - b.y); const n = { x: -v.y, y: v.x }, len = mv.len ?? 760, hw = mv.hw ?? 46; z(() => { g.beginPath(); g.moveTo(b.x + n.x * hw, b.y + n.y * hw); g.lineTo(b.x + v.x * len + n.x * hw, b.y + v.y * len + n.y * hw); g.lineTo(b.x + v.x * len - n.x * hw, b.y + v.y * len - n.y * hw); g.lineTo(b.x - n.x * hw, b.y - n.y * hw); g.closePath(); }); if (state === 'tell') { g.save(); g.globalCompositeOperation = 'lighter'; for (let i = 1; i <= 5; i++) { const tt = ((time * 0.0006 + i / 5) % 1); const px = b.x + v.x * len * tt, py = b.y + v.y * len * tt; g.strokeStyle = `rgba(255,210,140,${(1 - tt) * 0.5})`; g.lineWidth = 2; g.beginPath(); g.moveTo(px - v.x * 14 + n.x * 12, py - v.y * 14 + n.y * 12); g.lineTo(px, py); g.lineTo(px - v.x * 14 - n.x * 12, py - v.y * 14 - n.y * 12); g.stroke(); } g.restore(); } break; }
      case 'slam': { const rr = mv.radius ?? 100; z(() => { g.beginPath(); g.arc(t.x, t.y, rr, 0, TAU); }); const ringR = Math.max(rr, rr * 1.9 - prog * rr * 0.85); g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = `rgba(255,210,140,${0.35 + prog * 0.5})`; g.lineWidth = 2; g.beginPath(); g.arc(t.x, t.y, ringR, 0, TAU); g.stroke(); g.beginPath(); g.moveTo(t.x - rr, t.y); g.lineTo(t.x + rr, t.y); g.moveTo(t.x, t.y - rr); g.lineTo(t.x, t.y + rr); g.stroke(); g.restore(); break; }
      case 'ring': { z(() => { g.beginPath(); g.arc(b.x, b.y, mv.outer ?? 196, 0, TAU); g.arc(b.x, b.y, mv.inner ?? 76, 0, TAU, true); }); break; }
      case 'combo': { z(() => { g.beginPath(); g.rect(b.x - (mv.hw ?? 130), b.y - (mv.hh ?? 74), (mv.hw ?? 130) * 2, (mv.hh ?? 74) * 2); }); break; }
    }
  }

  // ——— sprite fighters ———
  private drawBoss(g: CanvasRenderingContext2D, eng: ActionEngine, img: HTMLImageElement | null) {
    const b = eng.b, time = eng.time; const broken = b.broken > 0;
    const groundY = b.y + 40;
    g.save(); g.filter = 'blur(6px)'; g.fillStyle = 'rgba(0,0,0,0.32)'; g.beginPath(); g.ellipse(b.x, groundY, 58, 16, 0, 0, TAU); g.fill(); g.filter = 'none'; g.restore();
    let lunge = { x: 0, y: 0 };
    if (b.state === 'active' && b.move) { const k = clamp(b.timer / b.move.active, 0, 1); const hd = norm(b.target.x - b.x, b.target.y - b.y); const d = (1 - Math.pow(1 - k, 3)) * 18; lunge = { x: hd.x * d, y: hd.y * d }; }
    else if (b.state === 'tell') { const k = clamp(1 - b.timer / (b.tellTotal || 1), 0, 1); const hd = norm(b.target.x - b.x, b.target.y - b.y); const d = Math.pow(k, 2) * -12; lunge = { x: hd.x * d, y: hd.y * d }; }
    const scale = 2.3 * (broken ? 0.94 : 1);
    g.save(); g.translate(b.x + lunge.x, b.y + lunge.y);
    const bob = Math.sin(time * 0.0024) * 2.5;
    g.translate(0, bob);
    const fdir = b.face < 0 ? -1 : 1;
    const sq = b.state === 'active' ? 1.08 : 1;
    g.scale(fdir * scale * sq, scale / sq);
    if (img && img.complete && img.width) {
      const w = img.width, h = img.height;
      g.drawImage(img, -w / 2, -h + 8); // feet near origin
      if (b.flash > 0 || b.state === 'active') { g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = b.flash > 0 ? b.flash / 360 : 0.12 + 0.06 * Math.sin(time * 0.04); g.drawImage(img, -w / 2, -h + 8); g.restore(); }
    } else {
      g.fillStyle = '#7c736a'; g.beginPath(); g.ellipse(0, -20, 26, 30, 0, 0, TAU); g.fill();
    }
    g.restore();
    // phase aura
    if (b.phase >= 2 && !broken) { g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.18 + 0.08 * Math.sin(time * 0.02); g.drawImage(b.phase >= 3 ? this.GLOW_WARM : this.GLOW, b.x - 60, b.y - 70, 120, 120); g.restore(); }
  }

  private drawPlayer(g: CanvasRenderingContext2D, eng: ActionEngine, img: HTMLImageElement | null) {
    const p = eng.p, time = eng.time; const t = time * 0.001; const sc = 1.8;
    for (const o of eng.ghosts) { g.save(); g.globalAlpha = clamp(o.life / o.max, 0, 1) * 0.32; g.fillStyle = o.color; g.beginPath(); g.ellipse(o.x, o.y, 11 * sc * 0.6, 13 * sc * 0.6, 0, 0, TAU); g.fill(); g.restore(); }
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(0,0,0,0.4)'; g.beginPath(); g.ellipse(p.x, p.y + 22, 18, 5, 0, 0, TAU); g.fill();
    g.save(); g.translate(p.x, p.y);
    const bob = p.moving ? Math.abs(Math.sin(t * 11)) * -3 : Math.sin(t * 2.4) * 0.8;
    let lean = 0, sq = 1;
    if (p.dodge > 0 && p.inv > 0) sq = 1.2;
    if (p.atk && (p.atk.kind === 'light' || p.atk.kind === 'heavy')) { const e = clamp(1 - p.atk.t / p.atk.total, 0, 1); if (e < 0.32) { const k = e / 0.32; lean = -6 * k; sq = 1 - 0.1 * k; } else if (e < 0.5) { const k = (e - 0.32) / 0.18; lean = -6 + 22 * k; sq = 1 + 0.16 * k; } else { const k = (e - 0.5) / 0.5; lean = 16 * (1 - k); sq = 1 + 0.16 * (1 - k); } }
    if (p.moving && !p.atk) lean += 4;
    g.translate(lean * (p.dir || 1), bob);
    if (p.inv > 0) g.globalAlpha = 0.55 + 0.25 * Math.sin(time * 0.04);
    g.scale((p.dir || 1) * sq * sc, (1 / sq) * sc);
    if (img && img.complete && img.width) {
      g.drawImage(img, -img.width / 2, -img.height + 6);
    } else {
      g.fillStyle = '#d9701f'; g.beginPath(); g.ellipse(0, -14, 12, 15, 0, 0, TAU); g.fill();
    }
    g.restore(); g.globalAlpha = 1;
    if (p.inv > 0) { g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = `rgba(110,210,255,${0.4 + 0.3 * Math.sin(time * 0.03)})`; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, 26, 0, TAU); g.stroke(); g.restore(); }
    if (p.heal) { g.save(); g.globalCompositeOperation = 'lighter'; const k = 1 - p.heal.t / p.heal.dur; g.globalAlpha = 0.5; g.drawImage(this.GLOW_GRASS, p.x - 30, p.y - 44, 60, 60); g.globalAlpha = 1; g.strokeStyle = 'rgba(150,230,150,.55)'; g.lineWidth = 2.4; g.beginPath(); g.arc(p.x, p.y, 12 + k * 24, 0, TAU); g.stroke(); g.restore(); }
    if (p.just > 0) { g.save(); g.globalCompositeOperation = 'lighter'; const k = p.just / 700; g.strokeStyle = `rgba(120,210,255,${0.35 * k})`; g.lineWidth = 2; for (let i = 0; i < 4; i++) { const oy = -14 + i * 9; g.beginPath(); g.moveTo(p.x - (p.dir || 1) * 16, p.y + oy); g.lineTo(p.x - (p.dir || 1) * (34 + i * 4), p.y + oy); g.stroke(); } g.restore(); }
    this.drawSlash(g, eng);
    if (p.combo >= 2) {
      g.save(); g.translate(p.x + 30, p.y - 40); const cs2 = 1 + eng.comboPop * 0.55; g.scale(cs2, cs2);
      g.globalAlpha = clamp(0.45 + p.comboT / 820, 0, 1); g.textAlign = 'center';
      const col = p.combo >= 10 ? '255,110,80' : p.combo >= 6 ? '255,180,80' : '255,238,200';
      g.font = 'bold 22px ui-monospace, monospace'; g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.75)';
      g.strokeText(p.combo + '×', 0, 0); g.fillStyle = `rgba(${col},1)`; g.fillText(p.combo + '×', 0, 0);
      g.font = 'bold 8px ui-monospace, monospace'; g.fillStyle = `rgba(${col},.85)`; g.fillText('COMBO', 0, 11);
      g.restore(); g.textAlign = 'left'; g.globalAlpha = 1;
    }
  }

  private drawSlash(g: CanvasRenderingContext2D, eng: ActionEngine) {
    const p = eng.p; if (!p.atk || (p.atk.kind !== 'light' && p.atk.kind !== 'heavy' && p.atk.kind !== 'cone')) return;
    const frac = clamp(1 - p.atk.t / p.atk.total, 0, 1);
    const a = Math.atan2(p.faceY, p.faceX || p.dir || 1); const v = vfxEl(p.atk.el);
    const c1 = v === 'water' ? '150,210,255' : v === 'grass' ? '120,210,120' : v === 'fire' ? '255,150,40' : v === 'electric' ? '255,235,130' : '210,228,245';
    const c2 = v === 'water' ? '235,248,255' : v === 'grass' ? '225,250,210' : v === 'fire' ? '255,235,180' : v === 'electric' ? '255,250,200' : '235,244,255';
    if (p.atk.kind === 'cone') {
      if (frac < 0.1 || frac > 0.95) return; const env = Math.sin(frac * Math.PI);
      const R = p.atk.range || 200; const arc = p.atk.arc || 0.9; const mid = a;
      g.save(); g.globalCompositeOperation = 'lighter';
      const grad = g.createRadialGradient(p.x, p.y, R * 0.2, p.x, p.y, R); grad.addColorStop(0, `rgba(${c1},0)`); grad.addColorStop(0.55, `rgba(${c1},${0.4 * env})`); grad.addColorStop(1, `rgba(${c2},${0.55 * env})`);
      g.fillStyle = grad; g.beginPath(); g.moveTo(p.x, p.y); g.arc(p.x, p.y, R, mid - arc, mid + arc); g.closePath(); g.fill(); g.restore(); return;
    }
    const heavy = p.atk.kind === 'heavy'; const fin = p.atk.finisher; const cdir = (p.atk.chain === 1) ? -1 : 1;
    const strikeMid = heavy ? 0.35 : 0.47, half = 0.26;
    const s = (frac - (strikeMid - half)) / (half * 2); if (s < 0 || s > 1) return;
    const env = Math.sin(s * Math.PI); const sc = 1.7;
    let r1 = (heavy ? 42 : 28) * sc, r0 = (heavy ? 13 : 10) * sc, arc = heavy ? 0.82 : 0.62;
    if (fin) { r1 *= 1.3; arc *= 1.35; }
    const mid = a + (s - 0.5) * 1.9 * cdir;
    g.save(); g.globalCompositeOperation = 'lighter';
    g.beginPath(); g.arc(p.x, p.y, r1, mid - arc, mid + arc, false); g.arc(p.x, p.y, r0, mid + arc, mid - arc, true); g.closePath();
    const grad = g.createRadialGradient(p.x, p.y, r0, p.x, p.y, r1); grad.addColorStop(0, `rgba(${c1},0)`); grad.addColorStop(0.5, `rgba(${c1},${0.4 * env})`); grad.addColorStop(1, `rgba(${c2},${0.85 * env})`);
    g.fillStyle = grad; g.fill();
    g.strokeStyle = `rgba(${c2},${env})`; g.lineWidth = 2.4 * sc; g.beginPath(); g.arc(p.x, p.y, r1 * 0.96, mid - arc * 0.82, mid + arc * 0.82); g.stroke();
    g.strokeStyle = `rgba(255,255,255,${0.72 * env})`; g.lineWidth = 1.2 * sc; g.beginPath(); g.arc(p.x, p.y, r1 * 0.96, mid - arc * 0.42, mid + arc * 0.42); g.stroke();
    g.restore();
  }

  private drawShots(g: CanvasRenderingContext2D, eng: ActionEngine) {
    for (const s of eng.shots) {
      if (s.kind === 'lance') { g.save(); g.translate(s.x, s.y); g.globalCompositeOperation = 'lighter'; g.drawImage(this.GLOW_COOL, -s.r * 2.4, -s.r * 2.4, s.r * 4.8, s.r * 4.8); g.rotate(s.angle); g.fillStyle = 'rgba(120,180,235,.8)'; g.beginPath(); g.ellipse(0, 0, s.r * 2.3, s.r * 0.85, 0, 0, TAU); g.fill(); g.fillStyle = 'rgba(235,248,255,.98)'; g.beginPath(); g.ellipse(s.r * 0.5, 0, s.r * 1.4, s.r * 0.42, 0, 0, TAU); g.fill(); g.restore(); }
      else if (s.kind === 'leaf') { g.save(); g.translate(s.x, s.y); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.7; g.drawImage(this.GLOW_GRASS, -s.r * 2, -s.r * 2, s.r * 4, s.r * 4); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.rotate(s.rot); g.fillStyle = '#7fd89a'; g.beginPath(); g.moveTo(0, -s.r * 1.3); g.quadraticCurveTo(s.r, 0, 0, s.r * 1.3); g.quadraticCurveTo(-s.r, 0, 0, -s.r * 1.3); g.closePath(); g.fill(); g.restore(); }
      else if (s.kind === 'blast') { g.save(); g.translate(s.x, s.y); g.globalCompositeOperation = 'lighter'; g.drawImage(this.GLOW_WARM, -s.r * 1.6, -s.r * 1.6, s.r * 3.2, s.r * 3.2); g.fillStyle = 'rgba(255,140,30,.9)'; g.beginPath(); g.arc(0, 0, s.r, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,235,180,.95)'; g.beginPath(); g.arc(0, 0, s.r * 0.5, 0, TAU); g.fill(); g.restore(); }
      else { g.save(); g.translate(s.x, s.y); g.globalCompositeOperation = 'lighter'; g.drawImage(this.GLOW, -s.r * 1.8, -s.r * 1.8, s.r * 3.6, s.r * 3.6); g.fillStyle = 'rgba(235,244,255,.95)'; g.beginPath(); g.arc(0, 0, s.r, 0, TAU); g.fill(); g.restore(); }
    }
  }

  private drawFx(g: CanvasRenderingContext2D, eng: ActionEngine) {
    g.save(); g.globalCompositeOperation = 'lighter';
    for (const o of eng.fx) { if (o.type === 'ring') { const k = 1 - o.life / o.max; g.strokeStyle = `rgba(${o.col},${(1 - k) * 0.7})`; g.lineWidth = 3 * (1 - k) + 1; g.beginPath(); g.arc(o.x, o.y, (o.r0 || 6) + k * (o.r1 || 60), 0, TAU); g.stroke(); } else if (o.type === 'splash') { const k = 1 - o.life / o.max; g.strokeStyle = `rgba(${o.col},${(1 - k) * 0.7})`; g.lineWidth = 2.4 * (1 - k) + 1; g.beginPath(); g.ellipse(o.x, o.y, ((o.r0 || 6) + k * (o.r1 || 60)), ((o.r0 || 6) + k * (o.r1 || 60)) * 0.4, 0, 0, TAU); g.stroke(); } }
    for (const o of eng.fx) { if (o.type !== 'spark' && o.type !== 'ember') continue; const al = clamp(o.life / o.max, 0, 1); g.strokeStyle = `rgba(${o.col},${al})`; g.lineWidth = o.w || 2; g.beginPath(); g.moveTo(o.x, o.y); g.lineTo(o.x - (o.vx || 0) * 0.03, o.y - (o.vy || 0) * 0.03); g.stroke(); }
    g.restore();
    for (const o of eng.fx) { if (o.type === 'debris') { const al = clamp(o.life / o.max, 0, 1); g.save(); g.translate(o.x, o.y); g.rotate(o.rot || 0); g.fillStyle = `rgba(${o.col},${al})`; const w = o.w || 3; g.fillRect(-w / 2, -w / 2, w, w); g.restore(); } else if (o.type === 'leaf') { const al = clamp(o.life / o.max, 0, 1); g.save(); g.translate(o.x, o.y); g.rotate(o.rot || 0); g.fillStyle = `rgba(${o.col},${al})`; const w = o.w || 3; g.beginPath(); g.moveTo(0, -w); g.quadraticCurveTo(w, 0, 0, w); g.quadraticCurveTo(-w, 0, 0, -w); g.closePath(); g.fill(); g.restore(); } }
    g.textAlign = 'center';
    for (const o of eng.texts) { const al = clamp(o.life / o.max, 0, 1); const age = o.max - o.life; const pop = age < 120 ? 1.45 - (age / 120) * 0.45 : 1; g.save(); g.translate(o.x, o.y); g.scale(pop, pop); g.font = `bold ${o.size}px ui-monospace, monospace`; g.lineWidth = 4; g.strokeStyle = `rgba(0,0,0,${al * 0.7})`; g.strokeText(o.txt, 0, 0); g.fillStyle = `rgba(${o.rgb},${al})`; g.fillText(o.txt, 0, 0); g.restore(); }
    g.textAlign = 'left';
  }

  private drawPost(g: CanvasRenderingContext2D, eng: ActionEngine) {
    const W = this.W, H = this.H, time = eng.time, p = eng.p, b = eng.b;
    const c = g.canvas;
    this.bgx.clearRect(0, 0, this.bloomC.width, this.bloomC.height); this.bgx.filter = 'brightness(0.5) contrast(3.2) saturate(1.2)'; this.bgx.drawImage(c, 0, 0, this.bloomC.width, this.bloomC.height); this.bgx.filter = 'none';
    g.save(); g.globalCompositeOperation = 'lighter'; g.filter = 'blur(5px)'; g.globalAlpha = 0.32; g.drawImage(this.bloomC, 0, 0, W, H); g.filter = 'none'; g.globalAlpha = 1; g.restore();
    g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = 'rgba(150,180,205,0.10)'; g.fillRect(0, 0, W, H); g.restore();
    g.fillStyle = this.vignette; g.fillRect(0, 0, W, H);
    if (eng.flash > 0) { g.fillStyle = `rgba(255,255,255,${Math.min(0.55, eng.flash / 420)})`; g.fillRect(0, 0, W, H); }
    if (p.just > 0) { const a = (p.just / 700) * 0.25; const r = g.createRadialGradient(W / 2, H * 0.52, H * 0.25, W / 2, H * 0.52, H * 0.95); r.addColorStop(0, 'rgba(80,170,255,0)'); r.addColorStop(1, `rgba(80,170,255,${a})`); g.fillStyle = r; g.fillRect(0, 0, W, H); }
    if (b.state === 'active') { const dp = 0.1 + 0.06 * Math.sin(time * 0.04); g.save(); g.globalAlpha = dp; g.fillStyle = this.bossVignette; g.fillRect(0, 0, W, H); g.restore(); }
    if (p.hp < p.maxHp * 0.3 && !p.dead) { const lp = 0.1 + 0.1 * Math.sin(time * 0.012); g.save(); g.globalAlpha = lp; g.fillStyle = this.lowVignette; g.fillRect(0, 0, W, H); g.restore(); }
    if (p.dead) { g.fillStyle = `rgba(20,0,0,${0.55 * (1 - p.dead / 1600) + 0.2})`; g.fillRect(0, 0, W, H); g.textAlign = 'center'; g.fillStyle = '#ff6b5b'; g.font = 'bold 40px ui-monospace, monospace'; g.fillText(p.kit.name.toUpperCase() + ' FAINTED', W / 2, H / 2 - 6); g.textAlign = 'left'; }
    if (eng.winT > 0 && !p.dead) { const a = clamp(eng.winT / 1700, 0, 1); g.fillStyle = `rgba(8,12,8,${0.28 * a})`; g.fillRect(0, 0, W, H); g.textAlign = 'center'; g.fillStyle = '#eccb73'; g.font = 'bold 44px ui-monospace, monospace'; g.fillText('DOWN!', W / 2, H / 2 - 6); g.textAlign = 'left'; }
    if (eng.introT > 0) { const a = clamp(eng.introT / 600, 0, 1); g.save(); g.globalAlpha = Math.min(1, a); g.textAlign = 'center'; g.fillStyle = 'rgba(8,12,16,.62)'; g.fillRect(0, H * 0.28, W, 78); g.fillStyle = '#eccb73'; g.font = 'bold 26px ui-monospace, monospace'; g.fillText(p.kit.name.toUpperCase() + '   vs   ' + b.name.toUpperCase(), W / 2, H * 0.28 + 36); g.fillStyle = '#9fb6c2'; g.font = '13px ui-monospace, monospace'; g.fillText(`${b.roleLabel} · Lv${b.level} · ${b.type1}${b.type2 ? '/' + b.type2 : ''}`, W / 2, H * 0.28 + 60); g.restore(); g.textAlign = 'left'; }
  }

  private bar(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, val: number, max: number, col: string, opt: { trail?: number; tcol?: string } = {}) {
    this.rr(g, x, y, w, h, h / 2); g.fillStyle = 'rgba(6,10,14,.85)'; g.fill(); g.lineWidth = 1; g.strokeStyle = 'rgba(120,160,180,.30)'; g.stroke();
    const f = clamp(val / max, 0, 1);
    if (opt.trail != null) { const tf = clamp(opt.trail / max, 0, 1); if (tf > f + 0.001) { this.rr(g, x + 2, y + 2, (w - 4) * tf, h - 4, (h - 4) / 2); g.fillStyle = `rgba(${opt.tcol || '255,255,255'},.5)`; g.fill(); } }
    if (f > 0) { this.rr(g, x + 2, y + 2, (w - 4) * f, h - 4, (h - 4) / 2); g.fillStyle = col; g.fill(); this.rr(g, x + 2, y + 2, (w - 4) * f, (h - 4) * 0.5, (h - 4) / 4); g.fillStyle = 'rgba(255,255,255,.18)'; g.fill(); }
  }
  private rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { r = Math.min(r, h / 2, w / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  private drawHud(g: CanvasRenderingContext2D, eng: ActionEngine) {
    const W = this.W, H = this.H, time = eng.time, p = eng.p, b = eng.b;
    // player (top-left)
    g.textAlign = 'left'; g.font = 'bold 12px ui-monospace, monospace'; g.fillStyle = '#e7eef3'; g.fillText(p.kit.name.toUpperCase(), 26, 22);
    g.fillStyle = TYPECOL[p.kit.type1] || '#9fb6c2'; g.font = '10px ui-monospace, monospace'; g.fillText(p.kit.type1 + (p.kit.type2 ? '/' + p.kit.type2 : ''), 26, 35);
    g.fillStyle = '#9fb6c2'; g.font = '11px ui-monospace, monospace'; g.textAlign = 'right'; g.fillText(Math.max(0, Math.ceil(p.hp)) + '/' + p.maxHp, 256, 22); g.textAlign = 'left';
    this.bar(g, 24, 40, 232, 13, p.hp, p.maxHp, '#5fd36e', { trail: p.hpShown, tcol: '255,210,90' });
    this.bar(g, 24, 58, 176, 7, p.stamina, p.maxStamina, p.stamina < 24 ? '#ef5148' : '#e9c45f');
    let sx = 24; const sy = 72;
    for (const s of p.kit.specials) { this.drawSlot(g, sx, sy, eng, s.slot, s.name); sx += 92; }
    // potion / heal indicator
    g.font = '10px ui-monospace, monospace'; g.textAlign = 'left';
    g.fillStyle = eng.potions > 0 ? '#8fe0a0' : '#5d7180';
    g.fillText(`H  Potion ×${eng.potions}`, sx + 2, sy + 12);
    // boss (top-center)
    const bw = 420, bx = W / 2 - bw / 2, by = 30; g.textAlign = 'center'; g.font = 'bold 15px ui-monospace, monospace'; g.fillStyle = '#e7eef3'; g.fillText(b.name.toUpperCase(), W / 2, by - 8);
    for (let i = 0; i < 3; i++) { const px = bx + bw - 8 - i * 15, py = by - 13; g.save(); g.translate(px, py); g.rotate(Math.PI / 4); g.fillStyle = i < b.phase ? (b.phase >= 3 ? '#ef5148' : b.phase >= 2 ? '#eccb73' : '#9fb6c2') : 'rgba(120,150,170,.25)'; g.fillRect(-4, -4, 8, 8); g.restore(); }
    this.bar(g, bx, by, bw, 13, b.hp, b.maxHp, '#ef5148', { trail: b.hpShown, tcol: '255,150,60' });
    const pcol = b.posture > b.maxPosture * 0.8 ? `rgba(255,216,107,${0.7 + 0.3 * Math.sin(time * 0.02)})` : '#cfc7b0'; this.bar(g, bx + bw * 0.14, by + 18, bw * 0.72, 8, b.posture, b.maxPosture, pcol);
    g.font = '9px ui-monospace, monospace'; g.fillStyle = '#7f97a6'; g.fillText('POSTURE', W / 2, by + 35);
    // log + controls
    this.rr(g, 24, H - 30, W - 48, 22, 6); g.fillStyle = 'rgba(7,11,15,.82)'; g.fill(); g.strokeStyle = 'rgba(120,160,180,.3)'; g.lineWidth = 1; g.stroke();
    g.textAlign = 'left'; g.fillStyle = '#dfeaf0'; g.font = '12px ui-monospace, monospace'; g.fillText(eng.log, 36, H - 15);
    const ctl = 'WASD move · J light · K heavy · L dodge · I/U special · H heal' + (eng.isWildBattle ? ' · C catch · F flee' : '');
    g.textAlign = 'right'; g.fillStyle = '#7f97a6'; g.font = '10px ui-monospace, monospace'; g.fillText(ctl, W - 36, H - 15); g.textAlign = 'left';
  }
  private drawSlot(g: CanvasRenderingContext2D, x: number, y: number, eng: ActionEngine, slot: string, name: string) {
    const cd = eng.p.cd[slot] || 0, cdmax = eng.p.cdMax[slot] || 3000; const ready = cd <= 0;
    g.fillStyle = ready ? 'rgba(20,32,40,.9)' : 'rgba(14,20,26,.9)'; this.rr(g, x, y, 84, 18, 4); g.fill(); g.strokeStyle = ready ? 'rgba(120,200,255,.5)' : 'rgba(90,110,125,.4)'; g.lineWidth = 1; g.stroke();
    g.fillStyle = ready ? '#cfe6ff' : '#5d7180'; g.font = 'bold 10px ui-monospace, monospace'; g.textAlign = 'left'; g.fillText(slot, x + 6, y + 12);
    g.fillStyle = ready ? '#dfeaf0' : '#6f8493'; g.font = '9px ui-monospace, monospace'; g.fillText(name, x + 18, y + 12);
    if (!ready) { const f = clamp(cd / cdmax, 0, 1); g.fillStyle = 'rgba(90,140,180,.25)'; this.rr(g, x + 1, y + 1, 82 * f, 16, 3); g.fill(); g.fillStyle = '#9fc0d8'; g.textAlign = 'right'; g.font = '9px ui-monospace, monospace'; g.fillText(Math.ceil(cd / 1000) + 's', x + 80, y + 12); g.textAlign = 'left'; }
  }
}
