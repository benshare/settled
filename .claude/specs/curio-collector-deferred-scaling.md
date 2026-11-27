# Curio Collector: scale per resource, defer to next turn

Two tweaks to the curio_collector bonus.

1. **Scale per resource gained.** Today a 2/12 on which the collector gains ≥1
   card grants a flat +3 of their choice (`CURIO_PICK_SIZE`). Change it so the
   pick scales with how much the collector actually produced: **3 resources of
   your choice for each resource card you gain from a 2 or 12.**
   - Owner's example: a *city* on a sheep hex numbered 2 produces **2 sheep**
     when a 2 is rolled (normal production) → the curio pick is **2 × 3 = 6**
     cards of your choice, on top of those 2 sheep.
   - `N = CURIO_CARDS_PER_RESOURCE (3) × (cards gained from the 2/12)`.
2. **Defer to the collector's own next turn, after they roll.** The pick no
   longer happens on the 2/12 roll. It is held and resolved once the
   **collector's own next roll resolves to `main`** — so nothing can be
   discarded by a 7 in between, and (because it resolves *after* the chain) not
   even the collector's own next 7 can take it. Mirrors the shepherd/investor
   deferred-gain pattern.

It **stays an interactive pick** (owner wants "of your choice"). So the
`curio_pick` sub-phase and `CurioPickBanner` are **kept**, but they move: the
pick opens on the collector's *own* post-roll instead of as a reaction on the
2/12 roller's turn, and its size is variable (the accumulated owed count)
instead of a flat 3.

## Timing — accumulate across turns, pay at the collector's roll

Resource distribution reaches every seat on every roll, so between two of the
collector's turns several 2/12s (on opponents' turns) can each owe them. The
owed count is therefore **additive** across turns, stored on the player, and
drained into one pick when the collector next rolls.

**Payout covers everything owed *before* this roll; this roll's own 2/12
accumulates for next turn.** Concretely, at the collector's roll resolution:

1. `owedBefore = players[active].curioOwed ?? 0`.
2. Accumulate this roll's 2/12 gains into every qualifying collector's
   `curioOwed` (including the active roller) — `+= 3 × handTotal(gains[idx])`.
   For the active roller this is set so that, after the pick is carved out,
   their `curioOwed` holds **only** this roll's own contribution (deferred to
   their *next* turn).
3. If `owedBefore > 0`, open `curio_pick { owner: active, count: owedBefore,
   resume }` and leave `players[active].curioOwed` = this-roll contribution.
   Else no pick; `curioOwed` = this-roll contribution.

So the rule is uniform: **a resource you gain from a 2 or 12 is paid as curio
picks at the start of your *next* turn, right after you roll.** A collector's
own 2/12 pays a full go-around later, same as an opponent's.

### Payout point (mirrors shepherd)

The pick opens when the collector's roll resolves to `main`:

- non-7 roll: in `applyRollOutcome`, after distribution (and the no-op
  investor/shepherd/magician steps — a collector is never also one of those).
  Nested **inside** any forger reaction and below the (never-present) magician
  wrap: `forger_pick(resume = curio_pick(resume = main))`.
- 7 roll: at each of the three 7-chain exits to `main` (friendly-robber branch,
  `handleMoveRobber` with ≤1 candidate, `handleSteal`) — wrap `main` as
  `curio_pick(resume = main)` when the active roller has `curioOwed > 0`. No
  forger/magician there (a 7 produces nothing; the collector isn't a magician).

A single helper `wrapCurioPick(phase, state, activeIdx)` does the wrap at every
site; it carves `count` out of `curioOwed` exactly as step 3 above.

Autopilot's skipped robber already runs those exits, so a forfeited collector
reaches the pick — and autopilot resolves it the same way it does today (drops
it, logs `autopilot_skipped`), just against the new single-owner phase shape.

## Data

`PlayerState.curioOwed?: number` — curio cards owed, accumulated from 2/12 rolls
since the collector's last pick. Written by roll distribution, drained when the
pick opens. Legacy hands with no field read as `0`.

**Not cleared on `end_turn`** — unlike `shepherdPending`, `curioOwed` is
*designed* to cross turns, so the end-turn defensive clear must NOT touch it.

(`claim_curio` still exists but no longer carries the pick across seats; the
owner is `phase.owner` and the length is `phase.count`.)

## Phase

`curio_pick` changes shape:

```
{ kind: 'curio_pick'; resume: Phase; owner: number; count: number }
```

from the old `{ resume: Phase; pending: number[] }`. Single owner (the active
collector), variable `count`. Update everywhere the variant is read:

- `lib/catan/types.ts` + the edge `Phase` mirror.
- `supabase/functions/_shared/phase.ts` `pendingSeats` → `[phase.owner]` (was
  the pending list); `lib/catan/timeout.ts` `pendingSeats` likewise.
- `curses.ts` avarice allowed-phase map + edge `ALLOWED_*` record — unchanged
  membership (`curio_pick: true` stays), just compiles against the new shape.
- Autopilot `curio` skip (edge ~6903 auto-action, ~7051, ~7105) → operate on
  `owner`/`count`.

## Rules (`lib/catan/bonus.ts`, mirrored in the edge function)

- `curioCollectorTriggers(bonus, total, gainedCount)` — **unchanged**.
- `CURIO_PICK_SIZE` → **replaced** by `CURIO_CARDS_PER_RESOURCE = 3`.
- New `curioPickSize(cardsGained) = CURIO_CARDS_PER_RESOURCE × cardsGained`
  (pure, used by the accumulation).
- New `wrapCurioPick(phase, state, activeIdx): { phase, players }` (or inline at
  each site) — opens `curio_pick` when the active roller owes, carving `count`
  out of `curioOwed`.

## Events

- `curio_collected { player, take }` — **kept** (still the claim result), but
  `take` is now variable length. `describeEvent` copy changes from the literal
  "collected 3 resources" to "collected N resources (curio collector)" using
  `e.take.length`.

No new event kind needed (the pick still logs on claim, as today).

## Card copy (`lib/catan/bonuses/bonuses.ts`)

- `description`: → **"When you collect from a 2 or 12, pick three resources for
  each one you gained."** (final wording TBD, must read as per-resource ×3).
- `clarifications`: add **"Your picks arrive at the start of your next turn,
  after you roll."**

## UI

- `CurioPickBanner.tsx` — kept, but the size is `phase.count` (passed in), not
  `CURIO_PICK_SIZE`. The header reads `pick {count} · {n}/{count}`. `onConfirm`
  returns a `Resource[]` of length `count` (drop the fixed 3-tuple type). Its
  mount now gates on the viewer being `phase.owner` on their own turn (it
  already only shows for the acting player).
- **Persistent owed hint.** When the viewer is a curio_collector with
  `curioOwed > 0`, show a small static hint naming the owed count — and show it
  **continually until their turn pays it out, including during other players'
  turns** (owner: it may affect whether they trade mid-round). So this is not
  the pre-roll-only shepherd hint; it's a persistent indicator on the viewer's
  own HUD, gated purely on `curioOwed > 0` (any phase, on or off turn). Place it
  near the viewer's hand / dock status. Text e.g. "Curio: N cards next turn".

## Undo

Nothing new is undoable. The pick resolves inside roll resolution / a
server-only sub-phase; accumulation happens on a roll (a server barrier).
`claim_curio` is not in `UNDOABLE_ACTIONS` (unchanged).

## Files

- `lib/catan/types.ts` — `curioOwed` field (+ comment); new `curio_pick` shape;
  drop `CURIO_PICK_SIZE` usages.
- `lib/catan/bonus.ts` — `CURIO_CARDS_PER_RESOURCE`, `curioPickSize`,
  `wrapCurioPick`; curio section comment.
- `lib/catan/bonuses/bonuses.ts` — description + clarification.
- `lib/catan/CurioPickBanner.tsx` — variable `count`.
- `lib/catan/ActionLog.tsx` — `curio_collected` copy uses `take.length`.
- `lib/catan/curses.ts` — avarice map compiles against new shape (membership
  unchanged).
- `lib/catan/timeout.ts` — `pendingSeats` for `curio_pick` → `[owner]`.
- `lib/stores/useGamesStore.ts` — `GameEvent` `curio_collected` stays;
  `claimCurio` caller unchanged (still `{ take }`).
- `lib/game/*` — the persistent owed hint; `CurioPickBanner` mount passes
  `count`; verify `BoardArea`/`TopArea`/`hud/status.ts` wiring against the new
  phase shape.
- `supabase/functions/game-service/index.ts` — accumulate into `curioOwed`
  instead of building the old `curio_pick` seat list; `wrapCurioPick` at the
  non-7 path + the three 7-chain exits; new `curio_pick` shape;
  `handleClaimCurio` validates `owner`/`count`; autopilot curio skip against the
  new shape; `pendingSeats` mirror in `_shared/phase.ts`; **do not** clear
  `curioOwed` in `handleEndTurn`.
- `lib/catan/CLAUDE.md` — Set-2 sub-phase line (curio is now the collector's own
  deferred post-roll pick, not a reaction on the roller's turn; size scales) and
  the deferred-gain contract note (a new roll→main exit must also open the
  collector's curio pick, same as the shepherd payout).
- `dev/check-catan-bonuses.ts` — tests.
- `lib/patchNotes/patch-notes.json` — player-facing entry.

## Tests (`dev/check-catan-bonuses.ts`)

- `curioPickSize`: 3 × cards gained (0→0, 2→6).
- Accumulation adds across multiple 2/12s before a payout.
- Payout-before-accumulate: a collector owed from before who rolls a fresh 2/12
  pays out the old count and carries only this roll's contribution.
- `wrapCurioPick` opens `curio_pick` with the right `count` and leaves
  `curioOwed` at the carried remainder; no-op when nothing owed.
- `requiredDiscards` on the collector's own next 7 is computed off a hand that
  does not yet hold the picked cards (they land after the chain).
