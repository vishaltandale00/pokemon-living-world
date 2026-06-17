# Soulslike Battle Exploration

This is an isolated exploration. It does not touch the current game under `src/`.

## Goal

Replace the menu-driven battle feel with an action-focused boss combat layer:

- The player directly controls the active monster in a small arena.
- Fights are hard because of timing, spacing, stamina, cooldowns, and boss patterns.
- Death costs nothing permanent. The player respawns healed and can immediately retry.
- Bosses should feel learnable, not random. Every dangerous move needs a readable tell.
- The world simulation still receives simple outcomes: win, loss, catch, role/badge progress.

The closest target feel is "hard boss action" rather than classic Souls punishment. The player
should lose the attempt, not money, XP, items, or story progress.

## Current Battle Surface

The current battle system is cleanly isolated:

- `WorldScene` pauses the overworld and launches `BattleScene`.
- `BattleScene` owns combat input, HP, items, XP, catching, win/loss.
- On exit, it resumes `WorldScene` with a text result.
- World consequences happen through existing world state: flags, badges, reputation, event log.

That means a future action system can be introduced as a parallel scene, for example
`ActionBattleScene`, without rewriting maps, dialogue, LLM, or the world store first.

## Proposed Player Loop

Core controls:

- Move: WASD / arrows
- Light attack: fast, low stamina, low commitment
- Heavy attack: high damage/posture, long recovery
- Dodge: short invulnerability window, stamina cost
- Special: type move on cooldown, such as Ember, Water Gun, Vine Whip
- Lock-on: optional camera/facing assist for bosses

Moment-to-moment loop:

1. Read the boss tell.
2. Dodge, space, or interrupt.
3. Punish during the recovery window.
4. Manage stamina so panic dodging is unsafe.
5. Build focus/posture pressure to open a burst window.

This is "user focused" because the outcome comes from player execution, not selecting the best
menu command.

## Boss Design Rules

Each boss needs a pattern table, not freeform AI:

- `tellMs`: how long the warning lasts.
- `activeMs`: when hitboxes are dangerous.
- `recoveryMs`: punish window.
- `range`: melee, line, cone, ring, projectile.
- `damage`: HP damage.
- `staminaPressure`: how much the move forces dodging or spacing.
- `phase`: threshold or condition for unlocking harder patterns.

Example Giovanni/Onix pattern kit:

- Tail sweep: wide arc, slow tell, dodge through or back away.
- Rock line: straight projectile lane, punish after it fires.
- Burrow rush: delayed charge, high damage, obvious ground marker.
- Stone guard: defensive posture that invites heavy attacks to break posture.

Hardness should come from pattern layering and recovery windows, not hidden math.

## Pokemon Translation

Keep Pokemon identity, but reinterpret it for action combat:

- Species stats become action tuning:
  - HP: health pool.
  - Attack: hit damage.
  - Defense: damage reduction/posture toughness.
  - Speed: move speed, dodge distance, stamina recovery.
- Moves become cooldown abilities:
  - Ember: short cone or projectile with burn chip.
  - Water Gun: line attack with high stagger.
  - Vine Whip: mid-range lash, good posture damage.
  - Rock Throw: delayed ground marker.
- Type advantage becomes tactical pressure:
  - Super effective: more posture damage and cooldown refund.
  - Not very effective: lower posture damage, but never useless.

Party mechanics can stay simple at first:

- MVP: only the lead monster is playable.
- Later: swap active monster at shrines/centers or during long boss gauntlets.
- Later: party assists on cooldown instead of full real-time character swapping.

## Death And Retry

No permanent loss:

- No money penalty.
- No item loss.
- No XP loss.
- No world reputation loss.
- Player respawns at the nearest safe location with party healed.
- Boss resets for normal fights.

Optional difficulty pressure without punishment:

- Death journal entry: "Player fell to Giovanni's Onix."
- Boss hint after repeated deaths.
- Rematch text changes based on attempts.
- Cosmetic retry counter only.

## World Integration Contract

The action scene should still emit the same outcome categories the world understands:

- `npc_win`: player defeated an NPC/boss.
- `npc_loss`: player lost, no penalty except retry.
- `wild_win`: wild monster defeated.
- `wild_caught`: wild monster caught, if catching exists in action mode.
- `wild_fled`: player escaped.

World updates should remain outside the combat loop where possible:

- Battle scene reports outcome.
- World layer applies badges, flags, role claims, reputation, journal events.
- LLM/director only sees event log summaries, not frame-level combat telemetry.

## First Implementation Slice

Safe future slice after this exploration:

1. Add a new `ActionBattleScene` beside `BattleScene`.
2. Gate it behind a debug flag or settings option.
3. Support one boss duel: player Charmander vs Brock or Giovanni's lead monster.
4. Implement movement, stamina, dodge i-frames, light/heavy/special attacks.
5. Implement one boss pattern table with three attacks and two phases.
6. Return win/loss to `WorldScene` without changing world consequences yet.
7. Only after it feels good, route selected boss fights to action mode.

## What Not To Build First

- Full party switching.
- Every Pokemon move.
- Wild catching in action mode.
- Procedural LLM-generated boss moves.
- Online or deterministic replay.
- Permanent death penalty.

Those are second-order. The first proof is whether a single boss fight feels
readable, hard, and fair.

## Mock Demo

`mock.html` is a standalone sketch of the target combat feel:

- Direct movement.
- Light attack, heavy attack, dodge, and special.
- Stamina and focus meters.
- Boss telegraphs with red hit zones.
- No-loss death and instant retry.

It is not production code. It exists to make the mechanics and affordances concrete.
