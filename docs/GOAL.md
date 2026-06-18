# GOAL — Build the Emergent Identity Engine for Living Kanto

> This is the driving directive for an eval-driven, autonomous build. It is self-contained:
> everything needed to build the full system is here. Do not stop until the Definition of Done
> is met. Build it *right the first time* — the hard design work is done; the traps are mapped.

---

## 1. Mission

Build a **generative** Pokémon-style game where a **fixed kernel** runs every playthrough and an
**LLM-authored language** makes two playthroughs diverge *completely*. The player is fully
autonomous — trainer→champion, Rocket grunt→boss, found a brand-new rival gang, ranger, or
something nobody coded — with goals entered through a **journal** and **free-text questions** in
dialogue. Towns, factions, rivalries, and institutions are **not authored content and not goals**:
they **emerge as the accreting consequences of sustained player actions over many in-game days,
through visible intermediate states.** Same engine every time; the *content* is generated.

**The thesis you must prove:** run the same kernel over 5–10 different authored bundles and get
5–10 *structurally divergent* worlds — a settlement here, a gang-gripped region there, a nemesis
war elsewhere — each coherent, logical, persistent, and legible. Only the bundle differs; the
engine source is byte-identical across runs.

This work happens in the `emergent-engine` worktree. The determinism work (P0) also lands on `main`.

---

## 2. What you are building (LOCKED architecture)

Validated by a pressure-test against four divergent consequence-shapes (a place hardening, a
faction's reach spreading, a rivalry escalating, an unseen player-founded religion). Verdict:
**one accretion primitive + one closed operator set generalizes with NO per-shape special-casing.**

### 2.1 The Entity substrate
`Building` / `TownState` / `NPC` become **projections of a backing Entity registry keyed by id**:

```
Entity {
  id: string
  type: string                      // OPEN (e.g. 'location','faction','rivalry','religion','npc')
  tags: Set<string>                 // OPEN
  attrs: Map<string, number|string|boolean>   // OPEN
  magnitude: number                 // the single accretion channel
  relations: Edge[]                 // Edge = { to:id, rel:string(OPEN), weight:number }
  thresholds: Threshold[]           // Threshold = { channel:'magnitude'|<attrKey>, level, up:Effect[], down:Effect[] }
}
```

### 2.2 The closed vocabulary (the LLM writes fiction *over* this; never touches state directly)
- **Predicates (~12):** `magnitudeAtLeast` · `attrAtLeast` · `attrEquals` · `hasTag` ·
  `relationAtLeast` · `playerHasRole` · `playerRepAtLeast` · `playerControls` ·
  `controlledBy(e,faction)` *(faction = OPEN string)* · `daysSince(eventKey)>=n` ·
  `countMatching(predicate)>=n` · `exists(entityId)`
- **Effects (~9):** `addMagnitude` *(only way magnitude moves; capped)* · `addAttr` · `setAttr` ·
  `clampedRep` · `addRelation` · `setTag` · `clearTag` · `logEvent` · `retireEntity` *(soft-delete)*
- **Structural ops (5)** — the *only* way world geometry/topology changes; each self-validates or
  fails atomically: `placeBuildingValidly(locEntity, buildingKind, ownerFaction)` ·
  `wireConnection(locA, locB, kind)` · `createLocation(seedFromLocation, biome, tags)` ·
  `spawnEntity(type, tags, attrs, atLocation)` *(idempotent-by-id)* ·
  `transferControl(entity, toFaction)` *(toFaction = OPEN string, incl. synthetic `'player'`)*
- **Rule:** `{ id, when:<predicate tree>, forEach?:<predicate binding ONE matched entity>,
  then:<Effect[]>, throttle:<once per N days>, source:'kernel'|'authored' }`
- **Triggers (only 3):** `dayTick` · `onEnterLocation` · `onDialogueChoice`

### 2.3 The authored LANGUAGE layer
A per-playthrough **bundle** = entity-type defs + threshold tables + rules, written *purely* in the
closed vocabulary above, admitted via **propose-then-dispose** (validated before it can ever run).
The smart model authors/extends the bundle during the nightly world-load; the fast model handles
real-time dialogue.

### 2.4 Design rulings (locked)
- **Relationships are reified as carrier entities** (`type:'rivalry'`), **never** magnitude-on-edges.
  One accretion code path. Edges stay first-class for *direction/structure* only.
- **Consequences accrete; they are never minted.** A town/gang/feud is what it looks like when a
  chain of consequences has compounded far enough. There is no "found a town" action.

---

## 3. The kernel EXECUTION CONTRACT (non-negotiable — these are correctness, not style)

Adversarial review found three **fatal** flaws in a naive evaluator. The architecture survived;
the *evaluator's contract* is what must be exact. Build the tick engine to satisfy ALL of these or
the anti-cheat, termination, and determinism guarantees do not hold.

1. **The velocity cap is a property of the CHANNEL, not an effect.** Every numeric accretion channel
   (`magnitude`, any thresholded attr, reputation) is routed through ONE capped path with a per-day
   accumulator **shared across all three triggers** (so per-event triggers can't bypass the per-day
   budget). `setAttr` is **forbidden** on any channel that has a threshold table. *(Closes
   "cascade-mint": amplification can't route around magnitude through uncapped `addAttr`/`clampedRep`.)*
2. **Two-phase, snapshot-based tick.** Evaluate all rules against a **frozen snapshot** → collect
   threshold crossings → resolve their effect lists in a **separate bounded pass**, **at most one
   cross per channel per tick**; cross-entity bumps land but only take effect (re-capped) on the
   **next** tick. `forEach` iterates a **frozen match-set** captured before the pass. *(Guarantees
   termination AND kills same-tick cascades.)*
3. **Determinism is total.** Total order over the registry **by entity id** (lexicographic) for all
   iteration/`forEach`/`countMatching`/effect application. **Fixed-point integer** magnitude (store
   milli-units; no IEEE-754 straddle of a threshold `level`; strict `>=` up-cross, `<` down-cross).
   **Canonical save codec** (tags→sorted arrays, attrs→id/key-sorted entries; never raw `JSON` of a
   `Set`/`Map`; re-serialize-after-load must be byte-identical). **Kernel-reserved "retired" filter**
   excludes soft-deleted entities from ALL matching. **Per-op decoupled RNG**:
   `hash(globalSeed, opCallOrdinal, entityId)` so a skipped/conditional op can't desync later draws.
4. **Two post-tick GLOBAL invariants** (mirror how structural ops already self-validate):
   - **Protected set:** the entities/slots referenced by any *unsatisfied* story-chapter predicate.
     `retireEntity` / `transferControl` / `vacate_slot` **fail atomically** if their target is in it.
     *(No story softlock — and remember determinism would otherwise cement a softlock forever.)*
   - **Global reachability:** after any `placeBuildingValidly` / `createLocation` / `wireConnection`,
     run one BFS over all doors from the player's node; **reject the op** if any required node/door
     became unreachable. *(No spatial orphan or walling-in.)*

*(Deferred, optional fidelity niceties — only if needed later, never at the cost of the cap:
scoped `countMatching`, computed-delta effects for true contagion, `setTag` interpolation.)*

---

## 4. Locked decisions & constraints

- **Battles** stay a fixed 2-party Pokémon fight (the souls-like is a separate experiment, out of scope).
- **Power can be social**, not battle-won. Anti-cheat is the capped accretion path + reversibility,
  NOT anchoring power to battle wins.
- **Override is allowed** (the player can do almost anything) — which is *why* the softlock guarantee
  (§3.4 protected set + reachability) is mandatory.
- **Fully autonomous** player; intent enters via the **journal** and **free-text questions** in dialogue.
- **Dual model tiers:** smart model for the nightly world-load/authoring, fast model for real-time talk.
- **Real FRLG assets only — no new art.** Generated places compose existing tiles + building kinds
  {center,mart,gym,house,hideout,lab,tower} + pre-rendered interior PNGs. The LLM picks *kinds*, never pixels.
- **Local-only.** localStorage save. **The API key is set by the user in-game; never handle it in code or logs.**
- **Determinism:** same seed + same `act()` sequence ⇒ byte-identical save; a half-grown consequence
  reloads identically. No `Date.now()` / `Math.random()` in anything that reaches a save.
- **The seed game must keep working** at every step (it is the product; the engine extends it).

---

## 5. Build order (each phase: deliverable + acceptance gate)

**P0 — Determinism** *(no-regret; lands on `main` too; also fatal-fix #3)*
Seeded RNG with per-op sub-streams; remove `Date.now`/`Math.random` from `store.ts`/placement/encounters;
fixed-point integer channels; canonical save codec. **Accept:** same seed + scripted actions → byte-identical
save twice; save→load→re-serialize is identical.

**P1 — Entity registry** — the backing `Entity` substrate; `Building`/`Town`/`NPC` project from it.
**Accept:** existing seed game renders and plays unchanged, now driven through projected entities.

**P2 — The tick evaluator** — capped-channel accretion path + two-phase frozen-snapshot tick +
frozen `forEach` + named-channel thresholds + the two global invariants. **Accept:** all four
adversarial attacks (cascade-mint, story-softlock, spatial-orphan, determinism-divergence) are
*demonstrably blocked* by a regression test each.

**P3 — Structural-op data homes** — runtime location registry (replaces const `LAYOUTS`) so
`createLocation` synthesizes a layout from a seed template + biome palette; persisted
`world.connections: Edge[]` merged into `buildMap` exits so `wireConnection` survives reload;
`placeBuildingValidly` upgraded to seeded RNG + door-reachability BFS. **Accept:** a building placed,
a location calved, and a road wired at runtime all render, are walkable, and round-trip a reload.

**P4 — Harness + recorder** — `window.harness = {observe, act, snapshot, renderAt}`; `act()` maps 1:1
to the 3 triggers; snapshot after each `endDay` + each threshold cross = `world.state` clone +
event-log tail + canvas PNG; non-spatial render panels (faction grip-map, rivalry standing); the
mechanical invariants run per snapshot; the LLM-judge scores the sequence; output strips + contact
sheet. **Accept:** a scripted multi-day run produces a snapshot timeline with all invariants green
and a rendered strip.

**P5 — Authored bundles & divergence** — one bundle end-to-end (warehouse → compound → settlement
over ~2 weeks), then a second shape (gang reach) to prove generality, scaling toward 5–10.
**Accept:** the Definition of Done (§6).

---

## 6. Definition of Done (the eval that gates "complete")

Run the harness over **5–10 different authored bundles** (and each bundle under 2 seeds). The system
is done when:

- **Every mechanical invariant is green on every snapshot:** no-free-minting (every channel delta has
  a capped-path origin within budget), single-accretion-path, reachability/connectivity BFS,
  persistence round-trip, reversibility (decay actually un-spreads), no hardcoded seed-ids in any
  bundle, control-integrity, log-completeness.
- **The LLM-judge clears the bar on the rubric** (the 4 pillars from `INTENT_AND_EVAL.md`:
  Talking · Choosing · World-evolving · Characters-evolving): overall **≥ 0.80**, no pillar **< 0.65**,
  plus per-sequence **legibility** and **coherence** (one escalating thread, not noise).
- **The divergence check passes (two-tier):** *Tier 1* — final-state "world fingerprints" differ
  *structurally* across runs (different entities created, different geometry, different control map),
  and that difference is attributable to the bundle (kernel source + RNG seeding byte-identical across
  runs). Same-bundle/different-seed pairs diverge only within seeded placement variation, keeping the
  same threshold/structural skeleton. *Tier 2* — the cross-run judge can independently *name and cite*
  the diverging storylines from the rendered strips alone.
- **The contact sheet** of 5–10 strips shows near-identical day-1 frames and visibly different worlds
  later. This artifact IS both the deliverable and the verification evidence.

---

## 7. How to work

- **Eval-driven hill-climb:** build a phase → run the harness → read invariant failures + judge
  scores → fix the lowest-scoring dimension → repeat. Let the eval, not vibes, say what's next.
- **Self-verify by recording**, don't claim. Drive the real game; capture the strip; look at it.
- **Worktree discipline:** commit per coherent step; never regress the seed game or break determinism;
  P0 also goes to `main`. Commit attribution:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- When a phase's design choice is genuinely open, decide from the locked architecture and note it;
  only surface to the user a choice the architecture doesn't already settle.

---

## 8. Guardrails (NEVER)

- **Never hardcode a storyline, town, faction, or stage-ladder into the kernel.** If two playthroughs
  would grow the same way, you've leaked content into the engine. Stages are authored, not coded.
- **The LLM never touches coordinates, tiles, or pixels.** It proposes semantics in the closed
  vocabulary; the trusted structural ops produce all geometry.
- **No power, money, control, or geometry minted outside the capped accretion path** (§3.1) or the
  self-validating structural ops.
- **No new art.** Compose existing tiles/kinds/interiors only.
- **Never handle the user's API key.** It lives in the game's settings/localStorage.
- **Keep the seed game playable at every commit.**
