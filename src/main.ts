import Phaser from 'phaser';
import { IntroScene } from './game/IntroScene';
import { WorldScene } from './game/WorldScene';
import { ActionBattleScene } from './game/ActionBattleScene';
import { getConfig, setConfig, testConnection } from './llm/client';
import { world } from './world/store';
import { makeMonster } from './world/monsters';
import { runDeterminismCheck } from './world/determinismCheck';
import { runKernelCheck } from './world/kernelCheck';
import { installHarness } from './world/harness';
import { benchModels, listModels } from './llm/benchModels';
import { MAP_W, MAP_H, TILE, T, buildMap } from './game/maps';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: MAP_W * TILE,
  height: MAP_H * TILE,
  zoom: 2,
  pixelArt: true,
  backgroundColor: '#0b0f14',
  scene: [IntroScene, WorldScene, ActionBattleScene],
});

// ——— Settings overlay ———
const $ = (id: string) => document.getElementById(id)!;
const overlay = $('settings-overlay');
const journalOverlay = $('journal-overlay');
const inBase = $('cfg-base') as HTMLInputElement;
const inKey = $('cfg-key') as HTMLInputElement;
const inModel = $('cfg-model') as HTMLInputElement;
const inFast = $('cfg-fast-model') as HTMLInputElement;
const status = $('llm-status');

function openSettings() {
  const cfg = getConfig();
  inBase.value = cfg.baseUrl;
  inKey.value = cfg.apiKey;
  inModel.value = cfg.model;
  inFast.value = cfg.fastModel;
  status.textContent = cfg.apiKey ? 'Key saved. Test to verify.' : 'No key — running on fallback rule engine.';
  status.className = cfg.apiKey ? 'ok' : 'bad';
  overlay.classList.add('open');
  game.input.keyboard!.enabled = false;
}
function closeSettings() {
  overlay.classList.remove('open');
  enableGameKeys();
}

// re-enable Phaser input AND clear any held-key state so the player doesn't
// keep walking / fire a stale key after an overlay closes
function enableGameKeys() {
  game.input.keyboard!.enabled = true;
  const ws = game.scene.getScene('world') as Phaser.Scene | null;
  ws?.input?.keyboard?.resetKeys();
}

$('cfg-save').onclick = () => {
  setConfig({ baseUrl: inBase.value.trim() || 'https://openrouter.ai/api/v1', apiKey: inKey.value.trim(), model: inModel.value.trim() || 'openai/gpt-5.5', fastModel: inFast.value.trim() });
  status.textContent = 'Saved.';
  status.className = 'ok';
};
$('cfg-test').onclick = async () => {
  setConfig({ baseUrl: inBase.value.trim() || 'https://openrouter.ai/api/v1', apiKey: inKey.value.trim(), model: inModel.value.trim() || 'openai/gpt-5.5', fastModel: inFast.value.trim() });
  status.textContent = 'Testing...';
  status.className = '';
  const r = await testConnection();
  status.textContent = r.detail;
  status.className = r.ok ? 'ok' : 'bad';
};
$('cfg-close').onclick = closeSettings;
$('cfg-newgame').onclick = () => {
  if (confirm('Wipe the world and start over?')) {
    world.reset();
    location.reload();
  }
};

// ——— Journal overlay ———
function showJournal() {
  const list = $('journal-list');
  const events = world.recentEvents(60).slice().reverse();
  list.innerHTML = events
    .map(e => `<div><span class="day">D${e.day}</span> ${escapeHtml(e.summary)}</div>`)
    .join('') || 'Nothing yet.';
  journalOverlay.classList.add('open');
  game.input.keyboard!.enabled = false;
}
function closeJournal() {
  journalOverlay.classList.remove('open');
  enableGameKeys();
}
$('journal-close').onclick = closeJournal;
(window as any).showJournal = showJournal;
// Dev: launch a battle on demand — `__battle('brock')` (npc) or `__battle('wild','pikachu',12)`.
(window as any).__battle = (a = 'brock', sp?: string, lvl = 8) => {
  const ws = game.scene.getScene('world');
  if (!ws) return 'world scene not ready';
  ws.scene.pause();
  if (a === 'wild') ws.scene.launch('actionBattle', { kind: 'wild', wild: makeMonster(sp || 'pikachu', lvl) });
  else ws.scene.launch('actionBattle', { kind: 'npc', npcId: a });
  return `launched ${a}`;
};
// P0 determinism acceptance check — run `__determinismCheck()` in the console.
(window as any).__determinismCheck = runDeterminismCheck;
// P2 kernel contract checks — run `__kernelCheck()` in the console.
(window as any).__kernelCheck = runKernelCheck;
// P4 simulation harness — window.harness = { observe, act, snapshot }.
installHarness();
// Model latency benchmark for the fast dialogue tier — uses the stored key internally.
(window as any).__benchModels = benchModels;
(window as any).__listModels = listModels;
// P5 eval — `__p5Check()` runs the mechanical DoD gates + divergence (no key);
// `__p5Judge()` runs the qualitative 4-pillar rubric (needs the in-game API key).
import('./world/p5Check').then(m => {
  (window as any).__p5Check = m.runP5Check;
  (window as any).__p5Judge = m.runP5Judge;
});
// P3 data-home probe — runs in the GAME's module context (shares the real
// `world` + `buildMap`), so it's immune to console dynamic-import instancing.
// Non-destructive: injects a throwaway runtime location + connection, checks
// buildMap consumes both, then cleans up.
(window as any).__p3Probe = () => {
  const L: string[] = [];
  for (let y = 0; y < MAP_H; y++) { let r = ''; for (let x = 0; x < MAP_W; x++) r += (y === 0 || y === MAP_H - 1 || x === 0 || x === MAP_W - 1) ? '#' : (x === 12 ? '=' : '.'); L.push(r); }
  world.state.mapLayouts['__probe'] = L;
  world.state.connections.push({ fromMap: 'pewter', fromX: 12, fromY: 1, toMap: '__probe', toX: 12, toY: 18 });
  const ember = buildMap('__probe');
  const pewter = buildMap('pewter');
  const result = {
    usedRuntimeLayout: ember.tiles[1][1] === T.GRASS && ember.tiles[1][12] === T.PATH,
    pewterExitToProbe: pewter.exits.some(e => e.toMap === '__probe'),
  };
  delete world.state.mapLayouts['__probe'];
  world.state.connections = world.state.connections.filter(c => c.toMap !== '__probe');
  return result;
};

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

window.addEventListener('keydown', e => {
  // J closes the journal when it's open
  if ((e.key === 'j' || e.key === 'J') && journalOverlay.classList.contains('open')) {
    closeJournal(); return;
  }
  if (e.key === 'Escape') {
    if (journalOverlay.classList.contains('open')) { closeJournal(); return; }
    if (overlay.classList.contains('open')) { closeSettings(); return; }
    // an in-game modal (dialogue / shop) owns ESC: close it, don't open Settings
    if ((window as any).worldModalActive?.()) { (window as any).worldCloseModal?.(); return; }
    openSettings();
  }
});
