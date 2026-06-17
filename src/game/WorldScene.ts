import Phaser from 'phaser';
import { world } from '../world/store';
import { buildMap, generateTileset, generateSprites, isSolid, isLedge, T, TILE, MAP_W, MAP_H, type MapData } from './maps';
import { preloadFrlgTiles, frlgReady, FRLG_ATLAS_KEY } from './frlgTiles';
import { preloadInteriors, isInteriorId } from './interiors';
import { loadCharSheets, SHEET_BY_INDEX, STAND_FRAME } from './charSprites';
import { npcDialogue, type DialogueTurn, type DialogueChoice } from '../llm/dialogue';
import { LEAVE_LABEL } from '../world/dialogueContent';
import { prefetchOpenings, prefetchFollowups, peekCached } from '../llm/dialogueCache';
import { runWorldTick } from '../llm/director';
import { advanceStory, markTalk, objectiveLine, objectiveHint } from '../world/story';
import { makeMonster, SPECIES } from '../world/monsters';
import type { NPC } from '../world/types';

// Main overworld scene: grid movement, NPC interaction, LLM dialogue with
// choices, day ticks, wild encounters in tall grass, map transitions.

export class WorldScene extends Phaser.Scene {
  private mapId = 'viridian';
  private mapData!: MapData;
  private tileSprites: Phaser.GameObjects.GameObject[] = [];
  private npcSprites = new Map<string, Phaser.GameObjects.Image | Phaser.GameObjects.Sprite>();
  private playerSprite!: Phaser.GameObjects.Sprite;
  private facing: 'down' | 'up' | 'left' | 'right' = 'down';
  private sheetsReady = false;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private keySpace!: Phaser.Input.Keyboard.Key;
  private keyT!: Phaser.Input.Keyboard.Key;
  private keyJ!: Phaser.Input.Keyboard.Key;
  private keys123: Phaser.Input.Keyboard.Key[] = [];
  private moving = false;
  private hud!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private bannerTimer?: Phaser.Time.TimerEvent;
  private bannerQueue: { text: string; ms: number }[] = [];
  private bannerShowing = false;
  private ticking = false; // guards the async day tick (re-entrancy + movement)

  // shop state
  private shopBox?: Phaser.GameObjects.Container;
  private shopSel = 0;

  // dialogue state
  private dlgBox?: Phaser.GameObjects.Container;
  private dlgNpc: NPC | null = null;
  private dlgTurn: DialogueTurn | null = null;
  private dlgBusy = false;

  constructor() { super('world'); }

  preload() {
    preloadFrlgTiles(this);
    preloadInteriors(this);
  }

  // tile (map-local) → pixel, accounting for centering origin of smaller maps
  private px(x: number): number { return (this.mapData.originX + x) * TILE; }
  private py(y: number): number { return (this.mapData.originY + y) * TILE; }

  async create() {
    generateTileset(this);
    generateSprites(this);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as Record<string, Phaser.Input.Keyboard.Key>;
    this.keySpace = this.input.keyboard!.addKey('SPACE');
    this.keyT = this.input.keyboard!.addKey('T');
    this.keyJ = this.input.keyboard!.addKey('J');
    this.keys123 = ['ONE', 'TWO', 'THREE'].map(k => this.input.keyboard!.addKey(k));
    // main.ts owns the ESC key: it asks whether an in-game modal is open and,
    // if so, tells us to close it instead of opening Settings (no key race)
    (window as any).worldModalActive = () => !!(this.shopBox || this.dlgBox);
    (window as any).worldCloseModal = () => { if (this.shopBox) this.closeShop(); else if (this.dlgBox) this.closeDialogue(); };

    this.mapId = world.state.player.map;
    this.renderMap();

    this.playerSprite = this.add.sprite(0, 0, 'char_0').setOrigin(0).setDepth(10);
    this.syncPlayerSprite();

    this.hud = this.add.text(4, 4, '', {
      fontFamily: 'monospace', fontSize: '10px', color: '#eaf4ff',
      backgroundColor: '#101820dd', padding: { x: 6, y: 4 },
    }).setScrollFactor(0).setDepth(101);

    // banner sits below the 3-line HUD so they never overlap
    this.banner = this.add.text(MAP_W * TILE / 2, 70, '', {
      fontFamily: 'monospace', fontSize: '11px', color: '#ffe9a0', align: 'center',
      backgroundColor: '#1a2430f5', padding: { x: 10, y: 6 }, wordWrap: { width: 360 },
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100).setVisible(false);

    world.onChange(() => { this.renderMap(); this.updateHud(); });
    this.updateHud();

    const day = world.state.day;
    const where = this.placeLabel(this.mapId);
    this.showBanner(day === 1
      ? `Day 1 — ${where}.\nArrows/WASD move · SPACE talk · T end day · J journal · ESC settings`
      : `Day ${day} — welcome back to ${where}.`);
    // surface the opening objective / any newly-reached chapter directive
    this.time.delayedCall(day === 1 ? 5200 : 2600, () => this.applyStory());

    this.events.on('resume', (_s: Phaser.Scenes.ScenePlugin, data?: { battleResult?: string }) => {
      if (data?.battleResult) this.onBattleEnd(data.battleResult);
    });

    // FireRed character sheets load async; swap in when ready
    await loadCharSheets(this);
    this.sheetsReady = true;
    if (this.textures.exists('ow_player')) {
      this.playerSprite.setTexture('ow_player', STAND_FRAME[this.facing]);
      // 16x32 sprite on a 16x16 grid: feet on tile, head overlaps tile above
      this.playerSprite.setOrigin(0, 0.5).setDepth(10);
      this.syncPlayerSprite();
    }
    this.renderNpcs();
  }

  // ——— rendering from world state ———
  private renderMap() {
    this.mapData = buildMap(this.mapId);
    this.tileSprites.forEach(s => s.destroy());
    this.tileSprites = [];
    const { w, h, originX, originY, interiorImage, frames } = this.mapData;

    if (interiorImage) {
      // interiors: a single pre-rendered FRLG background image, centered
      if (this.textures.exists(interiorImage)) {
        const img = this.add.image(originX * TILE, originY * TILE, interiorImage).setOrigin(0).setDepth(0);
        this.tileSprites.push(img);
      } else {
        const r = this.add.rectangle(originX * TILE, originY * TILE, w * TILE, h * TILE, 0x283038).setOrigin(0).setDepth(0);
        this.tileSprites.push(r);
      }
      this.renderNpcs();
      return;
    }

    const useAtlas = frlgReady(this) && frames;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (useAtlas && frames) {
          const img = this.add.image(this.px(x), this.py(y), FRLG_ATLAS_KEY, frames[y][x]);
          img.setOrigin(0).setDepth(0);
          this.tileSprites.push(img);
        } else {
          const img = this.add.image(this.px(x), this.py(y), 'tiles');
          img.setOrigin(0).setDepth(0);
          img.setCrop(this.mapData.tiles[y][x] * TILE, 0, TILE, TILE);
          img.x -= this.mapData.tiles[y][x] * TILE;
          this.tileSprites.push(img);
        }
      }
    }
    this.renderNpcs();
  }

  private renderNpcs() {
    this.npcSprites.forEach(s => s.destroy());
    this.npcSprites.clear();
    for (const npc of Object.values(world.state.npcs)) {
      if (npc.map !== this.mapId) continue;
      // the NPC you're mid-conversation with stays above the player
      const depth = this.dlgNpc?.id === npc.id ? 11 : 9;
      const sheet = SHEET_BY_INDEX[npc.sprite] ?? 'youngster';
      if (this.sheetsReady && this.textures.exists(`ow_${sheet}`)) {
        const spr = this.add.sprite(this.px(npc.x), this.py(npc.y), `ow_${sheet}`, 0)
          .setOrigin(0, 0.5).setDepth(depth);
        this.npcSprites.set(npc.id, spr);
      } else {
        const img = this.add.image(this.px(npc.x), this.py(npc.y), `char_${npc.sprite}`).setOrigin(0).setDepth(depth);
        this.npcSprites.set(npc.id, img);
      }
    }
  }

  private syncPlayerSprite() {
    const p = world.state.player;
    this.playerSprite.setPosition(this.px(p.x), this.py(p.y));
    this.setupCamera();
  }

  // fixed camera for maps that fit the canvas; follow the player for oversized
  // interiors (e.g. the 20x24 Viridian Gym) so the exit/top never clip off-screen
  private setupCamera() {
    const cam = this.cameras.main;
    const fullW = (this.mapData.originX + this.mapData.w) * TILE;
    const fullH = (this.mapData.originY + this.mapData.h) * TILE;
    if (fullW > MAP_W * TILE || fullH > MAP_H * TILE) {
      cam.setBounds(0, 0, Math.max(fullW, MAP_W * TILE), Math.max(fullH, MAP_H * TILE));
      cam.startFollow(this.playerSprite, true, 0.25, 0.25);
    } else {
      cam.stopFollow();
      cam.setBounds(0, 0, MAP_W * TILE, MAP_H * TILE);
      cam.setScroll(0, 0);
    }
  }

  // human label for a map id (town name+mood, or building name for interiors)
  private placeLabel(mapId: string, withMood = false): string {
    const s = world.state;
    if (isInteriorId(mapId)) return s.buildings[mapId.slice(4)]?.name ?? 'Indoors';
    const town = s.towns[mapId];
    if (!town) return mapId;
    return withMood ? `${town.name} (${town.mood})` : town.name;
  }

  private updateHud() {
    const s = world.state;
    const p = s.player;
    const r = p.reputation;
    const lead = p.party[0];
    const place = this.placeLabel(this.mapId, true);
    this.hud.setText(
      `Day ${s.day} · ${place} · ¥${p.money} · Badges ${p.badges}\n` +
      `Rep  L:${r.league} R:${r.rocket} C:${r.civic} S:${r.research}` +
      (lead ? `   ${SPECIES[lead.speciesId].name} Lv${lead.level} ${lead.hp}/${lead.maxHp}HP` : '') +
      `\n▶ ${objectiveLine(s)}`,
    );
  }

  // FIFO banner queue so story payoffs / day reports never clobber each other.
  // `low: true` banners (e.g. town mood on transition) are skipped when busy.
  private showBanner(text: string, ms = 5000, opts: { low?: boolean } = {}) {
    if (opts.low && (this.bannerShowing || this.bannerQueue.length)) return;
    if (this.bannerQueue.length > 6) this.bannerQueue.shift();
    this.bannerQueue.push({ text, ms });
    if (!this.bannerShowing) this.nextBanner();
  }
  private nextBanner() {
    const b = this.bannerQueue.shift();
    this.bannerTimer?.remove();
    if (!b) { this.bannerShowing = false; this.banner.setVisible(false); return; }
    this.bannerShowing = true;
    this.banner.setText(b.text).setVisible(true);
    this.bannerTimer = this.time.delayedCall(b.ms, () => this.nextBanner());
  }

  // Advance the authored story spine and surface payoff lines + the directive
  // for any chapter the player just reached. Returns the lines (so the day
  // tick can fold them into its morning report instead of double-bannering).
  private applyStory(silent = false): string[] {
    const upd = advanceStory(world.state);
    const lines = [...upd.toasts];
    if (upd.directive) lines.push(upd.directive);
    if (lines.length && !silent) {
      this.showBanner(lines.join('\n\n'), 9000);
    }
    this.updateHud();
    return lines;
  }

  // ——— game loop ———
  update() {
    if (this.shopBox) { this.updateShop(); return; }
    if (this.dlgBox) { this.updateDialogue(); return; }
    if (this.moving || this.ticking) return;

    if (Phaser.Input.Keyboard.JustDown(this.keySpace)) { this.tryInteract(); return; }
    if (Phaser.Input.Keyboard.JustDown(this.keyT)) { this.endDay(); return; }
    if (Phaser.Input.Keyboard.JustDown(this.keyJ)) { (window as any).showJournal?.(); return; }

    let dx = 0, dy = 0;
    if (this.cursors.left.isDown || this.wasd.A.isDown) dx = -1;
    else if (this.cursors.right.isDown || this.wasd.D.isDown) dx = 1;
    else if (this.cursors.up.isDown || this.wasd.W.isDown) dy = -1;
    else if (this.cursors.down.isDown || this.wasd.S.isDown) dy = 1;
    if (!dx && !dy) return;

    // update facing (even when blocked — like the real games)
    this.facing = dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : 'down';
    this.applyFacing();

    const p = world.state.player;
    const nx = p.x + dx, ny = p.y + dy;

    // map exit?
    const exit = this.mapData.exits.find(e => e.x === nx && e.y === ny);
    if (exit) { this.transition(exit.toMap, exit.toX, exit.toY); return; }

    const W = this.mapData.w, H = this.mapData.h;

    // south-facing ledge: hop down over it (like the real games)
    if (isLedge(this.mapData.tiles, nx, ny)) {
      if (dy !== 1) return;
      const ly = ny + 1;
      if (isSolid(this.mapData.tiles, nx, ly, W, H) || isLedge(this.mapData.tiles, nx, ly)) return;
      if (Object.values(world.state.npcs).some(n => n.map === this.mapId && n.x === nx && n.y === ly)) return;
      this.moving = true;
      p.x = nx; p.y = ly;
      this.playWalkAnim();
      this.tweens.add({
        targets: this.playerSprite, x: this.px(nx), y: this.py(ly) + this.playerYOffset(),
        duration: 230, ease: 'Quad.easeOut',
        onComplete: () => { this.moving = false; world.save(); },
      });
      return;
    }

    if (isSolid(this.mapData.tiles, nx, ny, W, H)) return;
    if (Object.values(world.state.npcs).some(n => n.map === this.mapId && n.x === nx && n.y === ny)) return;

    this.moving = true;
    p.x = nx; p.y = ny;
    this.playWalkAnim();
    this.tweens.add({
      targets: this.playerSprite, x: this.px(nx), y: this.py(ny) + this.playerYOffset(), duration: 110,
      onComplete: () => {
        this.moving = false;
        world.save();
        // wild encounter in tall grass (overworld only)
        if (this.mapData.tiles[ny][nx] === T.TALLGRASS && Math.random() < 0.12) this.startWildBattle();
      },
    });
  }

  private usingSheets(): boolean {
    return this.sheetsReady && this.textures.exists('ow_player');
  }

  private playerYOffset(): number {
    return 0; // origin(0, 0.5) on 16x32 already centers feet on tile
  }

  private applyFacing() {
    if (!this.usingSheets()) return;
    this.playerSprite.setFlipX(this.facing === 'right');
  }

  private playWalkAnim() {
    if (!this.usingSheets()) return;
    const dir = this.facing === 'right' ? 'left' : this.facing;
    this.playerSprite.play(`ow_player_walk_${dir}`, true);
    this.playerSprite.once('animationcomplete', () => {
      this.playerSprite.setFrame(STAND_FRAME[this.facing]);
    });
  }

  private transition(toMap: string, toX: number, toY: number) {
    const p = world.state.player;
    this.moving = true; // lock input/collision until the new map is loaded
    p.map = toMap; p.x = toX; p.y = toY;
    this.mapId = toMap;
    world.save();
    this.cameras.main.fadeOut(150, 11, 15, 20);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.renderMap();
      this.syncPlayerSprite();
      this.updateHud();
      this.cameras.main.fadeIn(150, 11, 15, 20);
      this.moving = false;
      void prefetchOpenings(toMap); // warm this map's cast (background, key-gated)
      if (isInteriorId(toMap)) {
        this.showBanner(this.placeLabel(toMap), 2200, { low: true });
      } else {
        const t = world.state.towns[toMap];
        if (t) this.showBanner(`${t.name} — mood: ${t.mood}`, 2500, { low: true });
      }
    });
  }

  // ——— interaction & dialogue ———
  private tryInteract() {
    const p = world.state.player;
    const [dx, dy] = this.facing === 'up' ? [0, -1] : this.facing === 'down' ? [0, 1]
      : this.facing === 'left' ? [-1, 0] : [1, 0];
    const localNpcs = Object.values(world.state.npcs).filter(n => n.map === this.mapId);
    const npcAt = (x: number, y: number) =>
      localNpcs.find(n => n.x === x && n.y === y);
    // the tile you're facing, then one tile further if a counter/wall is between
    let near = npcAt(p.x + dx, p.y + dy);
    if (!near && isSolid(this.mapData.tiles, p.x + dx, p.y + dy, this.mapData.w, this.mapData.h)) {
      near = npcAt(p.x + 2 * dx, p.y + 2 * dy); // talk across a service counter
    }
    // fallback: any 4-adjacent NPC (forgiving overworld interaction)
    if (!near) {
      near = localNpcs.find(n => Math.abs(n.x - p.x) + Math.abs(n.y - p.y) === 1);
    }
    // service NPCs (nurse/clerk) sit behind counters — reach them from a small
    // forward area so healing/shopping never feels broken
    if (!near) {
      near = localNpcs.find(n =>
        (n.id.startsWith('nurse') || n.id.startsWith('clerk')) &&
        Math.abs(n.x - p.x) <= 1 && n.y < p.y && p.y - n.y <= 3);
    }
    // 16x32 character sprites can make a diagonal NPC look directly reachable.
    // Allow that case, but not through a solid corner.
    if (!near) {
      near = localNpcs.find(n => {
        if (Math.abs(n.x - p.x) !== 1 || Math.abs(n.y - p.y) !== 1) return false;
        return !isSolid(this.mapData.tiles, n.x, p.y, this.mapData.w, this.mapData.h) ||
          !isSolid(this.mapData.tiles, p.x, n.y, this.mapData.w, this.mapData.h);
      });
    }
    if (!near) return;
    if (near.id.startsWith('nurse')) { this.healAtCenter(near.name); return; }
    if (near.id.startsWith('clerk')) { this.talkClerk(near.name); return; }
    this.openDialogue(near);
  }

  // Pokémon Center nurse: full heal, the iconic line.
  private healAtCenter(nurseName: string) {
    const party = world.state.player.party;
    const hurt = party.some(m => m.hp < m.maxHp);
    party.forEach(m => { m.hp = m.maxHp; });
    world.save();
    this.updateHud();
    this.showBanner(hurt
      ? `${nurseName}: "Welcome! ...Your Pokémon are now fully healed. We hope to see you again!"`
      : `${nurseName}: "Your Pokémon are already in perfect health!"`, 3500);
  }

  // ——— Poké Mart shop ———
  private shopKeys: Phaser.Input.Keyboard.Key[] = [];
  private static readonly SHOP_ITEMS = [
    { id: 'potion', name: 'Potion', price: 200, desc: 'Restores 35 HP in battle' },
    { id: 'pokeball', name: 'Poké Ball', price: 150, desc: 'Catch wild Pokémon' },
  ];

  private talkClerk(clerkName: string) {
    this.shopSel = 0;
    if (!this.shopKeys.length) {
      this.shopKeys = ['UP', 'DOWN'].map(k => this.input.keyboard!.addKey(k));
    }
    this.drawShop(`${clerkName}: "Welcome to the Poké Mart! What can I get you?"`);
  }

  private drawShop(headline: string) {
    this.shopBox?.destroy();
    const W = MAP_W * TILE, H = 132;
    const c = this.add.container(0, MAP_H * TILE - H).setDepth(200).setScrollFactor(0);
    const bg = this.add.rectangle(0, 0, W, H, 0x101820, 0.97).setOrigin(0).setStrokeStyle(2, 0x2e4a63);
    const txt = this.add.text(8, 6, headline, { fontFamily: 'monospace', fontSize: '10px', color: '#e6f1fa', wordWrap: { width: W - 16 } });
    c.add([bg, txt]);
    WorldScene.SHOP_ITEMS.forEach((it, i) => {
      const owned = world.state.player.items[it.id] ?? 0;
      const sel = i === this.shopSel;
      c.add(this.add.text(14, 34 + i * 18, `${sel ? '▶' : ' '} ${it.name.padEnd(11)} ¥${it.price}   (have ${owned}) — ${it.desc}`, {
        fontFamily: 'monospace', fontSize: '10px', color: sel ? '#ffe9a0' : '#9fd4ff',
      }));
    });
    c.add(this.add.text(8, H - 20, `Your money: ¥${world.state.player.money}`, { fontFamily: 'monospace', fontSize: '10px', color: '#8fe0a0' }));
    c.add(this.add.text(W - 8, H - 20, '↑↓ select · SPACE buy · ESC leave', { fontFamily: 'monospace', fontSize: '9px', color: '#5d7890' }).setOrigin(1, 0));
    this.shopBox = c;
  }

  private updateShop() {
    if (Phaser.Input.Keyboard.JustDown(this.shopKeys[0])) { this.shopSel = (this.shopSel + WorldScene.SHOP_ITEMS.length - 1) % WorldScene.SHOP_ITEMS.length; this.drawShop('What can I get you?'); }
    else if (Phaser.Input.Keyboard.JustDown(this.shopKeys[1])) { this.shopSel = (this.shopSel + 1) % WorldScene.SHOP_ITEMS.length; this.drawShop('What can I get you?'); }
    else if (Phaser.Input.Keyboard.JustDown(this.keySpace)) this.buyItem();
    this.keys123.forEach((key, i) => { if (Phaser.Input.Keyboard.JustDown(key) && i < WorldScene.SHOP_ITEMS.length) { this.shopSel = i; this.buyItem(); } });
  }

  private buyItem() {
    const it = WorldScene.SHOP_ITEMS[this.shopSel];
    const p = world.state.player;
    if (p.money < it.price) { this.drawShop(`"You can't afford a ${it.name}. (¥${it.price})"`); return; }
    p.money -= it.price;
    p.items[it.id] = (p.items[it.id] ?? 0) + 1;
    world.save();
    this.updateHud();
    this.drawShop(`Bought a ${it.name}! "Anything else?"`);
  }

  private closeShop() {
    this.shopBox?.destroy();
    this.shopBox = undefined;
  }

  private async openDialogue(npc: NPC) {
    this.dlgNpc = npc;
    this.dlgTurn = null;
    this.dlgBusy = true;
    // raise the NPC above the player so they're fully visible during the talk
    // (16x32 sprites otherwise overlap when you face them from an adjacent tile)
    this.npcSprites.get(npc.id)?.setDepth(11);
    // prefetched? skip the "..." loading flash entirely
    if (!peekCached(npc, null)) this.drawDialogue(`${npc.name} ...`, []);
    const turn = await npcDialogue(npc, null);
    if (this.dlgNpc !== npc) return; // player left while it was loading
    markTalk(world.state, npc.id);   // the exchange actually happened now
    this.dlgTurn = turn;
    this.dlgBusy = false;
    this.drawDialogue(turn.npcLine, turn.choices);
    prefetchFollowups(npc, turn);    // warm the responses to each choice
  }

  private drawDialogue(text: string, choices: DialogueChoice[]) {
    this.dlgBox?.destroy();
    const W = MAP_W * TILE, PAD = 8, GAP = 6, wrap = W - 2 * PAD;
    const SCREEN_H = MAP_H * TILE;

    // build texts first so we can measure them and size the box to fit
    const npcTxt = this.add.text(0, 0, text, {
      fontFamily: 'monospace', fontSize: '11px', color: '#e6f1fa',
      wordWrap: { width: wrap }, lineSpacing: 3,
    });
    const choiceTexts = choices.map((ch, i) => this.add.text(0, 0, `[${i + 1}] ${ch.label}`, {
      fontFamily: 'monospace', fontSize: '10px', color: '#9fd4ff',
      wordWrap: { width: wrap - 4 }, lineSpacing: 2,
    }));
    const hint = !this.dlgBusy;
    const hintH = hint ? 16 : 0;

    // total content height, capped to ~75% of the screen (text scrolls visually
    // if it somehow exceeds, but LLM lines are length-capped upstream)
    let contentH = PAD + npcTxt.height + (choiceTexts.length ? GAP : 0);
    choiceTexts.forEach(t => { contentH += t.height + 4; });
    const H = Math.min(SCREEN_H - 6, Math.max(96, contentH + hintH + PAD));
    const top = SCREEN_H - H;

    const c = this.add.container(0, top).setDepth(200).setScrollFactor(0);
    const bg = this.add.rectangle(0, 0, W, H, 0x101820, 0.97).setOrigin(0).setStrokeStyle(2, 0x2e4a63);
    c.add(bg);

    npcTxt.setPosition(PAD, PAD);
    c.add(npcTxt);
    let y = PAD + npcTxt.height + GAP;
    choiceTexts.forEach(t => { t.setPosition(PAD + 4, y); c.add(t); y += t.height + 4; });

    if (hint) {
      c.add(this.add.text(W - PAD, H - 15, choices.length ? '[SPACE] leave' : '[SPACE] close', {
        fontFamily: 'monospace', fontSize: '9px', color: '#5d7890',
      }).setOrigin(1, 0));
    }
    this.dlgBox = c;
  }

  private updateDialogue() {
    if (this.dlgBusy) return;
    if (Phaser.Input.Keyboard.JustDown(this.keySpace)) {
      this.closeDialogue(); return;
    }
    this.keys123.forEach((key, i) => {
      if (Phaser.Input.Keyboard.JustDown(key)) this.pickChoice(i);
    });
  }

  private async pickChoice(i: number) {
    const npc = this.dlgNpc, turn = this.dlgTurn;
    if (!npc || !turn || !turn.choices[i]) return;
    const ch = turn.choices[i];

    // "say goodbye" just ends the conversation
    if (ch.label === LEAVE_LABEL) { this.closeDialogue(); return; }

    // apply structured effects (sim-validated)
    const eff = ch.repEffects;
    if (eff.league || eff.rocket || eff.civic || eff.research)
      world.addRep(eff, `talking with ${npc.name}`);
    npc.attitude = Math.max(-100, Math.min(100, npc.attitude + ch.attitudeDelta));

    if (ch.acceptsOffer) {
      // match strictly by id; only fall back to fromNpc if exactly one offer exists
      const fromNpc = world.state.pendingOffers.filter(o => o.fromNpc === npc.id);
      const offer = world.state.pendingOffers.find(o => o.id === ch.acceptsOffer)
        ?? (fromNpc.length === 1 ? fromNpc[0] : undefined);
      if (offer) {
        const slot = world.state.slots[offer.slotId];
        const needsBattle = !!slot?.requires.defeatHolder && !!slot.holder && slot.holder !== 'player';
        if (needsBattle) {
          this.showBanner(`To claim ${slot.title}, you must defeat ${world.state.npcs[slot.holder!]?.name}!`);
        } else {
          const res = world.claimSlot(offer.slotId, false);
          this.showBanner(res.reason, 6000);
        }
        this.closeDialogue();
        this.updateHud();
        return;
      }
    }

    if (ch.startsBattle) {
      this.closeDialogue();
      this.startNpcBattle(npc);
      return;
    }

    // continue conversation (prefetched follow-ups make this instant)
    this.dlgBusy = true;
    if (!peekCached(npc, ch.label)) this.drawDialogue(`${npc.name} ...`, []);
    const next = await npcDialogue(npc, ch.label);
    if (this.dlgNpc !== npc) return; // player left while it was loading
    this.dlgTurn = next;
    this.dlgBusy = false;
    this.drawDialogue(next.npcLine, next.choices);
    prefetchFollowups(npc, next);    // warm the next level too
    world.save();
  }

  private closeDialogue() {
    this.dlgBox?.destroy();
    this.dlgBox = undefined;
    if (this.dlgNpc) this.npcSprites.get(this.dlgNpc.id)?.setDepth(9); // restore normal layering
    this.dlgNpc = null;
    this.dlgTurn = null;
    // talking to the right person can advance the spine (e.g. Elder Rosa)
    this.applyStory();
  }

  // ——— battles ———
  private startNpcBattle(npc: NPC) {
    this.scene.pause();
    this.scene.launch('battle', { kind: 'npc', npcId: npc.id });
  }

  private startWildBattle() {
    const pool = ['rattata', 'pidgey', 'pikachu', 'gastly'];
    const sp = pool[Math.floor(Math.random() * pool.length)];
    const lvl = 4 + Math.floor(Math.random() * 5);
    this.scene.pause();
    this.scene.launch('battle', { kind: 'wild', wild: makeMonster(sp, lvl) });
  }

  private onBattleEnd(result: string) {
    // a battle can relocate the player (blackout → respawn at a town Center),
    // so re-sync the active map before rendering
    this.mapId = world.state.player.map;
    this.updateHud();
    this.renderMap();
    this.syncPlayerSprite();
    if (result) this.showBanner(result, 5000);
    // a battle may have completed a story chapter (badge, Archer, Giovanni) —
    // let the payoff land after the result banner
    this.time.delayedCall(result ? 3200 : 0, () => this.applyStory());
  }

  // ——— day tick ———
  private async endDay() {
    if (this.ticking) return; // no overlapping ticks
    this.ticking = true;
    this.showBanner('Night falls... the world is moving.', 4000);
    // heal party at day end
    world.state.player.party.forEach(m => { m.hp = m.maxHp; });
    try {
      const res = await runWorldTick();
      const story = this.applyStory(true); // collect without bannering; fold in below
      this.renderMap();
      this.syncPlayerSprite();
      this.updateHud();
      const lines = [...res.headlines.map(h => '· ' + h), ...story.map(s => '★ ' + s)];
      const head = lines.length ? lines.join('\n') : '· A quiet night.';
      this.showBanner(`☀ Day ${world.state.day}${res.usedLLM ? '' : ' (offline director)'}\n${head}`, 9000);
    } finally {
      this.ticking = false;
    }
  }
}
