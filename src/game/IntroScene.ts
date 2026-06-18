import Phaser from 'phaser';
import { world } from '../world/store';
import { makeMonster, SPECIES } from '../world/monsters';
import { MAP_W, MAP_H, TILE } from './maps';
import { GamepadPoller } from './gamepad';

// Intro: Oak welcomes you, explains how this world works (it's NOT a normal
// Pokémon game), teaches the controls, and you pick your starter.
// Pages advance with SPACE; the starter page takes 1/2/3.

interface Page { speaker: string; text: string; starterPick?: boolean }

const PAGES: Page[] = [
  { speaker: '', text: 'KANTO — but not the Kanto you remember.\n\nNo script. No fixed storyline. Every day this world\nmoves on its own: factions scheme, leaders tire,\nbuildings rise and fall... and everyone remembers\nwhat you do.' },
  { speaker: 'PROF. OAK', text: 'Welcome! My name is OAK. People call me the\nPokémon Professor. You must be the new trainer\nwho just arrived in Viridian City!' },
  { speaker: 'PROF. OAK', text: 'Let me be frank: nobody will hand you a destiny\nhere. Want to be Champion? Earn badges and the\nLeague\'s respect. Want Brock\'s gym? Beat him and\nprove yourself. Drawn to... darker work? Team\nRocket is always watching for talent.' },
  { speaker: 'PROF. OAK', text: 'Your REPUTATION is everything — with the League,\nwith Team Rocket, with ordinary folk, and with us\nresearchers. Every conversation and battle shifts\nit. People will treat you accordingly. Choose who\nyou become.' },
  { speaker: 'PROF. OAK', text: 'The basics:\n  ARROWS / WASD ... walk around\n  SPACE .......... talk to someone next to you\n  1 / 2 / 3 ...... pick what to say (or which move)\n  T .............. rest for the night (a new day —\n                   and the world moves overnight!)\n  J .............. your journal of world events' },
  { speaker: 'PROF. OAK', text: 'Battles are classic: type matchups matter, tall\ngrass hides wild Pokémon, C throws a capture orb,\nR runs away. Lose and you pay up — this world\ndoesn\'t coddle anyone.' },
  { speaker: 'PROF. OAK', text: 'Now — the important part! I have three Pokémon\nhere. Your very first partner. Choose wisely:', starterPick: true },
];

const STARTERS = ['bulbasaur', 'charmander', 'squirtle'] as const;

export class IntroScene extends Phaser.Scene {
  private page = 0;
  private speakerText!: Phaser.GameObjects.Text;
  private bodyText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private starterSprites: Phaser.GameObjects.Image[] = [];
  private starterImgs: Phaser.GameObjects.Image[] = [];
  private starterLabels: Phaser.GameObjects.Text[] = [];
  private starterSel = 1;   // default highlight: Charmander
  private pad = new GamepadPoller();
  private done = false;

  constructor() { super('intro'); }

  create() {
    // returning player? skip straight to the world
    if (world.state.player.flags.introDone) { this.scene.start('world'); return; }
    const W = MAP_W * TILE, H = MAP_H * TILE;
    this.page = 0;
    this.add.rectangle(0, 0, W, H, 0x0b1118).setOrigin(0);
    this.add.rectangle(8, 8, W - 16, H - 16, 0x101820).setOrigin(0).setStrokeStyle(2, 0x2e4a63);

    this.speakerText = this.add.text(20, 22, '', { fontFamily: 'monospace', fontSize: '12px', color: '#7fd4ff', fontStyle: 'bold' });
    this.bodyText = this.add.text(20, 44, '', { fontFamily: 'monospace', fontSize: '11px', color: '#e6f1fa', lineSpacing: 5, wordWrap: { width: W - 40 } });
    this.hintText = this.add.text(W / 2, H - 26, '', { fontFamily: 'monospace', fontSize: '10px', color: '#5d7890' }).setOrigin(0.5);

    // preload starter sprites for the pick page
    STARTERS.forEach(s => {
      const key = `mon_${SPECIES[s].dexId}`;
      if (!this.textures.exists(key)) this.load.image(key, `/sprites/${SPECIES[s].dexId}.png`);
    });
    this.load.start();

    this.input.keyboard!.on('keydown', (ev: KeyboardEvent) => this.onKey(ev.key));
    this.render();
  }

  private render() {
    const p = PAGES[this.page];
    this.speakerText.setText(p.speaker);
    this.bodyText.setText(p.text);
    this.starterSprites.forEach(s => s.destroy());
    this.starterSprites = [];
    this.starterImgs = [];
    this.starterLabels = [];
    if (p.starterPick) {
      const W = MAP_W * TILE;
      STARTERS.forEach((s, i) => {
        const spec = SPECIES[s];
        const x = W / 2 + (i - 1) * 110;
        const img = this.add.image(x, 200, `mon_${spec.dexId}`).setScale(1.1);
        const label = this.add.text(x, 245, `[${i + 1}] ${spec.name}\n(${spec.type1})`, {
          fontFamily: 'monospace', fontSize: '10px', color: '#9fd4ff', align: 'center',
        }).setOrigin(0.5, 0);
        this.starterSprites.push(img, label as unknown as Phaser.GameObjects.Image);
        this.starterImgs.push(img);
        this.starterLabels.push(label);
      });
      this.highlightStarter();
      this.hintText.setText('1/2/3 — or ◀ ▶ then (A) — to choose your partner');
    } else {
      this.hintText.setText('[SPACE] / (A) continue    ·    [ENTER] skip to starter');
    }
  }

  private highlightStarter() {
    this.starterLabels.forEach((t, i) => t.setColor(i === this.starterSel ? '#ffe9a0' : '#9fd4ff'));
    this.starterImgs.forEach((im, i) => im.setScale(i === this.starterSel ? 1.32 : 1.1));
  }

  // controller support (keyboard still flows through onKey)
  update() {
    if (this.done) return;
    const gp = this.pad.poll();
    if (!gp.connected) return;
    if (PAGES[this.page].starterPick) {
      if (gp.left) { this.starterSel = (this.starterSel + STARTERS.length - 1) % STARTERS.length; this.highlightStarter(); }
      if (gp.right) { this.starterSel = (this.starterSel + 1) % STARTERS.length; this.highlightStarter(); }
      if (gp.A) this.chooseStarter(STARTERS[this.starterSel]);
      return;
    }
    if (gp.start) { this.page = PAGES.length - 1; this.render(); return; }  // skip to starter
    if (gp.A || gp.right) { this.page = Math.min(PAGES.length - 1, this.page + 1); this.render(); }
    else if (gp.B || gp.left) { if (this.page > 0) { this.page--; this.render(); } }
  }

  private onKey(key: string) {
    const p = PAGES[this.page];
    if (p.starterPick) {
      const i = Number(key) - 1;
      if (i >= 0 && i < STARTERS.length) this.chooseStarter(STARTERS[i]);
      return;
    }
    // ENTER skips straight to the starter choice
    if (key === 'Enter') {
      this.page = PAGES.length - 1;
      this.render();
      return;
    }
    // Backspace / Left go to the previous page
    if ((key === 'Backspace' || key === 'ArrowLeft') && this.page > 0) {
      this.page--;
      this.render();
      return;
    }
    if (key === ' ' || key === 'ArrowRight') {
      this.page++;
      if (this.page >= PAGES.length) this.page = PAGES.length - 1;
      this.render();
    }
  }

  private chooseStarter(speciesId: string) {
    if (this.done) return;
    this.done = true;
    const spec = SPECIES[speciesId];
    world.state.player.party = [makeMonster(speciesId, 8)];
    world.state.player.flags.introDone = true;
    world.logEvent('world_news', `Prof. Oak gave the new trainer their first Pokémon: a ${spec.name}.`);
    world.state.events = world.state.events.filter(e => !e.summary.includes('single Charmander'));
    world.logEvent('world_news', `A new trainer arrived in Viridian City with a ${spec.name}.`);
    world.save();
    this.cameras.main.fadeOut(400, 11, 15, 20);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('world');
    });
  }
}
