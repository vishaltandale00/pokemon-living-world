# The LLM-Authored Language Layer — Architecture & Phased Build Plan

*An extension of `docs/EMERGENT_IDENTITY_ENGINE.md`. Plan only, no code. All line refs verified against the live tree (read 2026-06-17). This document takes the prior plan's fixed predicate/effect VOCABULARY and open INSTANCE space and adds the missing level: the LLM authoring its own TYPES, LAWS, and VERBS — its own language — every artifact of which still compiles down to the same fixed, sim-trusted instruction set.*

---

## The two-layer model — fixed instruction set (VM) vs. open LLM-authored language

The governing idea is **two layers, and only two**.

**Layer (1) — the fixed, tiny, sim-trusted instruction set.** This is the only thing the interpreter executes. It is the one artifact under change-control, and it **never grows**. It has exactly three primitive *kinds*, each a closed union parameterized by open string ids:

- **PREDICATES** — typed, side-effect-free READS of world state. The nine operators of `EMERGENT_IDENTITY_ENGINE.md:35-44` (`rep`, `badges`, `defeated`, `controls`, `day`, `hasItem`, `holdsRole`, `flag`, `invitation`), plus exactly one generic addition this layer requires: `entityField` (read a schema-declared instance field). One pure evaluator `evalPredicate(state, p): {ok, why}`, default-deny on unknown `t`. This replaces the ad-hoc `meetsRequirements` body (`store.ts:77-92`), preserving its `{ok, missing[]}` contract so the HUD and `claimSlot` (`store.ts:94-112`) keep working.
- **EFFECTS** — clamped WRITES from a closed allowlist. The seven arms of `EMERGENT_IDENTITY_ENGINE.md:46-53` (`addRep` |amt|≤20, `setFlag`, `adjustMeter` |Δ|≤15→0..100, `addItem` |amt|≤10, `setOwner`, `setHolder`, `rumor`), plus exactly one generic addition: `setField` (clamped write to a declared mutable instance field). **The hard line: no arm mints money, badges, or XP, and no arm absolute-sets reputation** — those live only in the battle economy (`BattleScene.ts:294-302`).
- **TRIGGERS** — WHEN the interpreter evaluates. The prior plan only *implied* this (via the tick and `advanceStory`); this layer promotes it to a first-class closed union: `{on:'day_tick'}`, `{on:'event', kind}`, `{on:'predicate_cross', when:Predicate[]}`.

That is the complete VM: **9+1 predicate operators, 7+1 effect arms, 3 trigger occasions.** Both `+1` additions are *generic over all schemas* (one operator, not one-per-noun), so coining a new type adds a row to a dictionary, never a primitive to the VM.

**Layer (2) — the open, persistent, LLM-authored definition layer.** Three new DATA artifacts, all `JSON.stringify`-able rows in the save, all validated on write, **all reducing entirely to Layer (1)**: **TypeSchemas** (new nouns), **Rules** (new laws/physics), **ActionDefs** (new verbs). The LLM authors these as data; it can never author a new primitive or an unclamped effect — only *named compositions* of the fixed set.

### What's reused from the prior plan, and what's new

| Concern | Prior plan (`EMERGENT_IDENTITY_ENGINE.md`) — **reused as-is** | This layer — **new** |
|---|---|---|
| Predicate/Effect unions | Defined (`:35-53`), default-deny evaluator, flat-AND, clamps | `+entityField`, `+setField` (two generic accessors), `Trigger` promoted to a primitive (`:1.3`) |
| Mutation chokepoint | `applyProposal`→`applyDevelopment` becomes an `OPS` registry (`:60`); `DIRECTOR_SCHEMA.kind.enum` generated from `Object.keys(OPS)` (`director.ts:20`) | New OPS handlers: `define_type`, `create_instance`, `create_rule`/`update_rule`/`retire_rule`, `add_action`/`retire_action` |
| Open instances | `entities`/`edges` registries, open `Entity.kind` string (`:24`), `create_entity` | `Entity.data` is now **validated against a `TypeSchema`** instead of a hardcoded per-kind bag |
| Objectives | `Objective{done:Predicate[], onComplete:Effect[]}` replaces `STORY[]` closures (`story.ts:26-103`) | Generalized into reactive `Rule{trigger, when, then}` — objectives become the *one-shot, player-progress* special case |
| Dialogue choices | `add_option` — dialogue-only, ephemeral (`:64`, `WorldScene.ts:540-590`) | First-class persisted `ActionDef`, scoped to dialogue/map/building/menu, cooldown-governed, queryable |
| Caps/pruning/load-migration | entities ≤120, edges ≤600, append-only log (`store.ts:58`), no-op default-empty migration (`store.ts:18-48`) | Extended to `typeSchemas`/`rules`/`actions` registries with their own caps and reconcile-on-load |

The non-negotiables from `INTENT_AND_EVAL.md:11-16` hold **by construction, now over the language itself**: NN1 sim-is-truth, NN2 LLM-proposes/sim-disposes (over the *language*), NN3 offline-always-works (the LLM-language is a with-key superpower; seed schemas/rules/actions are the pinned offline scaffold), NN4 real-Pokémon-feel (no minting arm, combat gates cross only via real battles at `BattleScene.ts:291`).

---

## Definition layer — the three definition kinds

All three live as new interfaces in `src/world/types.ts` beside the prior plan's `Predicate`/`Effect`, and as new `Record<string,…>` registries on `WorldState` (`types.ts:137-148`), each defaulting empty in `load()` (`store.ts:18`) so old saves migrate as a no-op.

```ts
interface WorldState {
  // ...unchanged: day, player, npcs, slots, towns, buildings, events, rumors, pendingOffers, dialogueCache...
  // ...prior plan: factions, roles, objectives, entities, edges...
  typeSchemas?: Record<string, TypeSchema>;   // NEW — the dictionary of LLM-coined NOUNS
  rules?:       Record<string, Rule>;          // NEW — the LAW book (physics)
  ruleState?:   Record<string, boolean>;       // NEW — predicate_cross edge memory (last-tick truth per rule)
  actions?:     Record<string, ActionDef>;     // NEW — the VERB dictionary
  actionState?: Record<string, { lastUsedDay: number }>; // NEW — cooldown bookkeeping
}
```

### 3.1 TypeSchemas — the LLM declares new NOUNS

```ts
type FieldValue = number | string | boolean | string[];

interface FieldDef {
  name: string;                                  // slug, unique within the schema
  type: 'int'|'string'|'bool'|'id'|'enum'|'idlist';   // CLOSED set — NO nested objects/maps
  required?: boolean;
  default?: FieldValue;                          // must itself validate against this field
  mutable?: boolean;                             // default true; false ⇒ immutable after create
  min?: number; max?: number;                    // BOTH required when type==='int'; |·|≤10000
  maxLen?: number;                               // string cap, ≤240 (rumor-length parity)
  enum?: string[];                               // required when type==='enum'; non-empty, ≤12, each ≤32
  ref?: 'entity'|'npc'|'slot'|'building'|'town'|'faction';  // required for id/idlist
  maxItems?: number;                             // idlist only, ≤8
}

interface TypeSchema {
  id: string;                                    // kind name (slug), unique across typeSchemas ∪ seed kinds
  label: string;                                 // 'Heist','Syndicate','Turf', ≤40
  blurb?: string;
  createdBy: 'seed'|'director'|'player';
  fields: FieldDef[];                            // ≤16, names unique
  version: number;                               // 1 at create; a redefine is a NEW id, never an in-place edit
  pinned?: boolean;
}
```

An instance is just the prior plan's open `Entity` (`EMERGENT_IDENTITY_ENGINE.md:24`) whose `data: Record<string, FieldValue>` is now **validated against `typeSchemas[entity.kind]`** rather than a hardcoded per-kind payload — *that* is the upgrade from "new label on a fixed bag" to "new validated record type."

**How it reduces to the VM.** A schema is pure validation metadata; it executes nothing. The closed scalar set (no `object`/`json`/`map` type) guarantees every field is a *flat* value, so: every instance READ is the single generic `entityField` predicate (`{t:'entityField', id, field, eq?|gte?}`), and every instance WRITE is the single generic clamped `setField` effect (`{t:'setField', id, field, value?|delta?}`). Coining `heist` adds a `typeSchemas` row; it does **not** add a `heistPhase` predicate or a `setHeistCrew` effect. `setField` is the schema-typed descendant of the existing `update_entity` whitelist pattern (the `npc_attitude` clamp at `store.ts:147`), clamped to the field's own declared `min/max`, and it can reach **only** `entities[id].data` — never `player.reputation`/`badges`/`money`, `buildings.owner`, or `slots.holder` (no `FieldDef.type` maps to those; instance fields are a sandboxed soft-state namespace).

### 3.2 Rules — the LLM declares new LAWS (the physics)

```ts
type Trigger =
  | { on:'day_tick' }                           // folded at end of runWorldTick (director.ts:99)
  | { on:'event'; kind:string }                 // fired off the single logEvent chokepoint (store.ts:56)
  | { on:'predicate_cross'; when:Predicate[] };  // fires on the AND-set false→true EDGE only

interface Rule {
  id: string; label: string;                    // ≤60
  createdBy: 'seed'|'director'|'player';
  trigger: Trigger;                             // WHEN
  when: Predicate[];                            // GUARD — pure AND, re-evaluated at fire time (default-deny)
  then: Effect[];                               // PAYOFF — clamped allowlist writes, applied iff when holds
  budget: { perTick: number; perRun: number };  // REQUIRED rate-limit; perTick≤3, perRun≤200
  firedThisRun: number;                         // persisted monotonic counter (init 0)
  order: number;                                // deterministic conflict tiebreak
  touches: string[];                            // DERIVED-on-write: ids this then[] writes (spine-safety scan)
  enabled: boolean; pinned?: boolean;
}
```

This is **the single biggest thing absent from the prior plan**, whose only reactive construct is `Objective{done, onComplete}` — a one-shot player-progress hook. There is no general world-physics law: no way to author "*every day-tick*, if the warehouse has no owner, `adjustMeter` Pewter prosperity −2." The Director's `heuristicTick` (`director.ts:143-226`) is *our* hardcoded heuristic, re-run by us — not a persisted law the LLM wrote once that the sim then applies autonomously forever. A `Rule` is exactly that.

**How it reduces to the VM.** A Rule is *literally* `Trigger × Predicate[] × Effect[]` — three fixed primitives, zero new ones. The interpreter is a fold (see next section). `then[]` is restricted to the closed Effect allowlist (no money/badge minting reachable; can't write `holder='player'`/`owner='player'` directly), so even a hallucinated rule firing every tick moves only bounded soft-rep/meters.

### 3.3 ActionDefs — the LLM declares new VERBS

```ts
interface ActionDef {
  id: string; label: string;                    // ≤64 (DialogueChoice.label clip parity, dialogue.ts:99)
  createdBy: 'seed'|'director'|'player';
  context: { where:'dialogue'|'map'|'building'|'menu'; npc?:string; building?:string; town?:string };
  requires: Predicate[];                        // use-time gate, re-checked at click (TOCTOU-safe)
  do: Effect[];                                 // clamped payoff on use
  cooldownDays?: number; consumesTurn?: boolean;
}
```

The prior plan's `add_option` is dialogue-only, ephemeral, NPC-bound (`:64`). An `ActionDef` is a first-class verb that (1) lives on the map/building/menu too, (2) is **persisted and reusable** across ticks and save round-trips, and (3) is **queryable world-data** — its `do[]` can `setFlag` a key that a Rule's trigger or an Objective's `done` then references, closing the loop so invented verbs feed invented laws. `add_option` is kept as sugar that compiles to an `add_action` with `where:'dialogue'`. `DialogueChoice` (`dialogueContent.ts`, schema in `dialogue.ts:14-44`) gains one optional `performsAction?: string` field so authored verbs ride the existing `pickChoice` rail.

**How it reduces to the VM.** An ActionDef is `Predicate[]` (the `requires` gate, identical machinery to `claimSlot`'s `meetsRequirements` check at `store.ts:97`) × `Effect[]` (the `do` payoff, identical to `applyEffect`), surfaced at a closed-enum context. No new primitive.

### How the LLM emits all three (schema + intent path)

Two channels, both disposing through the single `applyProposal`→`OPS` chokepoint:

1. **Nightly Director** (`director.ts`). `DIRECTOR_SCHEMA.kind.enum` (`director.ts:20`) is generated from `Object.keys(OPS)`, so `define_type`/`create_instance`/`create_rule`/`add_action` become authorable verbs automatically. The `requires`/`do`/`when`/`then` sub-schemas' operator enums are *generated from the registry of Predicate/Effect handlers* — so the model can only ever **name** a primitive the VM already has. For `create_instance`, the `data` sub-schema is generated from `typeSchemas[typeId]` as a soft nudge (`validateInstance` is the hard gate).
2. **Intent-compiler** (`src/llm/intent.ts`, prior plan `:77`). A player's free-text ambition compiles into not just an objective but the supporting **definition artifacts** (one schema + one rule + one action), each disposed through `OPS` + its validator.

### Validation (the sandbox — runs on author, before any mutation)

`validate{Schema,Instance,Rule,ActionDef}` are pure functions called *before* the OPS handler writes anything (validate-before-mutate; any failure → silent drop via the `store.ts:121` try/catch, never a throw, never a partial mutation). They reject on: an unknown predicate `t` or effect `t` (closed unions, default-deny); a missing/unresolvable id or `ref` (`resolveId` over `npcs ∪ slots ∪ towns ∪ buildings ∪ entities` + literal `'player'`; faction axes auto-create at 0); an out-of-clamp constant baked into a def (e.g. `addRep.amount=40`); a god-construct (`requires`/`when` with zero non-trivial predicates; a day_tick rule with empty `when`; `then`/`do` containing `setHolder='player'` or `setOwner='player'`); a slug collision (append-only — a change is a new versioned id); a cap or per-tick author-budget overflow; or a **spine-safety** violation (a rule/action whose `touches[]` hits an id referenced by a pinned seed objective's `done[]`/`requires[]`, mirroring invariant #6, `:73`).

---

## The interpreter — the fixed deterministic engine

One new module, `src/world/interpreter.ts` (pure functions only, imports the live clamp constants from `store.ts:69,139` as the single source of truth), holds the evaluators and the per-occasion driver. Everything still mutates through the single `applyProposal`→`OPS` chokepoint.

### Per-tick / per-event evaluation order

The driver runs at three occasions, in a fixed terminating order:

**(A) `day_tick`** — fired at the END of `runWorldTick` (`director.ts:99`), *after* the Director/`heuristicTick` produced developments and *before* `advanceObjectives`. Rationale: the Director nudges first, then autonomous laws react to the settled day, then objectives check completion last — so a rule firing on the new day can trip an objective the same night (one-directional cascade, never circular; matches the `WorldScene.endDay` sequence). The fold:

1. **Sort** all candidate rules by `(order ASC, id ASC)` — a total order, no reliance on JS object-key iteration.
2. For each `day_tick` rule, in order: skip if `!enabled` or `firedThisRun ≥ budget.perRun` or `perTick` exhausted; else `ok = AND over evalPredicate(state, p)` for `p in when[]` (default-deny); if `ok`, apply each `Effect` in `then[]` via the **same** clamped `applyEffect` objectives use; increment counters; `logEvent('rule_fired', label + affected ids)`.
3. **`predicate_cross` rules** are evaluated in the same `day_tick` fold: `now = AND over trigger.when` (and the `when[]` guard); `prev = ruleState[id] ?? false`; fire `then[]` **iff `now && !prev`**; then always write `ruleState[id] = now`. This is the false→true *edge* — fires exactly once on the rising edge, never re-fires while true (idempotence, `:70`), re-arms only after a true→false→true cycle.

**(B) `event`** — `logEvent` (`store.ts:56`) is the single fact chokepoint; after appending the event it calls `runRules(state, {on:'event', kind})`. **Re-entrancy guard:** a private `ruleDepth` counter is incremented around `applyEffect`-inside-`runRules`; `logEvent` only dispatches event-rules when `ruleDepth===0`. So an event-rule's `then[]` effects still log their facts (memory preserved) but do **not** recursively fire more event-rules — cross-rule reactions to those new facts happen on the *next* tick's `day_tick` fold. This converts "event chains within a tick" into "event chains across ticks," the single most important termination lever.

**(C) action use** — not on a tick; on player interaction. `resolveActions(state, ctx)` returns context-matching actions off cooldown whose `requires[]` pass; `applyAction(id, ctx)` re-runs `requires[]` at click (TOCTOU-safe), applies `do[]` clamped, stamps `actionState[id].lastUsedDay`, and `logEvent('action_performed', {actionId})` — which is itself an `event` trigger occasion, closing the verb→law loop.

### Termination guarantees (the heart)

Three independent, provable layers:

1. **Single-pass per occasion, no in-pass re-evaluation.** The `day_tick` fold makes exactly one pass. A rule whose `then[]` would satisfy another rule's `when[]` does **not** cause that rule to re-run this tick — it runs at the earliest next tick. One tick = O(#rules) predicate folds + O(total then[]) clamped effects. No fixpoint iteration.
2. **Per-occasion budget** (`budget.perTick`) + the event-depth gate cap how often one rule fires within a single occasion.
3. **Per-run budget** (`firedThisRun ≥ budget.perRun` ⇒ permanently inert). This kills the only remaining loop shape — "rule A flips a flag on tick N that re-arms B on N+1 that re-arms A on N+2" — because each firing burns budget; total firings ≤ `Σ perRun` across the whole playthrough. Combined with edge-triggering (a flag that stays true never re-fires; one that oscillates burns budget and halts), the engine **provably terminates** every tick and across the run. A global per-tick fire cap (e.g. 32) is the belt-and-suspenders stop, logging one `rule_budget_reached` event.

### Effect application/clamping & schema validation

Effects always flow through the prior plan's clamped `applyEffect` — single source of effect truth, reused by objectives, rules, and actions. `setField` resolves `entities[id].data`, confirms the field is declared and `mutable!==false`, then branches by type: `int` → `clamp(delta? cur+delta : value, min, max)`; `enum` → write only if `∈ enum`; `string` → `slice(0, maxLen)`; `bool` → `Boolean`; `id` → write only if `resolveId(value, ref)`. `create_entity`/`update_entity` whose `kind` names a schema run `validateInstance(schema, data)`: required fields present, ints clamped, strings truncated, enums checked, id refs resolved, unknown extra keys dropped — never a partial write. Schemas are immutable once any instance exists; `reconcileInstances()` on `load()` re-validates every instance against its (immutable) schema, coercing/dropping out-of-range or now-dangling values so a tampered or stale save can never inject an out-of-range value into the running sim.

---

## Determinism, termination & anti-exploit invariants

Every guarantee below is a mechanical property of the validators/interpreter, not a prompt request.

- **Reduce-to-instruction-set.** The LLM authors only DATA. A schema is validation metadata over the closed scalar set; a rule is `Trigger × Predicate[] × Effect[]`; an action is `Predicate[] × Effect[]`. The operator/arm enums the LLM may emit are *generated from the registry of primitive handlers*, so it is structurally impossible to name a predicate, effect, or trigger the VM lacks. **The VM never grows; only the dictionary does.**
- **No new primitives / no unclamped effects.** The only two VM-surface additions (`entityField`, `setField`) are generic over all schemas — one operator/arm each, parameterized by metadata, never one-per-noun. Every `int` field carries enforced `min/max`; every Effect arm is individually clamped at the `applyEffect` boundary (`store.ts:69,139`).
- **Determinism.** All evaluators/validators are pure functions of `(schema, data, state)` — no `Date.now`/`Math.random` in any read/write/fold path (instance/offer ids use a `day+seq` counter, never wall-clock, for logic). Total `(order, id)` apply order; persisted `ruleState` edge memory survives JSON round-trip. Same save + same op stream ⇒ byte-identical post-state (what the eval harness's replay and seed-shrinking rely on).
- **Termination.** Single-pass-per-occasion + event-depth gate + per-rule/global budgets + edge-triggering ⇒ fire-count strictly decreases toward a hard floor; no recursion, no unbounded iteration, no unbounded cross-tick oscillation.
- **Anti-god-mode (the hard line, NN1/NN4).** The Effect allowlist has no money/badge/XP/absolute-rep arm; instance `data` is a sandboxed namespace with no addressing path to player standing; `setHolder='player'`/`setOwner='player'` are categorically rejected in any authored `then[]`/`do[]` (those cross only through `claimSlot`'s battle-gated deposition, `BattleScene.ts:309-313`); every standing-granting action/rule needs ≥1 non-trivial guard predicate (no zero-cost god-verb/god-rule); combat gates cross only via a real battle's `flags['beat_<id>']` (`BattleScene.ts:291`). **A fully-fooled gate yields only bounded soft-rep — the substrate is the last backstop.**
- **No dangling refs / spine-safety / append-only.** Every id/ref resolves at write time and is re-resolved on load (invariant #1); a rule/action targeting a pinned-objective id is rejected (invariant #6); every firing/authoring `logEvent`s, corrections are new rows never edits (invariant #4).

---

## The LLM's language as memory

Authoring is worthless if the LLM re-invents `raid`/`heist`/`job`/`caper` as four near-duplicate nouns across ticks. The fix is **read-back**: `worldDigest()` (`director.ts:54-92`) gains a `digestLanguage()` block printing the model's own prior definitions every tick:

```
SCHEMAS YOU DEFINED: heist{target:id→building, crew:int 1..6, alarm:bool, payout_axis:id→faction}
ACTIVE LAWS: heist_pays_off (on rep[ember]≥40 → +ember rep) [met]; warehouse_decays (day_tick) [unmet]
VERBS AVAILABLE: run_heist @rocket_warehouse (requires controls+rep≥10) [off cooldown]
```

with a one-clause system rule: *"REUSE/EXTEND your existing schemas/laws/verbs before coining a near-synonym; do not fork your own language."* Slug-collision-on-create *forces* explicit reuse (a duplicate id silent-drops). The intent-compiler embeds the same digest so a player ambition extends the existing vocabulary rather than re-coining it.

**Persistence + bounds.** All five registries are plain JSON rows; a `JSON.stringify`→parse round-trip is identity. Hard caps protect the ~5 MB single-blob save (`store.ts:49`): `typeSchemas ≤24`, `rules ≤64` (`predicate_cross ≤24`), `actions ≤64`, `≤16` fields/schema, `when[]`/`then[]`/`requires[]`/`do[]` `≤6`, `idlist maxItems ≤8`. Tick-time pruning reaps non-pinned `resolved/defunct` instances and dead rules/actions, GC'ing their `ruleState`/`actionState`, and compacts each terminal fact into one `WorldEvent` — the *fact* survives in the 400-capped log even after the *structure* is reaped (monotonic memory).

**Offline behavior.** The interpreter is pure TS with zero network. Without a key, *all previously-authored* schemas/rules/actions keep executing under the keyless `heuristicTick` (`director.ts:143`, which now also calls `runRuleTick`) — only **new** authoring is lost. Seed schemas/rules/actions (`createdBy:'seed', pinned`) are the always-on physics floor: the prior plan's hardcoded `heuristicTick` meter nudges (`director.ts:154-203`) are re-expressed as pinned seed Rules, so the offline world breathes via the *same* engine the LLM authors into. The `'J'` ambition affordance falls back to a curated `SEED_AMBITIONS` menu of pre-compiled definitions, so keyless players can still install one authored law. The LLM-language is a with-key superpower, never a dependency (NN3).

---

## Surfacing in the game

Invented nouns, laws, and verbs must appear to the player and stay legible.

- **Nouns (schemas/instances) → journal/HUD.** Because every field is a typed flat value, **one generic renderer** suffices for every invented kind: a Heist card shows `Phase: ready · Crew: 6 · Alarm: no`, where `id` fields render the referenced object's label via `resolveId`, `enum`/`bool`/`int` render natively, `idlist` renders a comma list. No per-noun UI code — the flat-scalar constraint is exactly what buys this.
- **Laws (rules) → morning banner.** Every firing `logEvent`s with the rule's human label; those fold into `res.headlines` in `endDay` (the existing morning banner) automatically, so invented physics is *narrated* ("· Ember crews emptied the old warehouse overnight") rather than a silent stat change. The flat `when[]=AND` limit keeps every law explainable as a single sentence.
- **Verbs (actions) → three channels.** (1) **Dialogue:** `drawDialogue` appends passing `where:'dialogue'` actions as synthetic numbered `DialogueChoice{performsAction}`; `pickChoice` (`WorldScene.ts:540-590`) gets an `if (ch.performsAction)` branch beside the existing `acceptsOffer` (`:554`) and `startsBattle` (`:574`) branches — zero new render code, reusing `keys123` (`:535`). (2) **Building/map:** `transition` computes building-context actions on entry and shows a low-priority `[A] Actions here (N)` banner. (3) **Contextual menu:** a `drawActionMenu`/`updateActionMenu` pair **cloned structurally from the shop UI** (`drawShop`/`updateShop`/`buyItem`, `WorldScene.ts:429-463`), registered in the `worldModalActive`/`worldCloseModal` guard (`:73`) and dispatched at the top of `update()` (`:256`) so it owns input while open. Failing verbs render **greyed with their exact `missing[]`** (the same machinery the slot HUD already uses, `store.ts:85`), so every gate is legible rather than a mystery; per-context cap (≤4, sorted by recency) keeps the `[1]/[2]/[3]` pattern intact.

---

## Thinnest viable slice

**Goal:** prove the whole loop end-to-end — *player declares one ambition → the LLM DEFINES one new TYPE + one RULE + one ACTION → the rule fires autonomously over a tick → the action appears in-game and is used → all of it reduces to clamped primitives* — while a god-mode definition is rejected and a keyless player still has the authored spine.

**Build exactly this (and no more):**

1. **VM surface + interpreter skeleton.** Add `Trigger`, `TypeSchema`/`FieldDef`/`Rule`/`ActionDef` interfaces and the `entityField`/`setField` arms to `types.ts`; the five registries to `WorldState`; no-op default-empty migration in `load()` (`store.ts:18`). Create `src/world/interpreter.ts` with `evalPredicate`(+`entityField`), `applyEffect`(+`setField`), and `runRules(state, occasion)` (single-pass fold, `(order,id)` sort, `ruleState` edges, `perTick`/`perRun` budgets, `ruleDepth` gate). Wire `runRules({on:'day_tick'})` into the end of `runWorldTick` (`director.ts:99`) and the depth-gated `runRules({on:'event'})` into `logEvent` (`store.ts:56`).
2. **Three authoring ops + validators.** Add `define_type`, `create_instance`, `create_rule`, `add_action` to the `OPS` registry (the registry-ized `applyDevelopment`, `store.ts:134-181`), each calling its pure validator before mutating. Generate `DIRECTOR_SCHEMA.kind.enum` and the `requires`/`do`/`when`/`then` operator enums from the handler registries.
3. **One-ambition intent path + surfacing.** Extend `src/llm/intent.ts` to emit the three artifacts; add `resolveActions`/`applyAction`; wire the `pickChoice` `performsAction` branch and the building-context `[A]` banner; add `digestLanguage()` to `worldDigest`.

**Worked target (the Heist slice):** declare *"pull off a heist on the Pewter warehouse."* The compiler emits: schema `heist{target:id→building, crew:int 1..6, alarm:bool, phase:enum[casing,ready,pulled], payout_axis:id→faction}`; instance `heist_warehouse{target:rocket_warehouse, crew:1, phase:casing, payout_axis:ember}`; rule `heist_grows` `{trigger:day_tick, when:[controls(rocket_warehouse, by:ember), entityField(heist_warehouse, phase, eq:casing)], then:[setField(heist_warehouse, crew, +1)]}`; action `run_heist` `{context:{where:building, building:rocket_warehouse}, requires:[entityField(heist_warehouse, phase, eq:ready), defeated(archer)], do:[setField(heist_warehouse, phase, pulled), addRep(ember, +8)]}`.

**How to verify (acceptance test, runnable by hand + harness):**

- *Reduction + autonomy (with key):* minting all four grants the player **nothing** (badges/money/rep unchanged — assert). Over ~6 day-ticks `heist_grows` fires deterministically, `crew` climbs 1→6 clamped, then a follow rule sets `phase:ready`. `run_heist` then appears at the warehouse interior; after a real Archer battle sets `beat_archer`, its `requires[]` pass at click, `do[]` applies the clamped `+8 ember` (the only standing change, `|8|≤20`).
- *Guardrail — missing primitive rejected:* a definition emitting `{t:'setField', id:'heist_warehouse', field:'phase', value:'won'}` (value ∉ enum) is a no-op; a rule with `then:[{t:'addBadge'}]` or `then:[{t:'setHolder', holder:'player'}]` silent-drops at `validateRule`; a god-schema field `playerBadges:int max:9999` is accepted but provably cannot mint a badge (sandbox blocks the write path) — state unchanged in all cases.
- *Offline:* with no key, `'J'` shows the `SEED_AMBITIONS` menu; the seed 5-chapter spine still completes via `heuristicTick`; any *already-authored* heist schema/rule/action keeps executing keyless across a reload (assert JSON round-trip identity + a keyless tick still fires `heist_grows`).

---

## Phased rollout (layering on the prior P0–P6)

This layer assumes the prior plan's **P0–P3** have landed (predicate substrate, `OPS` registry, open enums, data-driven objectives). It then adds:

- **P-L0 — Trigger primitive + interpreter skeleton + the two generic accessors.** `Trigger` union, `entityField`/`setField` arms, five registries + no-op migration, `runRules` no-op wired into `runWorldTick`/`logEvent`/`heuristicTick`. *Accept:* game plays identically; saves round-trip with empty registries; the driver runs every tick doing nothing. **This lands the third VM primitive the prior plan only implied.**
- **P-L1 — Rule engine: reactive physics.** Full `day_tick`/`predicate_cross`/`event` driver with `ruleState`, budgets, depth gate. `create_rule`/`update_rule`/`retire_rule` ops + validator (allowlist-only `then[]`, ≥1 guard for day_tick, no `setHolder/Owner=player`, spine-safety). Re-express `heuristicTick`'s hardcoded nudges as pinned seed Rules. *Accept:* a seed rule fires deterministically under both key/keyless paths; an adversarial `+40` rep clamps to `+20`; a flag-ping-pong rule pair terminates at budget; the predicate_cross edge fires exactly once; replay is JSON-equal.
- **P-L2 — TypeSchema layer.** `TypeSchema`/`FieldDef` + `define_type`/`create_instance` ops, `validateSchema`/`validateInstance`, `entityField` predicate, `reconcileInstances` on load, caps + pruning. *Accept:* `crew=99` clamps to max; `target='nonexistent'` drops; a schema is immutable once instanced; a rule reading `entityField(…, crew, gte:3)` evaluates correctly; tampered out-of-range save value clamps on load.
- **P-L3 — ActionDef layer + three UI channels.** `ActionDef` + `actionState`, `resolveActions`/`applyAction`, `add_action`/`retire_action` ops + validator. Dialogue/building/menu surfacing (the cloned shop-UI menu). *Accept:* a verb appears only when context+requires hold, respects cooldown, and its `do[]` flag flip triggers an event-rule (verb→law loop); failing verbs greyed with `missing[]`.
- **P-L4 — Authoring/memory loop.** `digestLanguage()` block + the reuse/extend system clause; `define_*`/`add_action` in `DIRECTOR_SCHEMA` with registry-generated operator enums; intent-compiler emits definition artifacts. *Accept (with key):* the Director reuses an existing `heist` schema across two ticks instead of recoining `raid`; a player ambition installs schema+rule+action that persist a reload.
- **P-L5 — Caps, no-key degradation, harness extension.** Per-tick authoring budget, full pruning/compaction; keyless path keeps executing all prior-authored defs + `SEED_AMBITIONS` fallback. Extend the Generative Validation Harness (`src/eval/`, `:85-93`) with **VIABLE** (every authored predicate references a live id; every `FieldDef` type ∈ closed 6; ints `min≤max`), **EARNABLE** (no creation moved standing; every `setField`/rule-grant within declared clamp; no `holder='player'` outside a battle), **PERSISTENT** (defs survive JSON round-trip), **TERMINATES** (total firings ≤ `Σ perRun`), **DETERMINISTIC** (twice-run seed ⇒ JSON-equal trace), and the NN3 keyless-replay of every authored rule. *Accept:* save bounded under a 50-tick soak; keyless replay of a with-key-authored run still executes its physics; harness gates a god-schema as still-EARNABLE because the sandbox blocks it.

---

## Open decisions for the user

1. **`entityField`/`setField` — two generic accessors, or fold instance-reads onto existing operators?** Facet B proposed *surfacing* schema fields through the existing `flag`/`rep` operators (e.g. `heist.alarm` as `flag('entity.heist.alarm')`), adding **zero** VM surface; Facets A/D propose two new generic accessors. **Recommended default: add the two generic accessors.** They are the honest, type-safe path (an `int 0..100` field is a real clamped int, not a stringly-typed pseudo-flag), they are *generic over all schemas* so the VM still doesn't grow per-noun, and they keep the journal renderer and `validateInstance` clamps coherent. The cost is exactly two signed-off additions to the change-controlled §1 spec — acceptable, and the last ones the VM should ever need.

2. **Rule conflict ordering — author-controlled `order`, or pure id-sort?** Two rules writing the same meter need a deterministic apply order. **Recommended default: `(order ASC, id ASC)` with `order` defaulting to a `createdBy` tier (seed < director < player) so the LLM rarely sets it.** Because every effect is clamped at the boundary, the *result* is bounded regardless of order; `order` only disambiguates the trace for replay. Exposing it risks the LLM fiddling with priorities it doesn't understand — defaulting by tier keeps it deterministic without burdening the model.

3. **Schema mutability — strict immutable-once-instanced, or copy-on-write versioning?** **Recommended default: strict immutability + versioned new ids** (a "redefine" coins `heist_v2`, never edits `heist`). It is the cheapest way to guarantee existing instances never become retroactively invalid (append-only, invariant #4), and `reconcileInstances` only ever *tightens* toward the existing schema. The cost — orphaned `v1` instances when the LLM "improves" a kind — is handled by normal pruning. Revisit only if real runs show schema churn fragmenting the language (the `digestLanguage` reuse nudge should prevent this).

4. **Authoring budget — how many new defs per tick?** Unbounded authoring risks language sprawl and save bloat. **Recommended default: ≤2 schemas, ≤4 rules, ≤4 actions authored per tick (a `defLedger`), with player-ambition installs exempt from the per-tick cap but subject to the run caps.** This makes "found a syndicate" a multi-day arc (the prior plan's foothold philosophy, `:72`) rather than a one-night explosion, and keeps the digest legible. Expose all caps as constants so harness soak-test data tunes them, not guesses.

---

**Key files each implementer touches (absolute paths):**
- VM primitives + new artifact types + registries: `/Users/vishaltandale/ProjectsDev/pokemon-living-world/src/world/types.ts` (`Trigger`; `FieldDef`/`TypeSchema`/`Rule`/`ActionDef`; `entityField`/`setField` arms; `WorldState` registries — lines 7-42, 137-172)
- Interpreter + chokepoint: `/Users/vishaltandale/ProjectsDev/pokemon-living-world/src/world/store.ts` (`evalPredicate`/`applyEffect` extensions, `OPS` registry + the seven new handlers, validators, `reconcileInstances` in `load()` — lines 18-48, 77-181)
- New: `/Users/vishaltandale/ProjectsDev/pokemon-living-world/src/world/interpreter.ts` (`runRules`, the three drivers, `resolveActions`/`applyAction`, validators — pure, key-independent)
- Schema-from-registry + `digestLanguage` + authoring verbs + generic `heuristicTick`: `/Users/vishaltandale/ProjectsDev/pokemon-living-world/src/llm/director.ts` (lines 12-52, 54-92, 99, 143-226)
- Spine/objectives → seed rules: `/Users/vishaltandale/ProjectsDev/pokemon-living-world/src/world/story.ts` (`STORY[]`→`objectives` rows + seed Rules — lines 26-103, 143-169) and `/Users/vishaltandale/ProjectsDev/pokemon-living-world/src/world/seed.ts` (pinned seed schemas/rules/actions — lines 64-117)
- Surfacing: `/Users/vishaltandale/ProjectsDev/pokemon-living-world/src/game/WorldScene.ts` (`pickChoice` `performsAction` branch `:540-590`; `[A]` banner in `transition`; `drawActionMenu` cloned from `drawShop` `:429-463`; `worldModalActive` guard `:73`; `update()` dispatch `:256`); `DialogueChoice.performsAction` in `/Users/vishaltandale/ProjectsDev/pokemon-living-world/src/world/dialogueContent.ts` + `/Users/vishaltandale/ProjectsDev/pokemon-living-world/src/llm/dialogue.ts` (schema `:14-44`, sanitize `:98-107`)
- Intent compiler + eval: `/Users/vishaltandale/ProjectsDev/pokemon-living-world/src/llm/intent.ts` (emit definition artifacts) and `/Users/vishaltandale/ProjectsDev/pokemon-living-world/src/eval/` (VIABLE/EARNABLE/PERSISTENT/TERMINATES/DETERMINISTIC checks + NN3 keyless replay)