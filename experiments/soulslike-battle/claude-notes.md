# Claude Opus Feedback Notes

Claude Opus responded with a critique/plan rather than a full file artifact. The useful points were:

- The previous mock likely felt weak because the combat lacked strong readable telegraphs, rewarding dodge timing, commitment costs, impact feedback, and a learning curve.
- The feel core should be built around telegraph -> active hit -> recovery, with the recovery becoming the punish window.
- Dodge needs real invulnerability frames and a "just dodge" reward so timing matters.
- Stamina should prevent attack/dodge spam and make panic play unsafe.
- Boss posture gives offense a goal beyond HP chip.
- Phase changes should add pressure gradually rather than feeling random.
- The biggest visual feel upgrades are hitstop, screen shake, damage numbers, attack flashes, i-frame tint, and clear color-coded danger zones.

I used those recommendations to create `claude-mock.html` as a second isolated prototype.

## High-fidelity rendering pass — `claude-mock-hifi.html` (v2)

`claude-mock-hifi.html` keeps the v1 combat feel (telegraph→active→recover, dodge
i-frames, just-dodge, stamina, posture break, phase escalation, hitstop/shake, no-loss
retry) and rebuilds the *rendering* at much higher fidelity. Driven by a multi-agent
review (art direction / game-feel / correctness / performance, each adversarially
verified, plus a completeness critic) and in-browser visual iteration.

Form:
- Onix is now a **coiled, reared rock serpent** (Catmull-Rom spine, not a straight chain).
- Single **scene light** → light-following boulder shading, cylinder body tube, joint
  ambient occlusion (fuses "beads on a string" into one solid body).
- Merged, blurred, **height-aware cast shadow** anchors its weight.
- **Anticipation + recoil** curves (boss wind-back→lunge; Charmander wind-up→strike→settle).

Scene / post:
- Scene-wide **bloom** (half-res threshold + blur) and a subtle color grade.
- Fixed the **perspective-grid** convergence (was mathematically broken in v1).
- **Dynamic camera** (frames the duel, pushes in on tells, directional impact kick).
- **Environment reacts** — slams flash the magma cracks and leave scorch decals + dust.

Feel: i-frame visuals now match the true invuln window; distinct **just-dodge spectacle**;
orange boss-HP damage trail; receded magma hue so threats own the orange band; crescent
slash; held white "crunch" impact silhouette.

Perf (to afford bloom): baked static arena, cached per-(phase,segment) boulder sprites,
zero per-frame `shadowBlur` (baked glow sprites + two-pass strokes), precomputed vignette
gradients, capped particle pool. Measured ~0.2 ms CPU/frame — comfortable 60fps headroom.

The page exposes its sim state (`p`, `b`, `moves`, `fx`, …) on the global scope, so states
can be forced from devtools for screenshots (e.g. `b.state='active'; b.move=moves.slam`).

### Dodge "completely stuck" bug (fixed)

Pre-existing in both mocks: `playerUpdate` decremented the dodge timer with `p.dodge -= dt`
and gated movement on `if (p.dodge)`. Since 310 ms isn't a clean multiple of the frame dt,
the timer overshot 0 into a *negative* value — which is truthy — so after the FIRST roll the
player was locked in the dodge branch forever (it just kept going more negative). Death +
`reset()` was the only escape, which is why it felt intermittent. Fix: clamp
(`p.dodge = Math.max(0, p.dodge - dt)`) and gate on `> 0`. Also added a ~160 ms **dodge input
buffer** (press → `dodgeBuf`, fired by `tryDodge()` the instant the player can roll) so a roll
pressed during attack/roll recovery still comes out. Verified deterministically by stepping the
real update fns: dodges/6s went 1 → 9, and post-roll `canMove` is now true. Lesson: any
`if (timer)` gate needs the timer clamped, or a decrement can leave it negative-and-truthy.

## Roster expansion — 6 playable Pokémon

`claude-mock-hifi.html` now has a data-driven `SPECIES` table with six selectable mons
(1–6 / click the bottom select strip; switching resets the duel). Designed via a 7-agent
workflow (one designer per mon + a balance/consistency harmonizer):

- **Starters (lean):** Charmander (Fire), Squirtle (Water), Bulbasaur (Grass) — light + heavy
  + ONE signature special on `I`.
- **Final evos (loaded):** Charizard (Fire/Flying), Blastoise (Water), Venusaur (Grass/Poison)
  — bigger (scale ~1.8–1.95) + THREE specials on `U/I/O`, exactly one of which is a utility
  (Charizard Fly = i-frame dash, Blastoise Withdraw = guard/parry, Venusaur Synthesis = heal).

Each mon is a distinct canvas render (local space, facing +x, `SPECIES.<id>.draw()`), reused
by the select-strip thumbnails. Six recognizable silhouettes: Charizard's swept teal wings,
Blastoise's two shoulder cannons, Venusaur's big pink flower, etc.

New systems added: a **projectile layer** (`shots[]` — Water Gun, 3/5-leaf Razor Leaf,
Fire Blast orb), **per-element VFX** (`hitVfx`: water splash-rings/droplets, grass leaves/petals,
fire embers) + `GLOW_COOL`/`GLOW_GRASS` sprites, **charge specials** (`p.cast` → beam line hit
for Hydro Pump/Solar Beam, or detonating projectile for Fire Blast), **cone** specials
(Ember/Flamethrower), **aoe** (Rapid Spin), **dash** (Fly), **guard/parry** (Withdraw, in
`hurt()`), **heal** (Synthesis), a **special-cooldown HUD** (U/I/O slots), and the **type engine**
in `resolveHit()`.

**Type math (one rule):** posture += base × elementMult × punishMult, where elementMult = 1.4
(water/grass-tagged), 0.8 (fire-tagged), 1.0 (physical light/heavy). Water/grass SPECIAL clean
hits refund 35% of that special's cooldown ("CD -35%" toast). Fire mons compensate: ×0.8
cooldowns, +12% physical damage, faster move speed. Verified both directions in-browser
("Super-effective hit." + CD refund for grass; "Resisted — chip it down." for fire vs Onix).

`roster-showcase.gif` / `-small.gif` cycle all six firing their signature moves at the Onix.

### Win crash (fixed) + Xbox controller

WIN CRASH: `resolveHit()` called `reset()` synchronously on the killing blow, reassigning the
global `p`/`b` mid-update-tick; the caller then deref'd stale state (e.g. `playerUpdate` ran
`if (p.atk.t <= 0)` on the now-null `p.atk`), throwing and freezing the rAF loop. Fixed by
deferring: the kill sets a `winT` timer + slumps the Onix (`b.broken=1e9`) + shows a VICTORY
overlay; `reset()` runs at the TOP of `playerUpdate` when `winT` elapses (a safe point that
returns immediately, like the death path). Lesson: never call `reset()` (which reassigns
`p`/`b`) from inside the update tick — defer state swaps to a frame boundary.

### Balance + QA sweep (28-agent audit + deterministic in-browser battery)

Ran an adversarial code-level QA workflow (balance / state-machine / hit-correctness lenses,
each verified) = 21 confirmed issues, plus a deterministic in-browser test harness (call the
real update fns, measure lock frames / posture-per-sec / time-to-kill / crash edge cases).
Fixed 18, deferred 3 (low/cosmetic). Key fixes:

- **BAL-1 posture had NO decay** (permanent accumulator → no soulslike tension). Added gated
  bleed in bossThink: `b.lastHit` timer; when idle/recover & no posture gain for >700ms,
  `b.posture -= dt*0.045` (~45/s; full bar in ~2.6s). Paused during tell/active and while broken.
- **BAL-2 multi-leaf stacked posture ×count** (Bulbasaur 3-leaf = 116 posture/cast, near one-shot
  break). Reduced per-leaf values to a sane volley total (bulba 8/leaf, venu 6/leaf).
- **Light was the dominant move** (water/grass ×1.4 on a fast safe spam). Light now counts as
  PHYSICAL for type-math (`tEl:null`); water/grass identity lives on heavy + specials.
- **SM-1/2/3 guard exploits**: `busy()` omitted `p.guard` so you could attack while Withdraw's
  parry was up; the shield also froze (doubled) during a charge; `dur0` could be undefined → NaN
  parry. Fixed: guard in busy() (dodge still cancels), guard ticks every frame before the action
  early-returns, dur0 seeded at creation.
- **HC-1 facing test was un-normalized** (dist-scaled dot vs −20 → ~190° hit arc). Normalized +
  gated on `cos(arc)` so cones/melee respect aim.
- **HC-5 beam hitbox 6× the visible width** (`side < w+60`=86px vs 26px beam) → `w/2+24`.
- **BAL-6 charge had no risk** + beam posture near-broke the bar. Getting hit mid-charge now
  cancels the cast (half-cd refund); Hydro Pump/Solar Beam posture 50→34.
- **BAL-8 ranged spam never stamina-gated** (regen ran during the 200ms castpose). Added
  `p.regenLock=600` after any special.
- **BAL-3 Charmander Ember was a trap** (fire double-penalized: no 1.4, no refund). Fire specials
  now earn the cd refund too; Ember posture 18→24.
- **BAL-5 Blastoise overstatted + free self-refunding parry**. Trimmed heavy 33→29, light 16→11;
  parry no longer refunds cd or +30 stamina (now negate+empower + small +15 sta only).
- **BAL-4 Flamethrower** 520ms lock for ~13 posture → active 340, posture 22, dmg 36.
- **SM-4 stale dodgeBuf** fired a dodge ~1s late after a charge → buffer decays every frame.
- **HC-2 Rapid Spin** had a 156px hitbox but no visual → expanding-ring telegraph sized to the hit.
- Plus: clear beam on win (SM-5), suppress POSTURE-BREAK on a lethal hit (HC-7), cap ghosts/texts
  arrays (SM-7), refund-once-per-cast (`p.refunded[slot]`).

Result: time-to-break posture 0.9–1.6s, time-to-kill 5.7s (Charizard glass-cannon) – 11.4s
(Squirtle methodical) — an archetype spread, not broken numbers. Zero crashes across win/death/
switch/retry-during-any-action. DEFERRED (low): HC-4 element-string refund (brittle but correct),
HC-6 per-cast focus/hitstop dedup.

### Combo system (chainable attacks)

- **Light flurry**: J→J→J cycles `p.chain` 0→1→2: slash, back-slash (sweep flips via `cdir`), then a
  FINISHER (chain 2: ×1.7 posture, ×1.3 dmg, wider/bigger swing, shorter total so the string is snappy
  — 230/195/300ms), then loops.
- **Heavy finisher**: a heavy thrown while a combo is live (`p.comboT>0`) is empowered (×1.45 posture,
  ×1.35 dmg) and flagged `finisher` — light→light→K is a real string ender.
- **Combo counter**: `p.combo` builds on EVERY landed hit (light/heavy/special/projectile). A ramp
  `cm = 1 + min(combo,12)*0.025` (+2.5%/hit, cap +30%) scales the hit's dmg+posture in resolveHit.
  Shown as a floating "N× COMBO" by the player (gold→orange→red by size, `comboPop` scale-punch).
- **Risk/reward**: combo drops to 0 when you take a hit (in `hurt()`), and resets after an ~820ms gap
  with no hits (`p.comboT`, decayed in updateFx). Refreshed on every cast AND every landed hit.
- **Finisher juice**: extra ring + sparks + bigger shake/hitstop/flash on `o.finisher` hits.
Verified clean: flurry chains 0,1,2(fin),0,1,2; heavy off-combo = finisher (post 30→44, dmg 26→35) vs
cold 30/26; combo builds, breaks on hit, times out.

### "Consecutive hits don't register" (regression from the body-hitbox change + no attack buffer)

Two causes, found by simulating real mashing in the deterministic harness (mash light at 110ms
cadence landed 0/30 hits):
1. The first body-hitbox pass faced the player at the SINGLE NEAREST body point. On a coiled snake
   that point is often beside/behind you (e.g. the tail curling inward) while you face the center,
   so the facing check failed → whiff; and as the snake undulates the nearest point flips frame to
   frame → inconsistent hits.
2. No attack input buffer — presses during a swing were dropped, so mashing faster than the ~230ms
   light swing lost half the inputs.
Fix: `bestBodySeg(x,y,fx,fy,reach,cosArc)` hits ANY body segment within reach + a generous front
arc (cos(1.4)≈160° for melee, the cone's own arc+0.2 for cones); `tryAttack` AUTO-FACES the nearest
body segment when engaging; and attack is now buffered (`atkBuf`/`atkBufType`, ~160ms, decays at the
top of playerUpdate, fired right after dodgeBuf, cleared on dodge so dodge cancels a pending attack).
Verified: mash light now lands 15/15 possible swings (was 0); heavy 6/6 (still committed); hits from
12/12 angles around the coil; dodge→attack and attack→dodge both behave; ranged hits the head.
Lesson: hit-testing a long/articulated body needs per-segment tests + a forgiving facing arc (or
auto-face), not a single nearest-point + strict facing.

### Onix hitbox = its visible body (HC-8 generalized; user-reported "weird hitbox")

ALL player→Onix hit detection (melee/cone/aoe/projectile/beam) measured distance to the single
CENTER point `b.x,b.y` (the coil BASE), but the Onix renders as a ~150px coiled snake → you could
stand against the reared head/upper body and WHIFF (too far from base), and impacts landed near the
base. The recent normalized-facing fix made melee stricter, compounding it. Fixed: cache the spine
once per frame (`spinePts = onixSpine()` in loop, shared by hit-detection + drawOnix) and added
`onixBodyDist(x,y)` (nearest spine-segment surface). Melee/cone/aoe/projectile now test/land against
the nearest body segment; beam tests each segment along its line. Verified: hitting the head
(154px from center, past the old 129 reach) now connects; normal melee unchanged; balance preserved.
Boss→player attacks LEFT on center (their telegraph zones are drawn around `b.x,b.y`, so that's
correct). Note: can't watch live play through the extension — the game tab's rAF pauses whenever it
isn't the focused tab, so it freezes the moment the user switches to read chat; diagnose via
in-page instrumentation logs (persist) or the deterministic harness instead.

### Heavy-attack balance (the real "broken")

User flagged Charmander's heavy as broken = OVERPOWERED: "no frame penalty" → spammable, so it
dominated. Root cause: heavy `total` was 360ms with the hit near the END, leaving only ~80ms
recovery → no commitment. Fixed: heavy `total` 360→**560ms** with the active/hit window moved
EARLY (`0.24–0.46` of total) so there's a long ~300ms punishable recovery you're locked into.
Light 170→230ms (hit `0.34–0.6`). Verified: heavy now locks ~544ms; mashing heavy lands only
~4 in 2s (was unbounded). `drawSlash` melee is now timed to the STRIKE window (not the whole
duration) so the recovery shows the committed follow-through with NO swipe. Lesson: a soulslike
heavy must be a commitment — payoff + long punishable recovery, not just bigger numbers.

### Slash visual + walk animation

- SLASH: was sized to the HIT RANGE (95px) → a huge flat white wedge detached from the tiny
  Charmander (looked broken). Now sized to the CREATURE (`~40*scale`), attached at the body,
  element-tinted, strike-timed. Melee impact point moved to the Onix's near surface (`b + nb*50`).
- WALK GAIT: characters were sliding (vertical bob only). Added `gaitPhase` (legs alternate while
  moving), a forward lean into the stride, and foot-dust puffs. Charizard (flying) is exempt.

### Sprite + move polish, flying/agility (from user video feedback)

- SPRITE FIDELITY: `bodyEl()` helper draws main body forms with a light-direction radial
  gradient + a dark outline (lighten() for tints), turning flat vector blobs into shaded,
  outlined sprites. Applied to every species' main forms; `curScale` keeps outline width
  consistent; `lowDetail` flag flattens the tiny select-strip thumbnails (perf + cleaner icons).
  Per-frame cost still ~0.33ms.
- CHARIZARD FLIES: `SPECIES.charizard.fly = true` → `drawPlayer` lifts the body ~22px with a
  hover bob and draws a small detached ground shadow, so it reads airborne (wings already flap).
- BLASTOISE AGILITY (user note — Blastoise is canonically fast via jet propulsion): speed
  132→168, `dodgeVel:700` + `dodgeEl:"water"` → its dodge is a fast water-jet boost (longer
  dash + splash-ring + droplet spray). Kept high HP, so it's now "heavy but mobile."
- MOVE VFX: projectiles (water lance / leaf) got bigger + a glow sprite + a particle trail;
  the melee slash crescent got a bright white leading highlight.

XBOX CONTROLLER: Gamepad API polled each frame in `pollPad()` (called at loop top). Left
stick/D-pad → move (fed into `input()` via `padAxX/padAxY`, deadzone 0.26); A=light, X=heavy,
B=dodge, Y/LB/RB = specials I/U/O, LT/RT = cycle Pokémon, Start/Back = retry. Edge-detected via
`padPrev`. NOTE: Chrome only exposes a connected pad to a page AFTER a button is pressed while
that page is focused (privacy gate) — `pollPad` auto-detects it then; a "🎮" HUD indicator + a
5s mapping toast appear on connect.

### Playthrough recording

`playthrough.gif` (640×360) / `playthrough-small.gif` (520w) — a scripted ~2.4 s loop
(approach → slam tell → dodge i-frames → whiff → punish → posture break → finish). Built by
killing the throttled rAF loop, driving the sim deterministically frame-by-frame, capturing
`canvas.toDataURL` frames, and POSTing them to a tiny local receiver (frames never routed
through the model), then `ffmpeg` palette-encode. The live tab throttles rAF to ~1 fps when
backgrounded, so real-time capture / the gif_creator hook don't work — deterministic stepping does.
