# Living Kanto — an LLM-directed Pokémon-style living world

A 2D top-down monster-trainer game where **nothing about the story is hardcoded**.
An LLM acts as Dungeon Master: it writes every NPC's dialogue, decides daily world
developments, opens career paths based on your behavior, and even decides when
buildings get built, damaged, or ruined.

## Run

```bash
npm install
npm run dev          # → http://localhost:5173
```

Press **ESC** in-game → paste your OpenAI (or any OpenAI-compatible) API key,
set the model (e.g. `gpt-5.5`), Test Connection, Save. Without a key the game
falls back to a rule-based engine — playable, just less alive.

## Controls

| Key | Action |
|---|---|
| Arrows / WASD | Move |
| SPACE | Talk to adjacent NPC / advance |
| 1–3 | Pick dialogue choice / battle move |
| C | Catch (wild battles) |
| R | Run (wild battles) |
| T | End the day (world tick — the world moves overnight) |
| J | World journal (event history) |
| ESC | Settings |

## Architecture

```
PRESENTATION   Phaser 3, procedural tiles/sprites (zero asset files)
SIMULATION     src/world/store.ts — source of truth, validates ALL mutations
LLM DIRECTOR   src/llm/director.ts — daily world tick, proposes developments
LLM DIALOGUE   src/llm/dialogue.ts — NPCs speak grounded in real world history
```

Key design decisions:

- **Roles are slots, not story flags** (`src/world/types.ts` → `RoleSlot`).
  Gym Leader, Champion, Rocket Boss, Head Ranger are positions in the world with
  acquisition requirements (reputation, badges, defeat-the-holder, invitation).
  Beat Marshal Vance with enough League rep → the Verdane gym is yours.
- **Multi-axis reputation** (League / Rocket / Civic / Research) — every dialogue
  choice and battle nudges it. The director reads it and reacts: help Rocket and
  they court you; rack up badges and the League notices.
- **Append-only event log** — every fact (battles, role changes, construction)
  is logged. NPC dialogue retrieves recent history, so the innkeeper genuinely
  knows what you did last week.
- **The LLM proposes, the sim disposes** — director output is JSON-schema
  constrained and every development is validated/clamped before being applied.
  Invalid proposals are silently dropped. The game never breaks on a bad
  generation, and never blocks on the network (fallback heuristics everywhere).
- **Maps are generated from world state** — terrain is a seeded base layer, but
  buildings come from a registry the director mutates. New construction
  physically appears; ruined buildings render as rubble.

## Status / next steps

Vertical slice: 2 towns + 1 route, 9 NPCs, 5 power slots, 11 species, battles,
catching, day ticks. Natural next steps:

- Streamed dialogue (token-by-token) + free-text player input alongside choices
- NPC daily movement/schedules driven by the director
- More region graph (towns as data — scaling is content, not architecture)
- Persistent NPC memories (per-NPC event digests)
- Legendary encounter logic for the legend_hunter path
