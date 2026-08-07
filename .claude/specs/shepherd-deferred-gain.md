# Shepherd: declare before rolling, receive after

## The change

The shepherd's swap used to be atomic: spend 2 sheep, get 2 chosen cards, all
before the roll. The card text now reads

> If you begin your turn with four Sheep in hand, you may discard two to
> specify two resources of your choice. You receive them after rolling. Sheep
> do not count towards your 7 card hand limit.

so the action splits in two: a **declaration** before the roll (sheep leave the
hand, the pair is recorded) and a **payout** once the roll has fully resolved.
The point of the split is that the declared cards **cannot be lost to a 7** —
they are not in hand while the discard is computed or taken, and (per the
decision below) not while the robber steals either.

## Payout point

The pair lands when the roll resolves to `main` — i.e. **after the entire
7-chain**, not merely after the discards. That is stricter than the existing
nomad-production / investor-payout deferral, which pays out once every owed
discard is in and so is still exposed to the steal. The shepherd's declared
cards are immune to both the discard and the steal.

Concretely, a 7 exits to `main` at exactly three points, all of which must pay
out (guarded on `phase.from7`):

1. `applyRollOutcome`'s friendly-robber branch (7 during the first go-around —
   no robber at all).
2. `handleMoveRobber` when there are 0 or 1 steal candidates (`nextPhase` is
   the `resume` main phase).
3. `handleSteal`.

A non-7 roll pays out inside `applyRollOutcome` alongside the investor payout.

Ordering against the fortune-teller chain and the magician window doesn't
matter — one bonus per player, so a shepherd is never also an FT or a magician
— but the payout is applied **before** those wraps so the state threaded into
them is already settled.

## Data

`PlayerState.shepherdPending?: [Resource, Resource]` — the declared pair,
written by `shepherd_swap` and cleared by the payout. `shepherdUsedThisTurn`
keeps its existing meaning (once per turn) and still gates the button;
`shepherdPending` is purely the "owed cards" record.

Cleared defensively in `handleEndTurn` alongside `shepherdUsedThisTurn`. It
should never survive a turn — every path out of the roll phase pays out — but a
leaked pending pair must not follow the player into the next round.

Legacy hands with no `shepherdPending` read as nothing owed.

## Rules (`lib/catan/bonus.ts`, mirrored in the edge function)

- `shepherdEffectiveHandSize`, `requiredDiscards` — **unchanged**. The declared
  cards aren't in the hand, so nothing needs to exclude them; that is the whole
  mechanism.
- `canShepherdSwap(p)` — unchanged predicate (shepherd, not used this turn,
  ≥ 4 sheep).
- New `applyShepherdPayout(state, idx): { players, events }` — mirrors
  `applyInvestorPayout`'s shape. No-op when the seat has no `shepherdPending`.
  Grants the two cards, clears the field, and emits one
  `shepherd_payout { player, gain }` event.

## Events

Two events per use:

- `shepherd_swap { player, take }` — unchanged, logged at declaration.
- `shepherd_payout { player, gain }` — new, logged when the cards land. Needed
  because the gain is now separated from the declaration by a whole roll (and
  possibly a discard + robber move); without it the log shows sheep leaving and
  nothing arriving. Follows `investor_payout` exactly.

`shepherd_payout` must be added to the `GameEvent` union in
`lib/stores/useGamesStore.ts` and to `describeEvent` + the `trades` filter
group in `ActionLog.tsx`, or it is written server-side and never rendered.

## UI

- `ShepherdSwapPicker` — subtitle gains "You'll receive them after you roll."
- Dock (new layout) and `BottomArea` (classic) — where the `Shepherd` button
  sits pre-roll, a seat with a pending pair shows a small static hint naming
  the two owed resources instead of nothing, so the player isn't left wondering
  where their sheep went. Gated to the roll phase, same as the button.
- Nothing else changes: the swap is still opened from the same button, still
  only in the `roll` phase on your own turn, still once per turn.

## Undo

`shepherd_swap` stays in `UNDOABLE_ACTIONS`. Undo restores the pre-action
snapshot, so the sheep come back and `shepherdPending` disappears with it — no
special handling. The payout is not an action and so is never undone on its
own; undoing the roll isn't possible (`roll` is excluded on principle).

## Files

- `lib/catan/bonuses/bonuses.ts` — description (already edited; fix the
  "Your receive" typo).
- `lib/catan/types.ts` — `shepherdPending` field + comment.
- `lib/catan/bonus.ts` — `applyShepherdPayout`, shepherd section comment.
- `lib/catan/ActionLog.tsx` — `shepherd_payout` case + filter group.
- `lib/catan/ShepherdSwapPicker.tsx` — copy.
- `lib/stores/useGamesStore.ts` — `GameEvent` union.
- `lib/game/hud/Dock.tsx`, `lib/game/BottomArea.tsx` — pending hint.
- `supabase/functions/game-service/index.ts` — `handleShepherdSwap` records
  instead of granting; `applyShepherdPayout` mirror; the payout at all four
  points (the three 7-chain exits plus the non-7 roll); `handleEndTurn` clears
  the field.
- `dev/check-catan-bonuses.ts` — tests.
- `lib/catan/CLAUDE.md` — one line on the deferred payout (a cross-file
  contract: a new 7-chain exit to `main` has to pay out too).

## Tests (`dev/check-catan-bonuses.ts`)

Alongside the existing shepherd hand-size tests:

- `applyShepherdPayout` grants the declared pair and clears `shepherdPending`.
- It is a no-op for a seat with nothing pending, and for a non-shepherd.
- A duplicate pair (2× the same resource) pays 2 of it.
- `requiredDiscards` is computed off a hand that no longer holds the sheep and
  does not yet hold the declared cards — a shepherd who declares and then rolls
  a 7 owes the same as they would have with the pair still undeclared.
