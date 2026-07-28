# Choosing which starting settlement was placed "last"

In real Catan the player who goes last in round 1 places **both** of their
starting settlements back-to-back, so nothing forces one to be "first". They may
legitimately treat either as their second settlement — the one that pays out
starting resources.

Today the app hard-codes it: the round-2 settlement grants, the round-1 one
doesn't. This spec adds a pick step so that player places both pairs as normal
and then nominates which settlement was placed **last**; that one grants the
starting resources, and the event log is rewritten so the chosen order is what
the log shows.

Everyone else is unaffected — a turn from another player sits between their two
placements, so their order is not theirs to choose.

## 1. Who this applies to

Snake order is round 1 = `0 … N-1`, round 2 = `N-1 … 0`. Only **seat `N-1`**
places twice in a row (last of round 1, first of round 2). So:

- The pick belongs to seat `N-1` only, in every game size (N ≥ 2).
- It fires in the **middle** of the placement sequence — after seat `N-1`'s
  round-2 road, before seat `N-2`'s round-2 settlement. It has nothing to do
  with the end-of-placement transition (`placement_complete`, `post_placement`,
  `status='active'`), which stays exactly where it is (seat 0's round-2 road).

### Skipped for an aristocrat

`grantsStartingResourcesOnRound` gives an **aristocrat** the grant on round 1
_and_ round 2, so both of their settlements pay out and there is nothing to
choose. For an aristocrat in seat `N-1` the flow is unchanged: both grants land
at placement time, no pick step, no log rewrite.

Not skipped for anything else — including the case where both settlements would
grant an identical hand. The prompt is cheap and a silent skip reads as a bug.

## 2. Flow

```
seat N-1, round 1:  settlement A → road a       (no grant, as today)
seat N-1, round 2:  settlement B → road b       (grant DEFERRED, unlike today)
                          ↓
              step: 'pick_last'  —  "which did you place last?"
                          ↓
              grant starting resources for the chosen vertex
              (+ nomad desert rolls, if any)
              rewrite the event log if they chose A
                          ↓
seat N-2, round 2:  settlement → road …
```

The only behavioural change to the placements themselves is that for a
non-aristocrat seat `N-1`, `place_settlement` on round 2 **does not** grant.

## 3. State — a third placement step

`Phase` in `lib/catan/types.ts` (mirrored in the edge function):

```ts
| { kind: 'initial_placement'; round: 1 | 2; step: 'settlement' | 'road' | 'pick_last' }
```

`pick_last` is only ever reachable with `round: 2` and
`games.current_turn === N-1`. `games.status` stays `'placement'` throughout — no
column or migration changes anywhere; `phase` is jsonb.

Nothing records the outcome on `GameState`: the grant is applied to the player's
hand and the log is rewritten, which together are the whole persisted record.

## 4. Rules — `lib/catan/placement.ts`

Three additions, all pure (and all mirrored into the edge function per the
standing duplication rule):

```ts
// Seat N-1 is the only one that places both settlements back-to-back, so it
// is the only one that gets to nominate which was placed last.
export function isDoublePlacementSeat(
	playerIdx: number,
	playerCount: number
): boolean

// The player's own settlement vertices during initial placement (ghosts
// excluded — haunt spots don't exist yet, but the guard keeps the helper
// honest if that ever changes).
export function ownSettlementVertices(
	state: GameState,
	playerIdx: number
): Vertex[]

// The log rewrite (§6). Typed against `unknown[]` because its only caller is
// the edge function, which handles `games.events` loosely — it lives here
// rather than inline in the function so the check script can exercise it, the
// same arrangement `honk.ts` uses for its events-derived rules.
export function swapPlacementPairs(
	events: readonly unknown[],
	playerIdx: number
): unknown[]
```

`startingResourcesForVertex`, `nextPlacementTurn`, `targetSettlement` and the
validity helpers are untouched — the pick step reuses `startingResourcesForVertex`
and hands off to the existing `nextPlacementTurn(2, N-1, N)`.

## 5. Edge function

### `handlePlaceSettlement`

The grant condition changes from

```ts
if (round === 2 || myBonus === 'aristocrat')
```

to the same thing **minus the deferred case**: skip the grant when
`round === 2 && myBonus !== 'aristocrat' && isDoublePlacementSeat(meIdx, N)`.
Everything else (vertex write, `settlement_placed` event, `nomad_produce`
events, the phase → `'road'`) is unchanged. Nomad's desert rolls ride the grant,
so they move with it.

### `handlePlaceRoad`

After the road is written, when
`round === 2 && isDoublePlacementSeat(meIdx, N) && myBonus !== 'aristocrat'`,
write `phase = { kind: 'initial_placement', round: 2, step: 'pick_last' }` and
leave `games.current_turn` on `meIdx` instead of calling `nextPlacementTurn`.
The `road_placed` event is appended as normal. No notification is sent — the
player who must act is the one who just acted.

Otherwise the handler behaves exactly as it does today.

### New action `choose_last_settlement`

Body: `{ action: 'choose_last_settlement', game_id: string, vertex: string }`.

Validation:

- `games.status === 'placement'`, `phase.kind === 'initial_placement'`,
  `phase.step === 'pick_last'` — else 400.
- caller is a participant and `games.current_turn === meIdx` — else 403.
- `vertex` is one of the caller's own occupied settlements
  (`ownSettlementVertices`) — else 400 `'not your settlement'`.

Effects, in one `game_states` update + one `games` update (the established
two-write pattern):

1. **Grant.** `startingResourcesForVertex(state, vertex)` added to the caller's
   hand, plus nomad's `d5` per adjacent desert hex with a `nomad_produce` event
   each — the same block `handlePlaceSettlement` runs today, lifted into a
   shared local helper so the two can't drift.
2. **Phase advance.** `nextPlacementTurn(2, meIdx, N)` → always
   `{ round: 2, currentTurn: meIdx - 1 }` for N ≥ 2, so this never hits the
   end-of-placement branch. Phase becomes
   `{ kind: 'initial_placement', round: 2, step: 'settlement' }` and
   `current_turn` moves on. The "next player" push notification fires here,
   same call as in `handlePlaceRoad`.
3. **Log rewrite** (below), if the chosen vertex is the round-1 one.

Not undoable: `place_settlement` / `place_road` already aren't (see
`.claude/specs/undo.md` §1), and this is part of the same sequence. It joins
that exclusion list, and — like every non-undoable action — clears
`game_states.undo`.

### Deploy-window guard

A game sitting between seat `N-1`'s round-2 settlement and its road at the
moment `npm run edge` lands was granted under the old code. Offering it the
pick would either double the grant or leave the log disagreeing with the hand,
so `handlePlaceRoad` skips `pick_last` entirely when the seat's hand is already
non-empty and falls through to the old flow. During initial placement a
non-aristocrat seat has no other way to hold cards, so the condition is exact
rather than heuristic. Documented at the call site.

## 6. Event-log rewrite

Requested explicitly: the chosen order is what the log should show. Seat `N-1`'s
four placement events are consecutive in `games.events`:

```
i    settlement_placed  player N-1  vertex A  round 1
i+1  road_placed        player N-1  edge a    round 1
i+2  settlement_placed  player N-1  vertex B  round 2
i+3  road_placed        player N-1  edge b    round 2
```

If the caller nominates **B** (the round-2 settlement) nothing changes — that is
already the recorded order. If they nominate **A**, swap the two
(settlement, road) **pairs**: exchange `vertex` between the two
`settlement_placed` events and `edge` between the two `road_placed` events,
leaving `round` and `at` in place. A road is always incident to the settlement
it was placed from, so swapping the payloads pairwise keeps each road with its
settlement and keeps timestamps monotonic.

The events are located by scanning `games.events` backwards for the last two
`settlement_placed` and last two `road_placed` entries with
`player === meIdx` — not by index arithmetic, so an unrelated event landing in
between can't corrupt the rewrite. If either pair isn't found (a legacy game, a
manually edited log) the rewrite is skipped and the grant still applies.

Implemented as `swapPlacementPairs` in `lib/catan/placement.ts` and mirrored in
the edge function, which is the only caller.

No new event kind, no change to `GameEvent`, and `ActionLog` / `gameStats` need
no changes — they read the same shapes in the same order.

## 7. Client

### Store — `lib/stores/useGamesStore.ts`

```ts
chooseLastSettlement: (gameId: string, vertex: string) => Promise<ActionResult>
```

A thin invoke wrapper matching `placeSettlement` / `placeRoad`, error message
propagated per the error rule.

### Board — `lib/catan/PlacementLayer.tsx`

A third branch for `step === 'pick_last'`, rendered only for the acting seat
(`meIdx` is `-1` for a spectator and `ownSettlementVertices` is empty for
everyone else, so the branch self-gates):

- Both of the player's settlements get a **ring** around the piece rather than
  a dot on top of it — a filled `PulsingDot` would cover the very thing being
  pointed at. `PulsingRing` is added alongside `PulsingDot` in
  `PulsingDot.tsx`, sharing its clock so rings and dots breathe together.
- The selected one swaps the pulse for a static ring of the same radius, so
  "chosen" reads as settled rather than still-asking. Both are drawn in
  `pieceStroke` (the piece outline colour) so they read against the player's
  own colour underneath.
- A transparent `Circle` hit target over each, calling
  `onSelect({ kind: 'settlement', vertex })` — the existing
  `PlacementSelection` type covers this with no change.
- The round-2 settlement is **pre-selected**, so confirming without touching
  anything reproduces today's behaviour and the change costs the common case
  nothing. Seeded in `gameScreenContext` by the same `placementKey` effect
  that otherwise clears `selection`, from `roundTwoSettlementOf(events, meIdx)`
  — the seat's `settlement_placed` event carrying `round: 2`. It has to come
  from the log: once both roads are down, the board no longer distinguishes
  the two settlements.

`BoardArea` needs no change: it already passes `selection` / `setSelection`
into the placement interaction whenever `inPlacement && isMyPlacementTurn`.

### Bars

- `lib/game/TopArea.tsx` → `PlacementHeader`: for `pick_last`, "Your turn —
  choose the settlement you placed last" / "Waiting for {name} to choose their
  starting settlement". The existing `prefix(step)` string-building only covers
  `'settlement' | 'road'`, so the step branch is lifted out of it.
- `lib/game/TopArea.tsx` → `spectatorStatus`: the `initial_placement` case
  becomes step-aware — `"{name} is choosing their starting settlement"` for
  `pick_last`, unchanged otherwise. (It currently interpolates `phase.step`
  directly, which would read "placing a pick_last".)
- `lib/game/BottomArea.tsx` → `confirmLabel`: "Confirm starting settlement" for
  `pick_last` (a selection is always present there, given the pre-select), with
  "Tap the settlement you placed last" as the empty-selection fallback.

### Handler — `lib/game/gameScreenContext.tsx`

`onConfirm` branches on the phase step: `pick_last` calls
`chooseLastSettlement(game.id, selection.vertex)` instead of
`placeSettlement` / `placeRoad`; failure notifies with the propagated message,
success clears the selection. `placementKey` already includes `phase.step`, so
the selection resets across the step boundary for free.

## 8. Checks and docs

- `dev/check-catan-placement.ts` — cases for `isDoublePlacementSeat` (true only
  for `N-1`, and equal to the seat the snake order repeats),
  `ownSettlementVertices` (both of the seat's settlements, none of anyone
  else's, ghosts excluded), and `swapPlacementPairs` (pairs trade payloads,
  other seats' events and all `round`/`at` fields stay put, the input isn't
  mutated, the swap is an involution, an incomplete log is left alone).
- `lib/catan/CLAUDE.md` — extend the `placement.ts` bullet and note the
  `pick_last` step alongside the other sub-phase notes.
- `lib/game/CLAUDE.md` — no structural change; the pick reuses the existing
  placement zones.
- `npm run check` + `npm run format` before commit; `npm run edge` to deploy
  (nothing works until the function ships — the client alone can't grant).

## 9. Out of scope

- Any change to how the other N-1 seats place.
- A record on `GameState` of which settlement was nominated.
- Letting the choice affect anything beyond the starting-resource grant
  (longest road, ports, populist pips etc. all read the board, which is
  identical either way).
