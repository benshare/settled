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

1. ~~**The nomination is pre-seeded to the settlement drafted second.**~~
   **Revised 2026-09-24 — nothing is pre-seeded and Confirm is blocked on the
   choice.** The pre-seeded version shipped and was then never used: with
   Confirm live from the moment the fourth piece landed, the two rings read as
   decoration and every real game went settlement → road → settlement → road
   → "Confirm both placements" → next player. A default the player never has to
   touch is a choice they never notice.

    So `last-settlement-choice.md` §7's "nothing is pre-selected" is restored,
    and goes further: the confirm button is **disabled** until one of the two
    settlements is tapped. Each drafted settlement carries a numbered badge (1 /
    2, its draft order) — by `ready` both are on the board and nothing else
    distinguishes them, so the question isn't answerable without it. Tapping
    either nominates it; the chosen one fills dark, the other dims but keeps
    pulsing since it stays tappable. This is the one thing in the draft that
    can't be carried past, which is the whole point of it.

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
  both pairs drafted: A badged 1, B badged 2, neither nominated,
  Confirm disabled — tap one to nominate it, tap the other to switch
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
// The settlement the seat nominated as its second. Null until they say — no
// default, because a default is what made this invisible the first time.
const [pickLast, setPickLast] = useState<string | null>(null)

// Self-cleaning: resolved against the draft, so a nomination for a vertex that
// has since been taken back clears itself rather than going stale. Null for
// every seat that doesn't choose, so nothing downstream has to re-ask.
const nominatedVertex = canNominate
	? (placementDraft.find((e) => e.vertex === pickLast)?.vertex ?? null)
	: null

// What blocks Confirm, and what every surface below reads to ask the question.
const needsNomination =
	canNominate && placementStage === 'ready' && nominatedVertex === null
```

`canNominate` — whether the rings show at all:

```ts
canNominate =
	isMyPlacementTurn && placementPairs === 2 && myBonus !== 'aristocrat'
```

`placementStage` loses `'pick_last'` and keeps `settlement | road | ready`.
`ready` is now where the nomination lives, so `canConfirmPlacement` is
`placementStage === 'ready' && !needsNomination`. `onConfirm` re-checks the same
condition, so a stray call can't submit an unnominated draft in tap order.

Reset stays on `placementKey` (which no longer carries a step that changes
mid-turn, but still changes on round/turn).

## Board — `lib/catan/PlacementLayer.tsx`

The `step === 'pick_last'` branch is deleted. Its ring affordance moves into
the draft rendering, where it decorates the **ghosts** rather than placed
pieces:

- At `stage === 'ready'` with `canNominate`, each drafted settlement ghost gets
  a `NominationTarget`: a `PulsingRing`, a numbered badge (its 1-based draft
  order) offset up-right of the piece, and hit targets over both.
- Three visual states, all of them pulsing (a frozen ring reads as disabled,
  and both stay tappable throughout): `open` before any choice — both
  `pieceStroke`, equally live; `chosen` — thicker ring, badge filled
  `pieceStroke` with light text; `other` — `pieceStrokeSoft` throughout.
  Deliberately monochrome rather than seat-colored, so "chosen" reads as the
  darker of the two at every seat color, white included.
- Tapping a target calls `onSelect({ kind: 'settlement', vertex })`, which at
  `ready` sets the nomination instead of appending to the draft.

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
  on, and it's still what gates the badges.

`orderedPlacementPairs` still takes `nominated: Vertex | null` and falls back to
draft order on null. Nothing in the UI reaches it with null any more (Confirm is
blocked first), but the timeout sweep does — see `autoActionFor` below.

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

Every `ready` surface is split on `needsNomination` — the state where the seat
owes the choice and Confirm is disabled.

| Surface                                  | Nomination owed                                                          | Nominated / not applicable            |
| ---------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------- |
| `BottomArea` confirm, `ready`            | `Tap the settlement you placed second` (disabled)                        | `Confirm both placements`             |
| `Dock` confirm, `ready`                  | `Which was second?` (disabled)                                           | `Confirm both`                        |
| `PlacementHeader`, my turn, `ready`      | `Which settlement did you place second? It pays your starting resources` | `Your turn — confirm your placements` |
| `hud/status.ts` `placementLine`, `ready` | `Which settlement did you place second?`                                 | `…placements are ready to confirm`    |
| `PlacementHeader`, watching              | `…to place both their settlements and roads` — unchanged either way      |                                       |
| `spectatorStatus` (`TopArea`)            | `…is placing a settlement and road` — unchanged either way               |                                       |

The disabled confirm button carries the instruction itself rather than sitting
there as an inert `Confirm`: with the button, the header and the status line all
naming the same owed answer, the badges on the board are the only thing that can
supply it.

## Store — `lib/stores/useGamesStore.ts`

`chooseLastSettlement` is deleted. `placeStart` is unchanged in shape — the
ordering happens in `onConfirm`, which calls `orderedPlacementPairs` and then
submits, with the same length check as before standing in for the disabled
button:

```ts
const pairs = orderedPlacementPairs(placementDraft, nominatedVertex)
if (pairs.length !== placementPairs) return
if (needsNomination) return
await placeStart(game.id, pairs)
```

## Deploy

**The 2026-09-24 revision is client-only.** Nothing below it changed — the
nomination still reaches the server as pair order, so an old client (which
pre-seeds and can submit without a tap) and a new one produce the same shape of
`place_start`. Ship it on its own; no edge deploy, no ordering constraint.

The rest of this section is the original `pick_last` removal, kept as the
record of that migration.

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
- Manual: a 3-player game — the double seat's four-piece draft, confirming that
  Confirm is dead until a badge is tapped, switching the nomination, then
  checking the log and the granted hand match the badge that was filled. Plus an
  undo from `ready` and a re-place, to confirm the nomination clears with the
  piece it named.

## Out of scope

- Any change to how the other `N-1` seats place.
- Recording the nomination on `GameState` (pair order in the log is the record).
- The `post_placement` transition.
