# AI Sprites — Definition of Done (goal-loop target)

Drive the AI sprite/asset pipeline to completion. Same loop protocol as
ACTION_BATTLE_GOAL.md: pick the first unchecked gate, do it, verify, check it off,
commit. This file is the durable source of truth across loop iterations.

## Loop protocol (read every iteration)
1. Pick the first unchecked `- [ ]`. If marked 🧑, STOP and ask the human.
2. Run the generator with the key in `tools/.env` (gitignored):
   `node tools/gen-sprites.mjs <species|all|poses <sp> <pose>|arena|portrait <sp>>`.
   NEVER print, echo, cat, or commit `tools/.env` or the key value.
3. Verify each gate LIVE: the game is on http://localhost:5199/ (tab in the MCP group).
   Reload it, trigger the relevant screen, screenshot, and judge with vision
   (recognizable creature? transparent bg, no box/fringe? reads as the right pose?).
4. **Cost awareness:** every image spends the user's API money. Generate deliberately;
   do NOT regenerate a frame that's already acceptable. If a call errors, fix the tool's
   API request from the error message — do not loop blindly burning credits.
5. Commit generated PNGs (they're game assets) — but confirm `tools/.env` is NOT staged.
6. EXIT when every gate in A–F is `- [x]`.

## A. Key + connectivity
- [ ] `tools/.env` has a key; `node tools/gen-sprites.mjs poses charmander idle` saves one image without error. If it throws, patch the tool's API call from the error, then retry once.

## B. Validate Charmander first (cheap — 3 images)
- [ ] generate charmander idle/atk/hurt; reload a Charmander battle; screenshot — frames are recognizably Charmander, transparent background (no box/halo), and read as idle / attacking / flinching.
- [ ] 🧑 TASTE CHECKPOINT: show the user the Charmander result; get a thumbs-up on the look (and any prompt tweaks) BEFORE spending on the full roster.

## C. Full roster (only after the checkpoint passes)
- [ ] generate all 13 species idle/atk/hurt (`node tools/gen-sprites.mjs all`)
- [ ] spot-check 3–4 species live: poses swap with state, identity holds, no transparency fringe

## D. Arena backdrop + boss portraits
- [ ] generate `arena_bg` (`... arena`); wire into `render.ts` `bakeArena()` (draw the image under the existing bloom/vignette), fallback to the procedural arena if the file is missing
- [ ] generate portraits for the marquee bosses (at least onix + geodude); wire into the intro-card block in `render.ts` `drawPost`, fallback to no portrait if missing

## E. Verify live
- [ ] one full battle: poses animate with state, arena backdrop shows, portrait shows on the intro card, NO console errors; capture a screenshot for the record

## F. Ship
- [ ] commit the generated PNGs + the arena/portrait render wiring; push. Re-confirm `tools/.env` is not in the commit (`git status` clean of it).

## DONE WHEN
A–F all `- [x]`; a battle screenshot showing the AI poses + arena is recorded; changes pushed; `tools/.env` still untracked/ignored.
