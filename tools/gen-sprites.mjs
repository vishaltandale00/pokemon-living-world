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

// Load tools/.env (gitignored) if present, so the key never needs to be exported
// or pasted into a command. Existing process.env wins.
(function loadEnv() {
  const envPath = join(HERE, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

// speciesId -> national dex (matches public/sprites/<dexId>.png). Kept in sync with src/world/monsters.ts.
const DEX = {
  charmander: 4, squirtle: 7, bulbasaur: 1, pikachu: 25, geodude: 74, onix: 95,
  gastly: 92, rattata: 19, pidgey: 16, houndour: 228, lapras: 131, dratini: 147, lugia: 249,
};

// ——— provider ———
// OpenAI/Gemini are CLOSED and IP-moderate recognizable Pokémon (they block action poses).
// Replicate/fal run open FLUX.1 Kontext (an EDIT model) with no IP filter — preferred.
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
const FAL_KEY = process.env.FAL_KEY || process.env.FAL_API_KEY;
const PROVIDER = process.env.IMAGE_PROVIDER
  || (REPLICATE_TOKEN ? 'replicate' : FAL_KEY ? 'fal' : OPENAI_KEY ? 'openai' : GEMINI_KEY ? 'gemini' : null);
if (!PROVIDER) {
  console.error('No API key found. For recognizable Pokémon use REPLICATE_API_TOKEN or FAL_KEY (open FLUX Kontext, no IP filter). OPENAI_API_KEY / GEMINI_API_KEY also work but block action poses.');
  process.exit(1);
}
const OPENAI_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const GEMINI_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const REPLICATE_MODEL = process.env.REPLICATE_MODEL || 'black-forest-labs/flux-kontext-dev';
const FAL_MODEL = process.env.FAL_MODEL || 'fal-ai/flux-kontext/dev';
const MODEL_LABEL = { openai: OPENAI_MODEL, gemini: GEMINI_MODEL, replicate: REPLICATE_MODEL, fal: FAL_MODEL }[PROVIDER];
console.log(`Provider: ${PROVIDER} (${MODEL_LABEL})`);

// ——— prompt library ———
const STYLE = 'Keep the SAME creature — identical species, colors, proportions and shapes. Full body, centered, facing right, clean crisp edges, soft rim light, no ground shadow, no background, fully transparent background. Dynamic, expressive, high-energy action-game creature art that reads at a glance.';
// NOTE: poses are worded to avoid content-moderation false positives — combat words
// ("attack", "strike", "hit", "flinch") can trip the safety filter even for a cartoon.
const POSE_PROMPT = {
  idle: `Redraw this creature in an alert ready idle stance, weight low, looking forward. ${STYLE}`,
  attack: `Redraw this creature in a lively mid-jump: both feet off the ground, leaping happily up and forward, arms raised with excitement, a joyful energetic expression. ${STYLE}`,
  hurt: `Redraw this creature with a surprised wide-eyed expression, gently leaning back and tilting its head in astonishment, a little off balance. ${STYLE}`,
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

// FLUX.1 Kontext on Replicate — open edit model, no IP filter (safety checker = NSFW-only, disabled here)
async function genReplicate({ prompt, refPath }) {
  const input = { prompt, output_format: 'png', disable_safety_checker: true };
  if (refPath) { input.input_image = `data:image/png;base64,${readFileSync(refPath).toString('base64')}`; input.aspect_ratio = 'match_input_image'; }
  const res = await fetch(`https://api.replicate.com/v1/models/${REPLICATE_MODEL}/predictions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REPLICATE_TOKEN}`, 'Content-Type': 'application/json', Prefer: 'wait' },
    body: JSON.stringify({ input }),
  });
  let pred = await res.json();
  if (!res.ok) throw new Error(`Replicate ${res.status}: ${JSON.stringify(pred).slice(0, 400)}`);
  while (pred.status && pred.status !== 'succeeded' && pred.status !== 'failed' && pred.status !== 'canceled') {
    await new Promise(r => setTimeout(r, 1500));
    pred = await (await fetch(pred.urls.get, { headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` } })).json();
  }
  if (pred.status !== 'succeeded') throw new Error(`Replicate ${pred.status}: ${pred.error || ''}`);
  const out = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  return Buffer.from(await (await fetch(out)).arrayBuffer());
}

// FLUX.1 Kontext on fal.ai — same open model
async function genFal({ prompt, refPath }) {
  const body = { prompt, enable_safety_checker: false, output_format: 'png' };
  if (refPath) body.image_url = `data:image/png;base64,${readFileSync(refPath).toString('base64')}`;
  const res = await fetch(`https://fal.run/${FAL_MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`fal ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  const url = json.images?.[0]?.url || json.image?.url;
  if (!url) throw new Error(`fal: no image in response: ${JSON.stringify(json).slice(0, 400)}`);
  return Buffer.from(await (await fetch(url)).arrayBuffer());
}

async function gen(opts) {
  switch (PROVIDER) {
    case 'replicate': return genReplicate(opts);
    case 'fal': return genFal(opts);
    case 'gemini': return genGemini(opts);
    default: return genOpenAI(opts);
  }
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
