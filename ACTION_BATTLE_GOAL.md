# Action Battle — Definition of Done (goal-loop target)

This file is the **machine-checkable contract** for "the action-battle product is ready."
A `/loop` reads it every iteration (context resets between iterations, so this file —
not memory — is the source of truth).

## Loop protocol (read me every iteration)
1. Pick the **first unchecked `- [ ]`** gate, preferring smallest blast radius.
2. If it is marked 🧑 and the decision is unresolved (see "Decisions"), **STOP and ask the human** — do not guess.
3. Implement it. Keep edits surgical; match surrounding style.
4. **Verify** with that gate's stated check. A gate may only be checked `- [x]` when its check passes.
5. `git add -A && git commit` with a one-line message; continue to the next gate.
6. **EXIT** when every gate in A–F is `- [x]` AND the "DONE WHEN" block passes.

Global verify (must stay green the whole time):
- `npx tsc --noEmit` → no errors
- `npx vite build` → succeeds
- headless sim `/tmp/abtest/driver.cjs` → all matchups terminate, passive player still dies, no NaN/∞

Browser QA harness: `npm run dev` (Vite default port 5173 unless overridden — read the
dev-server startup line for the actual URL), drive WorldScene via `window.dispatchEvent`
(see browse-skill memory), inspect `world.state` + console + network via claude-in-chrome.
If the browser extension is unavailable, mark the gate `- [ ] (BLOCKED: needs live browser)` and continue with auto gates.

---

## A. Safety / correctness  (auto: tsc+build+code review)
- [x] `ended`-guard added between `handleRequests()` and `handlePhase()` in ActionBattleScene.update
- [x] empty-NPC-party guard in `create()` (no `SPECIES[undefined]` crash) — early no-op finish
- [x] SHUTDOWN registered BEFORE any throwable work in `create()`; overlay can never orphan
- [x] `cleanup()` is idempotent (`if (this.cleaned) return;`) and calls WorldScene `resetKeys()` on exit
- [x] every damage source routes through `resolveHit()` / respects `winT` guard (no new bypass)

## B. Live verification  (browser QA, port 5199)
- [ ] wild fight (walk into tall grass): overlay mounts, world freezes, **both sprites render** (not blobs), no `/sprites/*.png` 404, no console throw in `create()`
- [ ] trainer fight launches the same way
- [ ] resume → `{battleResult}` banner shows, map + player sprite re-sync, overlay canvas removed from DOM
- [ ] gym win (giovanni/brock): badge banner + story toast fires; `world.state.player.flags['badge_*']` set
- [ ] ESC does NOT open `#settings-overlay` mid-battle (wild + trainer)
- [ ] no ghost-walk / inert battle keys in world after win/flee/blackout while holding WASD
- [ ] multi-mon gym: KO mon 1 → phase returns to fighting, new boss sprite swaps, win only after last mon
- [ ] catch success adds to party (+ ball decrement, party-full / no-ball guards); flee works; blackout heals + relocates to town AND applies the D4 penalty (`max(50, floor(money*0.15))`)
- [ ] damaged lead enters at real HP and returns chipped; fainted mon reads 0

## C. Player-facing gaps
- [x] HUD shows `· C catch · F flee` hint during wild fights (render.ts)
- [x] specials scale with owner level/atk (not flat `power*0.5`) so type advantage stays relevant past ~Lv10
- [x] (D2) give each mon 2–3 action specials derived in the kit; every advertised U/I/O bind is live
- [x] single-hit damage cap / last-stand-at-1 so a frail mon can't be one-shot by an over-leveled boss
- [ ] (D1) heal action bound to a key that spends a Potion via a vulnerable channel (party-empty / no-potion guards)

## D. Balance & feel
- [ ] time-to-kill normalized: skilled-bot sim kills any role-appropriate boss within a target band (~10–25s / ~8–22 hits) across all 13 species
- [ ] boss HP + damage couple to the player↔boss level gap (not just the opponent's own stats)
- [ ] stat→action clamps don't saturate by ~Lv30 (species still feel distinct late game)
- [ ] per-frame bloom / full-window blit holds ~60fps on a retina display (profile; cheapen bloom or cap present DPR if not)

## E. Scope / PLAN
- [ ] authored per-boss move kits: at minimum Brock ≠ Giovanni ≠ generic (PLAN's "learnable pattern table per boss")
- [ ] (D3) action-only: delete `BattleScene.ts`, drop its import + scene registration in main.ts, route nothing to 'battle'
- [ ] intro card shows boss role + level and holds long enough to read; level-ups pulse in-arena (not only post-fight banner)

## F. Cleanup / parity
- [ ] old `BattleScene.ts` retired: deleted, or refactored to call `battleOutcome` helpers so it can't silently diverge (and stale comments fixed)
- [x] trainer-fight flee shows "can't run from a trainer!" feedback (parity with old)

---

## 🧑 Decisions — RESOLVED (do not re-ask)
- **D1 = heal action that consumes a Potion** (vulnerable channel; bind a key). Keep item economy.
- **D2 = give 2–3 action specials per mon**, derived in the kit WITHOUT changing the world's move data.
- **D3 = action-only**; delete the menu BattleScene (no accessibility toggle).
- **D4 = real money penalty on ALL losses incl. trainer + gym** (restore old blackout: `max(50, floor(money*0.15))` + relocate + heal). NOTE: this reverses the "zero penalty" code currently in `battleOutcome.ts` and overrides PLAN.md's no-penalty note.

## DONE WHEN
All gates in A–F are `- [x]`; `tsc` + `build` green; one clean end-to-end browser playthrough
covering a wild fight AND a gym fight (with screenshots/GIF) recorded in `experiments/soulslike-battle/`;
changes committed and pushed.
