# Nominating the last settlement inside the placement draft

Seat `N-1` places both of its starting settlements back-to-back, so it gets to
say which one it placed **second** — that is the one that pays the starting
resources (`last-settlement-choice.md`).

Today that nomination is a **separate server step**: the seat drafts all four
pieces, confirms, the pieces land, the phase moves to `step: 'pick_last'`, and
the seat then taps one of its two placed settlements and confirms again. Two
confirms, two round-trips, and a step where the board is already committed.

This folds the nomination into the draft. The seat drafts settlement, road,
settlement, road, nominates which settlement counts as second, and confirms
**once**. Nothing is sent until that confirm, so every part of the turn —
including the nomination — is still take-back-able.

## Locked decisions (confirmed with user)

1. **The nomination is pre-seeded to the settlement drafted second.** Both
   drafted settlements get rings; the second-drafted one opens nominated (dark
   ring) and Confirm is enabled immediately. Tapping the other switches it.
   This reverses `last-settlement-choice.md` §7's "nothing is pre-selected" —
   that rule existed because both settlements had already landed in one
   submitted turn, so the app had no honest default. Inside the draft the
   player really did place one after the other, so the drafted order _is_ the
   answer until they say otherwise.
2. **The choice reaches the server as pair order.** The client submits the two
   pairs already ordered so the nominated one is second; the server grants on
   the second pair exactly as it does for every other seat. The `pick_last`
   phase step, the `choose_last_settlement` action and the `swapPlacementPairs`
   log rewrite are **deleted** — with the pairs submitted in the nominated
   order, the event log is right by construction.

## Flow

```
seat N-1, round 1 turn (one draft, one confirm):

  tap vertex A → tap edge a → tap vertex B → tap edge b
                     ↓
  both pairs drafted: rings on A and B, B nominated (drafted second)
  tap A to switch the nomination, or just confirm
                     ↓
  place_start { placements: [ pair-B, pair-A ] }   ← nominated pair last
                     ↓
  server: pair 1 stamped round 1 (no grant), pair 2 stamped round 2 (grants)
          → next seat, step 'settlement'
```

Everyone else is unchanged: one pair, drafted and confirmed as today.

**An aristocrat in seat `N-1` gets no rings and no nomination** — it collects on
both settlements, so there is nothing to choose. Its draft ends at `ready` and
Confirm submits in tap order, as today.

## State

### `Phase` — `lib/catan/types.ts` (mirrored in the edge function)

```ts
| { kind: 'initial_placement'; round: 1 | 2; step: 'settlement' }
```

`step` is now a single-member union. It stays a field rather than being dropped
because `phase.kind` alone can't distinguish it from a future placement
sub-phase and every reader (`placementKey`, the sweep, status lines) already
destructures it. Narrowing the union is what makes the compiler list every
`pick_last` reader.

### Client — `lib/game/gameScreenContext.tsx`

`pickLast` stops being "the answer to a server step" and becomes an **override
on the draft's own order**:

```ts
// The settlement the seat nominated as its second, or null to take the
// drafted order at its word.
const [pickLast, setPickLast] = useState<string | null>(null)

// Self-cleaning: an override for a vertex no longer in the draft (undone and
// re-placed elsewhere) falls back to the drafted-second settlement. Null for
// every seat that doesn't choose, so nothing downstream has to re-ask.
const nominatedVertex = canNominate
	? (placementDraft.find((e) => e.vertex === pickLast)?.vertex ??
		placementDraft[1]?.vertex ??
		null)
	: null
```

`canNominate` — whether the rings show at all:

```ts
canNominate =
	isMyPlacementTurn && placementPairs === 2 && myBonus !== 'aristocrat'
```

`placementStage` loses `'pick_last'` and keeps `settlement | road | ready`.
`ready` is now where the nomination lives, so `canConfirmPlacement` is just
`placementStage === 'ready'` — the nomination can never be missing, since it
defaults.

Reset stays on `placementKey` (which no longer carries a step that changes
mid-turn, but still changes on round/turn).

## Board — `lib/catan/PlacementLayer.tsx`

The `step === 'pick_last'` branch is deleted. Its ring affordance moves into
the draft rendering, where it decorates the **ghosts** rather than placed
pieces:

- At `stage === 'ready'` with `canNominate`, each drafted settlement ghost gets
  a `PulsingRing` plus a transparent hit target. The nominated one is
  `pieceStroke`, the other `pieceStrokeSoft` — the same both-pulse, colour-only
  distinction `last-settlement-choice.md` §7 landed on, for the same reason (a
  frozen ring reads as disabled).
- Tapping a ring calls `onSelect({ kind: 'settlement', vertex })`, which at
  `ready` sets the override instead of appending to the draft.

`PlacementSelection` is unchanged. `PlacementLayer`'s props swap `pickLast:
Vertex | null` (the step's answer) for `nominated: Vertex | null` plus
`canNominate: boolean`; `BoardView`'s `interaction` prop follows.

## Server — `supabase/functions/game-service/index.ts`

- **`placeSettlementPiece`** drops the `deferGrant` branch entirely. The grant
  rule returns to: granted on a `round === 2` settlement, or on either for an
  aristocrat. Since the client now orders the pairs, the second pair _is_ the
  nominated one and the round-2 stamp lands on it.
- **`handlePlaceStart`** drops the `pickLast` branch and its early return; every
  submission now ends in `nextPlacementTurn(lastRound, …)`. For the double
  seat that is `nextPlacementTurn(2, N-1, N)` → `{ round: 2, currentTurn: N-2 }`,
  the same advance the `pick_last` handler used to make — the seat's whole
  double turn is over in one submission, as it already is today.
- **Deleted:** `handleChooseLastSettlement`, `ChooseLastSettlementBody`, its
  action-router case, `swapPlacementPairs`, `roundTwoSettlementOf`, and
  `ownSettlementVertices` (the mirror; nothing else calls it).
- **`autoActionFor`** (timeout sweep) loses its `pick_last` tail; the
  `initial_placement` case is now only the `place_start` builder. The sweep
  drafts pairs in the order it finds them, which is a legitimate nomination —
  a timed-out seat gets the resources of whichever settlement it placed second,
  the same as a player who never touched the rings.

Not undoable, unchanged — `place_start` was never in `UNDOABLE_ACTIONS`.

## Rules — `lib/catan/placement.ts`

- **Added:** `orderedPlacementPairs(draft, nominated)` — complete pairs only,
  nominated pair last. Pure, so the reordering property below is testable, and
  it keeps the ordering rule beside the draft helpers rather than inside
  `onConfirm`.
- **Deleted:** `swapPlacementPairs` (its only caller was the edge function's
  mirror) and `ownSettlementVertices` (its only caller was the `pick_last`
  board branch).
- `isDoublePlacementSeat` stays — it's what `placementPairsExpected` is built
  on, and it's still what gates the rings.

### Why reordering the pairs is always legal

The client validates each drafted piece against
`applyPlacementDraft(state, me, draft)` in tap order; the server re-validates in
the submitted (nominated) order. Both orders accept exactly the same pair of
pairs:

- **Distance rule** — symmetric between the two settlements, and neither road
  can touch the other's settlement (they'd have to be adjacent, which the
  distance rule already forbids).
- **Road validity** — `targetSettlement` picks the player's settlement with no
  road of its own, which is whichever settlement was just placed in either
  order.
- **`power` / `youth` curses** — both are monotone in the set of settlements
  owned, so if the full set passes, every prefix of it does, in any order.

So a draft the client accepted can't be rejected by the server for having been
reordered.

## Copy

| Surface                             | Before                                                                             | After                                                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `BottomArea` confirm, `ready`, N-1  | `Confirm both placements`                                                          | `Confirm both placements` (unchanged)                                                                  |
| `BottomArea` confirm, `pick_last`   | `Tap the settlement you placed last`                                               | — (step gone)                                                                                          |
| `Dock` confirm, `ready`, N-1        | `Confirm both`                                                                     | `Confirm both` (unchanged)                                                                             |
| `PlacementHeader`, my turn, `ready` | `Your turn — confirm your placements`                                              | N-1 non-aristocrat: `Your turn — tap the settlement you placed second, then confirm`; others unchanged |
| `PlacementHeader`, watching         | `…to place both their settlements and roads` / `…choose their starting settlement` | `…to place both their settlements and roads` only                                                      |
| `spectatorStatus` (`TopArea`)       | step-aware, `…is choosing their starting settlement`                               | `…is placing a settlement and road` only                                                               |
| `hud/status.ts` `placementLine`     | `… choosing a starting settlement`                                                 | line removed; `ready` keeps `…placements are ready to confirm`                                         |

The ring itself is the affordance for switching, so the header is the only place
that names it — the confirm button stays a confirm and never turns into an
instruction the player can ignore.

## Store — `lib/stores/useGamesStore.ts`

`chooseLastSettlement` is deleted. `placeStart` is unchanged in shape — the
ordering happens in `onConfirm`, which calls `orderedPlacementPairs` and then
submits, with the same length check as before standing in for the disabled
button:

```ts
const pairs = orderedPlacementPairs(placementDraft, nominatedVertex)
if (pairs.length !== placementPairs) return
await placeStart(game.id, pairs)
```

## Deploy

Checked 2026-09-09 via the REST API — four games in `initial_placement`, all at
`step: 'settlement'`, **none at `pick_last`**. Re-check immediately before
deploying:

```sql
select game_id, phase from game_states
where phase->>'kind' = 'initial_placement' and phase->>'step' = 'pick_last';
```

If a row exists, wait it out (the step lasts as long as one player takes to tap
twice) — deploying over it strands that game with no action that can finish it.

**Deploy the edge function first, then ship the client.** The order matters and
this direction is safe:

- _New server, old client:_ the old client drafts in tap order and sends
  `place_start` with no nomination. The new server grants on the second pair —
  which is the pair the player drafted second. They lose the ability to switch,
  nothing breaks.
- _Old server, new client:_ the new client's reordered submission would land
  the game in `pick_last`, which the new client has no UI for. So the client
  must not go out first.

## Checks and docs

- `dev/check-catan-placement.ts` — delete the `swapPlacementPairs` and
  `ownSettlementVertices` cases. Add `orderedPlacementPairs` (nominated pair
  last, roads travel with their settlements, input untouched, half-drafted pair
  dropped) and the reordering property: for every non-adjacent settlement pair
  on a real board, the server's pair-by-pair validation agrees in both orders —
  run against a `youth`-cursed seat, where plenty of pairs are illegal, so the
  check isn't vacuous.
- `lib/catan/CLAUDE.md` — rewrite the `placement.ts` bullet and replace the
  `pick_last` sub-phase note with the in-draft nomination.
- `lib/game/CLAUDE.md` / `lib/game/hud/CLAUDE.md` — check for `pick_last`
  mentions; the zones themselves don't change.
- `.claude/specs/last-settlement-choice.md` and
  `.claude/specs/combined-placement-step.md` — superseded notes at the top of
  each pointing here (the second's "locked decision 1: `pick_last` stays as it
  is" is exactly what this reverses).
- `npm run check` + `npm run format`; `npx tsx dev/check-catan-placement.ts`.
- Manual: a 3-player game — the double seat's four-piece draft, switching the
  nomination and confirming, then checking the log and the granted hand match
  the ring that was dark. Plus an undo from `ready` and a re-place, to confirm
  the nomination falls back.

## Out of scope

- Any change to how the other `N-1` seats place.
- Recording the nomination on `GameState` (pair order in the log is the record).
- The `post_placement` transition.
