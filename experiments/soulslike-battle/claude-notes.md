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

### Playthrough recording

`playthrough.gif` (640×360) / `playthrough-small.gif` (520w) — a scripted ~2.4 s loop
(approach → slam tell → dodge i-frames → whiff → punish → posture break → finish). Built by
killing the throttled rAF loop, driving the sim deterministically frame-by-frame, capturing
`canvas.toDataURL` frames, and POSTing them to a tiny local receiver (frames never routed
through the model), then `ffmpeg` palette-encode. The live tab throttles rAF to ~1 fps when
backgrounded, so real-time capture / the gif_creator hook don't work — deterministic stepping does.
