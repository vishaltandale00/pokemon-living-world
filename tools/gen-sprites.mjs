#!/usr/bin/env node
// AI sprite/asset generator for Living Kanto.
//
// Generates dynamic POSE FRAMES for the battle Pokémon (idle / attack / hurt) by
// feeding each existing /public/sprites/<dexId>.png into an image-edit model as the
// reference, so the creature stays recognizable. Also does arena backgrounds and
// boss portraits. The renderer then plays the right pose per battle state.
//
// Provider auto-detected from env (set ONE):
//   OPENAI_API_KEY   -> OpenAI gpt-image-1   (native transparent background — best for sprites)
//   GEMINI_API_KEY   -> Google Gemini image  (no native alpha; sprites may need a chroma-key pass)
//   (GOOGLE_API_KEY also accepted for Gemini)
// Optional overrides: OPENAI_IMAGE_MODEL, GEMINI_IMAGE_MODEL.
//
// Usage:
//   OPENAI_API_KEY=sk-...  node tools/gen-sprites.mjs charmander       # one species: idle+attack+hurt
//   node tools/gen-sprites.mjs all                                     # all 13 species
//   node tools/gen-sprites.mjs poses charmander attack                 # a single pose
//   node tools/gen-sprites.mjs arena                                   # arena backdrop -> sprites/arena_bg.png
//   node tools/gen-sprites.mjs portrait onix                           # boss portrait -> sprites/<dex>_portrait.png
//
// Output PNGs land in /public/sprites/ next to the originals:
//   <dexId>_idle.png  <dexId>_atk.png  <dexId>_hurt.png  <dexId>_portrait.png  arena_bg.png
// Nothing is overwritten that the game needs as a fallback — the base <dexId>.png stays.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPRITES = join(HERE, '..', 'public', 'sprites');

// speciesId -> national dex (matches public/sprites/<dexId>.png). Kept in sync with src/world/monsters.ts.
const DEX = {
  charmander: 4, squirtle: 7, bulbasaur: 1, pikachu: 25, geodude: 74, onix: 95,
  gastly: 92, rattata: 19, pidgey: 16, houndour: 228, lapras: 131, dratini: 147, lugia: 249,
};

// ——— provider ———
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const PROVIDER = OPENAI_KEY ? 'openai' : GEMINI_KEY ? 'gemini' : null;
if (!PROVIDER) {
  console.error('No API key found. Set OPENAI_API_KEY (recommended for sprites) or GEMINI_API_KEY and re-run.');
  process.exit(1);
}
const OPENAI_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const GEMINI_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
console.log(`Provider: ${PROVIDER} (${PROVIDER === 'openai' ? OPENAI_MODEL : GEMINI_MODEL})`);

// ——— prompt library ———
const STYLE = 'Keep the SAME creature — identical species, colors, proportions and shapes. Full body, centered, facing right, clean crisp edges, soft rim light, no ground shadow, no background, fully transparent background. Dynamic, expressive, high-energy action-game creature art that reads at a glance.';
const POSE_PROMPT = {
  idle: `Redraw this creature in an alert ready idle stance, weight low, looking forward. ${STYLE}`,
  attack: `Redraw this creature mid-attack: lunging forward, limbs/claws/body thrust toward the enemy, maximum momentum and anticipation, a powerful committed strike pose. ${STYLE}`,
  hurt: `Redraw this creature flinching from a hit: recoiling backward, head turned, eyes winced, off-balance. ${STYLE}`,
};
const POSE_FILE = { idle: '_idle', attack: '_atk', hurt: '_hurt' };
const ARENA_PROMPT = 'A moody, atmospheric battle arena floor for a creature-combat action game: a cracked stone duel platform under dramatic rim lighting, dark teal-to-charcoal palette, faint dust and embers, subtle vignette, painterly but clean. No characters, no UI, no text. Wide 16:9 backdrop, the action happens in the lower-center.';
const PORTRAIT_PROMPT = (name) => `A dramatic head-and-shoulders portrait of this creature (${name}) for a battle intro card: three-quarter view, intense expression, rim light, dark moody background, painterly game-art style. Keep the same species, colors and shapes.`;

// ——— model calls (return a PNG Buffer) ———
async function genOpenAI({ prompt, refPath, size = '1024x1024', transparent = true }) {
  const form = new FormData();
  form.append('model', OPENAI_MODEL);
  form.append('prompt', prompt);
  form.append('size', size);
  if (transparent) form.append('background', 'transparent');
  form.append('n', '1');
  if (refPath) {
    const buf = readFileSync(refPath);
    form.append('image', new Blob([buf], { type: 'image/png' }), 'ref.png');
  }
  const url = refPath ? 'https://api.openai.com/v1/images/edits' : 'https://api.openai.com/v1/images/generations';
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}` }, body: form });
  const json = await res.json();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  return Buffer.from(json.data[0].b64_json, 'base64');
}

async function genGemini({ prompt, refPath }) {
  const parts = [{ text: prompt }];
  if (refPath) parts.push({ inline_data: { mime_type: 'image/png', data: readFileSync(refPath).toString('base64') } });
  const body = { contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE'] } };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  const part = (json.candidates?.[0]?.content?.parts || []).find(p => p.inline_data || p.inlineData);
  if (!part) throw new Error(`Gemini returned no image: ${JSON.stringify(json).slice(0, 400)}`);
  return Buffer.from((part.inline_data || part.inlineData).data, 'base64');
}

async function gen(opts) {
  return PROVIDER === 'openai' ? genOpenAI(opts) : genGemini(opts);
}

function refFor(species) {
  const dex = DEX[species];
  if (!dex) throw new Error(`Unknown species "${species}". Known: ${Object.keys(DEX).join(', ')}`);
  const ref = join(SPRITES, `${dex}.png`);
  if (!existsSync(ref)) throw new Error(`Missing reference sprite ${ref}`);
  return { dex, ref };
}

async function genPose(species, pose) {
  const { dex, ref } = refFor(species);
  const out = join(SPRITES, `${dex}${POSE_FILE[pose]}.png`);
  process.stdout.write(`  ${species} ${pose} ... `);
  const png = await gen({ prompt: POSE_PROMPT[pose], refPath: ref });
  writeFileSync(out, png);
  console.log(`saved ${out.split('/').pop()} (${(png.length / 1024).toFixed(0)}KB)`);
}

// ——— CLI ———
const [cmd, arg, arg2] = process.argv.slice(2);
mkdirSync(SPRITES, { recursive: true });

try {
  if (!cmd || cmd === 'help') {
    console.log('Usage: node tools/gen-sprites.mjs <species|all|poses <sp> <pose>|arena|portrait <sp>>');
  } else if (cmd === 'arena') {
    process.stdout.write('arena ... ');
    const png = await gen({ prompt: ARENA_PROMPT, size: '1536x1024', transparent: false });
    writeFileSync(join(SPRITES, 'arena_bg.png'), png);
    console.log('saved arena_bg.png');
  } else if (cmd === 'portrait') {
    const { dex, ref } = refFor(arg);
    process.stdout.write(`portrait ${arg} ... `);
    const png = await gen({ prompt: PORTRAIT_PROMPT(arg), refPath: ref });
    writeFileSync(join(SPRITES, `${dex}_portrait.png`), png);
    console.log(`saved ${dex}_portrait.png`);
  } else if (cmd === 'poses') {
    await genPose(arg, arg2);
  } else if (cmd === 'all') {
    for (const sp of Object.keys(DEX)) for (const pose of ['idle', 'attack', 'hurt']) await genPose(sp, pose);
  } else {
    // a single species id -> all three poses
    for (const pose of ['idle', 'attack', 'hurt']) await genPose(cmd, pose);
  }
  console.log('Done.');
} catch (e) {
  console.error('\nERROR:', e.message);
  process.exit(1);
}
