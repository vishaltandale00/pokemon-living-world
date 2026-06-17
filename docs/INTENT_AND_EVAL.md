# Living Kanto — Intent Charter & Derived Eval Rubric

*Foundation document for the eval-driven, workflow-orchestrated improvement loop. Symbols below verified against the live tree at `/Users/vishaltandale/ProjectsDev/pokemon-living-world` on 2026-06-17.*

---

## Intent Charter

**What this game is.** Living Kanto is a top-down, FRLG-faithful monster-trainer game whose story is *not* hardcoded: an OpenAI-compatible LLM Director writes every NPC's dialogue, decides what changes in the world overnight, and opens career paths out of the player's actual behavior — while a hand-authored 5-chapter spine (`src/world/story.ts`: `boulder_badge → the_warehouse → bust_rocket → viridian_secret → champion`) keeps that emergent world coherent so it never "feels super random." Identity is emergent: roles (Trainer / Gym Leader / Champion / Rocket Boss / Head Ranger) are **slots** in the world acquired by satisfying real requirements (badges, reputation, defeating the holder, invitation), not story booleans. Four reputation axes — **League / Rocket / Civic / Research** — are the world's memory of who you are; choices and battles nudge them, and the Director reads them and reacts. A daily TICK moves the world on its own — factions scheme, leaders tire, buildings rise and fall — and an append-only event log means "everyone remembers what you do." The bar is a game that feels like a *real* Pokémon game and is *genuinely alive*: not maximal randomness, but causal, on-thread evolution that traces back to the player.

**Hard non-negotiables** (these are pass/fail gates, never traded off):

1. **Deterministic sim is the source of truth.** Every mutation goes through `WorldStore` (`src/world/store.ts`), which validates, clamps, and logs it. Verified clamps: rep ±/0..100 (store.ts:69), town meters ±15 then 0..100 (store.ts:139-140), director attitude ±25 (store.ts:147), developments sliced to first 4 (store.ts:117), event log capped at 400 (store.ts:58).
2. **The LLM proposes, the sim disposes.** Director output is JSON-schema-constrained (`director.ts:20`); every development is validated/clamped before apply; **invalid proposals are silently dropped** (store.ts:121) — a bad generation never breaks the game.
3. **Offline authored fallback always works.** No API key → `heuristicTick` (director.ts:143) advances the *same* current chapter deterministically (`s.day % arr.length`) and fires alternate-path offers at thresholds; authored branching dialogue (`src/world/dialogueContent.ts`) covers every NPC. The game never blocks on the network — "playable, just less alive."
4. **Real-Pokémon feel is a hard bar.** Production battle (`src/game/BattleScene.ts`): HP/faint tweens, party switching (lose only when ALL faint), items consume a turn, XP/level-up, real blackout, per-species catch rate, no one-shots, bosses hard-but-winnable. On a `defeatHolder` win it sets `npc.defeated`, `flags['beat_'+id]`/`flags['badge_'+id]`, and calls `claimSlot(slot.id, true)` (BattleScene.ts:290-312) — the battle→flag→claim bridge is live.

---

## The Eval Rubric

Scoring conventions: **OBJECTIVE** items are computed mechanically from `world.state` / `world.recentEvents()` / generated-text structure and are pass/fail or a measured number. **JUDGE** items are LLM-as-judge on a 1-5 scale, averaged across the scenario matrix. Every item names its data source. Run **both** dialogue engines where relevant (LLM path `npcDialogue` requires `hasKey()`; authored path `authoredDialogue` is the default) and report them separately — most users see the authored path.

### Pillar 1 — TALKING (dialogue quality)

| # | Type | Measures | Target | Data source |
|---|------|----------|--------|-------------|
| T1 | **OBJECTIVE** | Text-box discipline: `npcLine` ≤200 chars AND ≤35 words; every `choices[].label` ≤64 chars AND ≤8 words (the word-count bound on labels is currently *unenforced* in code — assert it) | 100% | Generated `DialogueTurn.npcLine` / `.choices[].label` (clip at dialogue.ts:110, 99) |
| T2 | **OBJECTIVE** | No assistant-speak: `npcLine` does not start with / contain "As an AI", "I can help", "I'm an assistant", "language model" | 100% | Generated `npcLine` |
| T3 | **OBJECTIVE** | Post-defeat acknowledgement: when `npc.defeated===true` ("DEFEATED you in battle today", dialogue.ts:68), opening line contains a loss/win token ("beaten/defeated/lost/won") | 100% on defeated NPCs | `npc.defeated`, generated `npcLine` |
| T4 | **JUDGE** | World-grounding: on a world seeded with ~10 `runWorldTick()`s, does the line reference a *specific* recent world fact (a rumor substring, a proper noun from `recentEvents(20)`, the player's literal badge count/role) vs generic flavor? 1=generic … 5=names a concrete recent event | ≥3.5 avg (LLM path); report authored path separately (expected low) | `world.state.rumors`, `recentEvents(20)`, generated `npcLine` |
| T5 | **JUDGE** | In-character fidelity: given `npc.personality` + `npcLine`, "does this sound like THIS character, not a generic NPC?" | ≥4.0 avg | `npc.personality` (seed.ts), generated `npcLine` |
| T6 | **JUDGE** | Attitude-colored tone (A/B): regenerate same NPC opening at `attitude=-80` vs `+80`, all else fixed; is hostile reliably colder than devoted? | ≥4.0 separation reliability; OBJECTIVE backstop: sentiment delta > 0 | `npc.attitude`, two generated `npcLine`s |

### Pillar 2 — CHOOSING (meaningful, consequential choices)

| # | Type | Measures | Target | Data source |
|---|------|----------|--------|-------------|
| C1 | **OBJECTIVE** | Real, varied effects: ≥ of non-leave choices have a non-trivial `repEffects`/`attitudeDelta`/`startsBattle`/`acceptsOffer`; flag any turn where all non-leave choices share an identical effect vector (a "fake choice") | ≥80% effectful; 0 all-identical turns | `DialogueChoice` effect fields (dialogueContent.ts:12-18 / dialogue.ts:98-105) |
| C2 | **OBJECTIVE** | Observable next-conversation consequence: snapshot `npc.attitude`+`player.reputation`, apply a choice with non-zero delta, re-open dialogue; assert stored values moved by exactly the applied delta AND `openingSig` changed (cache invalidated) | 100% | `npc.attitude`, `player.reputation`, `openingSig` (dialogueCache.ts:29) |
| C3 | **OBJECTIVE** | Choice→rep→world-reaction chain: drive `rocket≥20` via choices, `runWorldTick()`, assert a `rocket_boss` `role_offer` appears in `pendingOffers` (director.ts:206); symmetrically drive `research≥30 && civic≥20` → `head_ranger` offer (director.ts:216) | Both fire at threshold, neither fires below | `player.reputation`, `pendingOffers`, event log |
| C4 | **OBJECTIVE** | Offer integrity: when a choice sets `acceptsOffer` on a `defeatHolder` slot the player doesn't hold, the game routes to battle / rejects with a `missing[]` reason rather than silently granting | 100% | `claimSlot` result (store.ts:77-98), `WorldScene.pickChoice` (561-572) |
| C5 | **JUDGE** | Effect/label coherence + non-domination: (a) does each choice's effect *direction* match its label sentiment (a "criminal" label must not grant +civic)? (b) do the criminal and civic paths each feel like real doors, not a token dead-end? | ≥4.0 avg | `DialogueChoice.label` + effects, generated turn |

### Pillar 3 — WORLD EVOLVING (the living-world director)

| # | Type | Measures | Target | Data source |
|---|------|----------|--------|-------------|
| W1 | **OBJECTIVE** | Anti-random divergence: two identical worlds, opposite player acts (helped Rocket vs busted Archer); after 14 ticks assert `pewter.rocketInfluence` diverges ≥15 points, correctly signed | divergence ≥15 and correctly signed | `towns[].rocketInfluence`/`prosperity` diff |
| W2 | **OBJECTIVE** | Structural change rate: count `building_change`(build/ruin) + `vacate_slot` + new `role_offer` over the run; pure meter-nudges don't count | ≥1 structural change per 7 ticks, each reflected in `buildings[].condition`/`slots[].holder` + event log | `buildings`, `slots`, event log |
| W3 | **OBJECTIVE** | Two-sided liveness bound: (a) every tick emits ≥1 headline; (b) no town meter swings >15 in one tick (assert the clamp holds against an adversarial proposal of ±40); (c) no NPC slot flips twice in 3 ticks | 100% ticks have ≥1 headline AND 0 clamp violations AND 0 rapid thrash | event log, town meters, `slots[].holder` history |
| W4 | **JUDGE** | Continuity / "next beat": for each tick judge each new rumor against prior rumors+events — can the judge name which prior event/rumor it advances? | ≥75% continuous, <10% topically unrelated to active chapter | `rumors` (per day), `recentEvents()`, `currentChapter` |
| W5 | **JUDGE** | On-thread escalation: tag each `Development` with the chapter it serves; what fraction touches the active chapter's town/NPCs/slot? | ≥90% on-thread, ≤1 in 10 introduces an unrelated town/NPC | proposed `Development`s, `currentChapter` (story.ts) |

### Pillar 4 — CHARACTERS EVOLVING (attitudes/relationships shifting from what the player does)

| # | Type | Measures | Target | Data source |
|---|------|----------|--------|-------------|
| X1 | **OBJECTIVE** | Persistent correctly-signed swing: complete `the_warehouse` (`rosa.attitude += 15`, story.ts:51) — assert ≥+15 immediately AND still elevated after 3 `runWorldTick()`s; mirror hostile path (`archer.attitude` trends down, director.ts heuristic) | correct sign 100%; magnitude ≥15 for story payoffs; no silent cross-day reset | `npcs[].attitude` over multiple ticks |
| X2 | **OBJECTIVE** | Relationship gates opportunity: a `rocket≥20` player gets a `rocket_boss` offer from a Rocket NPC; a `research≥30 && civic≥20` player gets `head_ranger` from `ranger_iva`; accepting via `acceptsOffer` flips `slots[id].holder` to `'player'` | both alternate paths fire at threshold, not below; claim succeeds | `reputation`, `pendingOffers`, `slots[].holder`, `claimSlot` |
| X3 | **OBJECTIVE** | Cache invalidation on relationship change: after attitude/rep change, `openingSig` differs so the NPC re-greets (no stale cached line) | 100% | `openingSig` (dialogueCache.ts:29-47) before/after |
| X4 | **JUDGE** | References the specific deed: after busting Archer, re-open Rosa across the next 1-3 days — does the opening line name the player's action, not just warmer tone? | ≥70% name the deed; ≥90% at least match the new attitude valence | `recentEvents(20)`, generated `npcLine` |
| X5 | **JUDGE** | Tone monotonic over attitude bands + no amnesia: (a) vary one NPC's attitude across {-60, 0, +60}, judge warmth — monotonic non-decreasing? (b) over a multi-day help→tick→talk arc, flag any line contradicting established relationship | (a) monotonic for ≥90% of NPCs; (b) <5% contradiction rate | `npc.attitude`, generated `npcLine`s across days |

---

## Weighting & Pass Bar

**Pillar weights** (equal headline weight — the four pillars are the owner's stated objective function):

- Talking 25% · Choosing 25% · World-evolving 25% · Characters-evolving 25%.

**Within-pillar:** OBJECTIVE items collectively carry 60% of a pillar's score, JUDGE items 40% — the living-world promise must be *mechanically true* before it's *judged good*. Within each band, items are weighted equally; normalize JUDGE 1-5 scores to 0-1 as `(score-1)/4`.

**Non-negotiable gates (override the weighted score — any failure = run fails regardless of total):**

- **G-SIM**: zero clamp/validation violations (W3b, the store.ts clamps) — the "sim validates the LLM" contract.
- **G-FALLBACK**: with `hasKey()` mocked false, the keyless path completes the spine and emits ≥1 headline/tick (W3a) — "never blocks on network."
- **G-INTEGRITY**: offer/claim integrity holds (C4) — no under-qualified silent role grant.

**"Goal achieved" stop condition** the orchestrating workflow halts on:

> **Overall weighted score ≥ 0.80** *(0.55 the realistic v1 baseline)* **AND no pillar below 0.65 AND zero OBJECTIVE-item failures AND all three non-negotiable gates green.**

Report the LLM-path and authored-path sub-scores separately; the overall uses the **LLM path** for grounding-dependent items (T4, X4) and the **authored path** for the keyless-completability gates, so the bar can't be gamed by passing only the path with a key.

---

## Scenario Coverage

The matrix must exercise all four pillars including the multi-tick character-evolution cases. All scenarios are headless: stub `chatJSON` (`src/llm/client.ts`) to replay recorded/adversarial JSON for determinism, run a real-key suite for JUDGE items, and seed a "lived-in" world by calling `runWorldTick()` ~10× before grounding tests.

1. **S1 — Fresh seed, civic/League run.** Default seed → max-nice dialogue with Brock, Rosa, Blue → battle Brock (assert `badge_brock`, `npc.defeated`, gym slot claim via BattleScene bridge). Exercises T1-T6, C1-C2, X1. Anchor for the champion spine.
2. **S2 — Rocket-aligned run.** Choose pro-Rocket options to drive `rocket≥20` → `runWorldTick()` → assert `rocket_boss` offer (C3, X2); verify Archer attitude trends down (X1 hostile mirror) and Rocket NPCs court the player (W1 helped-Rocket arm).
3. **S3 — Research/Civic ranger run.** Kindness to Ranger Iva → drive `research≥30 && civic≥20` → assert `head_ranger` offer and claim (C3, X2, branch non-domination C5/X2c).
4. **S4 — Lived-in world (10+ ticks) grounding.** Run S1 actions, then 10 ticks, then re-open every marquee NPC — scores T4 (world-grounding), X4 (deed reference), W4 (continuity), W5 (on-thread).
5. **S5 — Anti-random divergence pair.** Two clones from one save, opposite acts, 14 ticks each — W1 divergence test. Run on the deterministic heuristic path for reproducibility, sample LLM path for W4/W5.
6. **S6 — Adversarial Director.** Feed proposals exceeding every clamp (±40 meters, ±50 attitude, 8 developments, `vacate_slot` on a spine-critical holder, malformed ids) — asserts G-SIM, W3, and that the active chapter's `done` predicate path is never broken (spine-safety).
7. **S7 — Keyless full playthrough.** `hasKey()` false end-to-end: drive the spine via heuristic ticks to `champion` — asserts G-FALLBACK, keyless completability, and the authored-path sub-scores for T/C/X (expected to expose the authored-attitude gap).
8. **S8 — Multi-day relationship arc.** help → tick → talk → help again → tick → talk with one NPC — X5 monotonicity + no-amnesia, and X1 persistence-across-ticks.
9. **S9 — Attitude-band sweep.** One NPC at attitude {-60, 0, +60}, world fixed — T6 / X5a tone monotonicity, confirms `openingSig` regenerates each (X3).

---

## Current-State Gaps (the hill to climb)

Where today's game scores low against this rubric, in priority order:

1. **Authored (keyless) path barely references history → T4/X4 fail on the default build.** Named `TREES` in `dialogueContent.ts` largely ignore `npc.attitude` (only `generic()` and Sal's trust gate use it) and almost never cite the event log (only `generic` reads `rumors[0]`). So "the world remembers you" is essentially an *LLM-only* feature, despite the seed/spine being built to run keyless. **Biggest single lever.**
2. **`npc.personality` never mutates → X5 stretch goal unmet.** Confirmed: zero writes to `.personality` anywhere in `src/`. Characters' *tone* shifts with attitude, but their *character/goals* never evolve. Pillar 4's deepest form ("characters evolving," not just "attitudes nudging") is unimplemented.
3. **LLM Director has no progress guarantees → W-completability and G4 risk.** `heuristicTick` actively pushes a stuck player (+6 league/night, director.ts:191) and re-issues offers; the LLM path has none of this and may emit flavor while ignoring the player — so the game can be *more reliably completable WITHOUT a key than with one*, inverting the LLM's intended value. Eval S5/S7 will surface this.
4. **Reputation has thin headroom for non-story gates → C3/X2 fragile.** Dialogue `repEffects` clamp to ±5 (usually +1/+2); `rocket_boss` *requires* `rocket:60` but the heuristic *offer* fires at `rocket≥20` — reaching the actual 60 gate to claim is hard. Alternate endings are reachable mainly via the fallback's auto-offers, not organic LLM play.
5. **Per-NPC memory is just the shared 20-event window → X4 decays.** No memory pinned to a specific relationship; an old help event referenced only because it's still in `recentEvents(20)`, and falls out after ~20 events.
6. **Offer expiry can silently kill a near-complete branch under the LLM (C3/X2 edge).** Offers expire in 5 days (store.ts:158); the heuristic re-issues, the LLM has no re-issue guarantee.
7. **Spine-safety not enforced (S6/W-spine).** `vacate_slot` validation blocks `holder==='player'` but not a narrative-critical NPC the active chapter still needs.
8. **Note — G1/G2 are now mostly RESOLVED in the live tree** (corrects the systems-intent facet): the battle→flag→claim bridge exists (`BattleScene.ts:290-312`) and gym slots *are* auto-claimed on a `defeatHolder` win. The eval's role here shifts from "is it missing?" to **regression-guarding that it stays wired** (covered by S1, C4).

---

## How the Goal-Workflow Orchestrates

The eval is the objective function of a closed improvement loop the orchestrator runs autonomously:

1. **Understand intent** — load this charter; the four pillars + non-negotiable gates are fixed targets.
2. **Derive / refresh eval** — re-confirm load-bearing symbols against the live tree (clamps, thresholds, the `claimSlot` bridge — they drift; this doc already corrected one stale claim) before each baseline so OBJECTIVE checks reference real code.
3. **Measure baseline** — spin up parallel headless game instances; stub `chatJSON` for deterministic OBJECTIVE runs and use a real key for JUDGE runs; execute the S1-S9 matrix; compute per-item OBJECTIVE results and per-item JUDGE 1-5 averages; roll up to the weighted score with gates applied. Record LLM-path and authored-path sub-scores.
4. **Identify weakest items** — rank by `weight × (target − actual)`, with any failed gate or OBJECTIVE failure pulled to the top regardless of weight. (v1 expectation: authored-path grounding T4/X4 and the `personality` X5 gap lead.)
5. **Propose + apply targeted change** — make the smallest change that lifts the weakest item without regressing a gate (e.g. thread event-log references into the authored `TREES`; add LLM-Director progress guarantees mirroring the heuristic; add a `personality`-drift mutation path). One lever at a time so attribution is clean.
6. **Re-measure** — re-run the full matrix (not just the touched scenario) to catch regressions in other pillars and gates.
7. **Keep-if-it-climbs** — accept the change only if the overall weighted score rises AND no pillar dropped below its floor AND no gate flipped red; otherwise revert.
8. **Stop at the pass bar** — halt when **overall ≥0.80 AND no pillar <0.65 AND zero OBJECTIVE failures AND all three gates green**; otherwise loop to step 4 on the next-weakest item.

**Relevant files** (verified): `/Users/vishaltandale/ProjectsDev/pokemon-living-world/src/world/store.ts`, `/src/world/story.ts`, `/src/world/types.ts`, `/src/world/seed.ts`, `/src/world/dialogueContent.ts`, `/src/llm/director.ts`, `/src/llm/dialogue.ts`, `/src/llm/dialogueCache.ts`, `/src/llm/client.ts`, `/src/game/WorldScene.ts`, `/src/game/BattleScene.ts`.