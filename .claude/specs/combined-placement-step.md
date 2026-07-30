# Combined placement step

During initial placement, a settlement and its road are chosen as **one
frontend step** and submitted in **one backend update**. The seat that places
both of its settlements back-to-back (seat `N-1`) chooses all four pieces —
settlement, road, settlement, road — in one step, still one backend update.

Today each piece is its own round-trip: tap a vertex → Confirm →
`place_settlement` → phase advances to `step: 'road'` → tap an edge → Confirm →
`place_road`. That is two server writes, two realtime broadcasts and two
re-renders for what a player experiences as one move, and it makes the
settlement uncancellable the moment it lands.

## Locked decisions (confirmed with user)

1. **`pick_last` stays as it is** — a separate step with its own backend call,
   entered after the double seat's combined four-piece submission. It is
   pre-seeded with the round-2 settlement exactly as today, so an untouched
   confirm reproduces the standard rule. The combined flow does _not_ make the
   nomination implicit in tap order.
2. **Undo is one tap back, not a wipe.** An `UndoButton` beside the placement
   Confirm pops the most recent piece: a chosen road returns to road-picking, a
   chosen settlement returns to settlement-picking. Repeatable through all four
   pieces for the double seat. It is local state only — nothing has been sent
   yet, so there is nothing server-side to undo.
3. **The per-piece handlers stay.** `place_settlement` / `place_road` remain in
   the edge function so a game already sitting at `step: 'road'` when this
   deploys can finish its turn, and so the timeout auto-skip sweep
   (`autoActionFor`) keeps working piece-by-piece with no changes.

## Scope

- `supabase/functions/game-service/index.ts` — new `place_start` action; two
  extractions so the new handler shares logic with the old ones rather than
  copying it.
- `lib/catan/placement.ts` — `applyPlacementDraft` (pure local simulation, so
  the client can compute pair 2's valid spots against pair 1) and
  `placementPairsExpected`.
- `lib/catan/PlacementLayer.tsx` — draft rendering: ghosts for everything
  chosen so far, dots for the current stage.
- `lib/catan/BoardView.tsx` — the `interaction` prop gains the draft.
- `lib/game/gameScreenContext.tsx` — draft state, stage derivation, tap
  handlers, undo, rewritten `onConfirm`.
- `lib/game/BottomArea.tsx` — undo button + stage-aware confirm label.
- `lib/game/TopArea.tsx` — `PlacementHeader` wording.
- `lib/stores/useGamesStore.ts` — `placeStart(gameId, pairs)`.
- `dev/check-catan-placement.ts` — cases for the two new pure helpers.

Out of scope: the `pick_last` step's rules and UI (unchanged), the
`post_placement` transition (unchanged), the timeout sweep (unchanged), any
change to the `initial_placement` phase shape or to the event log's shape.

## Server — `place_start`

```ts
type PlaceStartBody = {
	action: 'place_start'
	game_id: string
	placements: { vertex: string; edge: string }[] // 1 pair, or 2 for seat N-1
}
```

Rejects unless: `games.status === 'placement'`, `phase.kind ===
'initial_placement'`, **`phase.step === 'settlement'`** (a legacy game at
`'road'` uses `place_road`), and the caller is `current_turn`.

`placements.length` must equal `placementPairsExpected(round, meIdx, N)` — 2
when `round === 1 && isDoublePlacementSeat(meIdx, N)`, else 1. An exact match
rather than "1 or 2" so a client that miscounts fails loudly instead of half
placing a turn.

Each pair is validated and applied against the **working state** carrying the
previous pair, so pair 2's settlement respects pair 1's distance footprint and
its road is checked against pair 2's settlement:

```
for each pair, in order:
  round_i   = first pair ? phase.round : 2       // the double seat's 2nd pair is round 2
  validate  isValidSettlementVertex(working, vertex, meIdx)
  apply     settlement (placedTurn: state.round)
  validate  isValidRoadEdge(working, meIdx, edge)
  apply     road (placedTurn: state.round)
  grant     per the existing rule for round_i (below)
  log       settlement_placed{round: round_i}, road_placed{round: round_i}, + nomad events
```

The grant rule is unchanged and stays in `applyStartingGrant`: granted on a
round-2 settlement, or on **either** settlement for an aristocrat, and
**deferred** to `pick_last` for a non-aristocrat double seat. Stamping
`round: 1` / `round: 2` per pair is load-bearing — `roundTwoSettlementOf` and
`swapPlacementPairs` both read it, so `pick_last` keeps working untouched.

Turn advance, after all pairs are applied:

- Double seat, non-aristocrat, round 1 submission → `step: 'pick_last'`,
  `current_turn` held. No notification (the actor is the one who must act next).
- Otherwise → `nextPlacementTurn(round_last, meIdx, N)`. `null` means the last
  road of the game: the existing end-of-placement transition runs (status
  `active`, `current_turn: 0`, `post_placement` or `roll`, `placement_complete`
  event). Non-null: advance `current_turn`, `step: 'settlement'`, notify.

Three extractions in the edge function so the combined path is not a third copy:

- `placeSettlementPiece(state, meIdx, round, vertex, playerCount)` and
  `placeRoadPiece(state, meIdx, round, edge)` → `{ state, events }` or
  `{ error }`. Each validates against the state it is handed — which is what
  lets `place_start` apply a second pair on top of the first — and the
  settlement one owns `applyStartingGrant` and the defer test.
  `handlePlaceSettlement` / `handlePlaceRoad` are refactored onto them.
- `endOfPlacementPhase(state)` → the `post_placement`-or-`roll` Phase
  previously computed inline in `handlePlaceRoad`.

Everything else about the handler follows the existing ones: one `game_states`
update, one `games` update, `EdgeRuntime.waitUntil` for notifications.
`place_start` is **not** added to `UNDOABLE_ACTIONS` — placement never was
undoable server-side, and the whole point here is that undo happens before
anything is sent.

## Pure rules — `lib/catan/placement.ts`

```ts
export type PlacementDraftEntry = { vertex: Vertex; edge?: Edge }

// Local simulation of a partly-chosen placement turn, so validity for a later
// piece is computed against the earlier ones. Never persisted.
export function applyPlacementDraft(
	state: GameState,
	playerIdx: number,
	draft: readonly PlacementDraftEntry[]
): GameState

// 2 for the seat that places both settlements back-to-back, on its round-1
// turn; 1 otherwise. Mirrored in the edge function.
export function placementPairsExpected(
	round: 1 | 2,
	playerIdx: number,
	playerCount: number
): 1 | 2
```

`applyPlacementDraft` writes sparse entries only (the storage convention) and
stamps `placedTurn: state.round`, matching what the server will write.

## Client flow

State on `gameScreenContext`: `placementDraft: PlacementDraftEntry[]`,
alongside the existing `selection` — which now serves **only** the two
single-selection steps (`pick_last`, and the legacy `'road'` step). Both reset
on the existing `placementKey` change; `pick_last` still opens pre-seeded.

Derived `placementStage`, for `step === 'settlement'` on my turn:

| draft                             | stage        |
| --------------------------------- | ------------ |
| last entry has no `edge`          | `road`       |
| entries < expected                | `settlement` |
| entries === expected (all roaded) | `ready`      |

- Tapping a valid vertex appends `{ vertex }`; tapping a valid edge sets
  `edge` on the last entry.
- Undo pops: an entry with an `edge` loses the edge; an entry without one is
  removed. Shown whenever the draft is non-empty.
- Confirm is enabled only at `ready`, and calls `placeStart(game.id, pairs)`.
  The two legacy steps keep calling `placeRoad` / `chooseLastSettlement`.

`PlacementLayer` renders, for the draft step: a half-opacity `VertexPiece` /
`EdgePiece` ghost for every piece chosen so far, plus `PulsingDot` + hit
targets for the current stage — `validSettlementVertices` /
`validRoadEdges` evaluated against `applyPlacementDraft(state, meIdx, draft)`.
At `ready` it shows ghosts only. Its `pick_last` and single-road branches are
unchanged.

Copy:

- Confirm button: `Tap a spot to place settlement` → `Tap an edge to place
road` → `Confirm settlement and road`. Double seat: `…place your second
settlement` / `…second road` → `Confirm both placements`.
- `PlacementHeader`, my turn: `Your turn — place a settlement` / `…place a
road` / `Your turn — confirm your placements`.
- `PlacementHeader`, watching: `Waiting for X to place a settlement and road`
  — the sub-stage is local to the actor, so nobody else can see it. For the
  double seat's combined turn: `…to place both their settlements and roads`.

## Consequences worth knowing

- **A placement turn is one realtime broadcast instead of two.** Other clients
  see the settlement and road appear together; the intermediate
  `step: 'road'` state no longer exists for new games.
- **`phase.step` is `'settlement'` for the whole of a new game's placement.**
  `'road'` survives only for games mid-turn at deploy time and for the timeout
  sweep's piece-by-piece auto-actions. Anything reading `step` to describe what
  the table is waiting on must not assume it names the actor's current stage.
- **The double seat's four pieces land in one write**, so its round-1 and
  round-2 events share a timestamp ordering but keep distinct `round` stamps —
  which is exactly what `pick_last`'s log rewrite needs.

## Cleanup, later

The per-piece flow is kept only for turns that were already half-placed. It can
go once nothing can be sitting in one — but **in this order**, because the
timeout sweep is itself a producer of that state:

1. **Move the sweep onto `place_start` first.** `autoActionFor`'s
   `initial_placement` case picks a settlement and returns, leaving the game at
   `step: 'road'` for the next sweep to finish. Replace it with one action that
   picks a random valid settlement, applies it with `applyPlacementDraft`, then
   picks a random valid road from the result — two pairs when
   `placementPairsExpected` says so. Until this lands, a skipped seat keeps
   minting exactly the state we're waiting to see the end of.
2. **Confirm no game is left at that step**, allowing for a turn in flight:

    ```sql
    select g.id, g.status, g.created_at, g.deadline_at
    from games g
    join game_states s on s.game_id = g.id
    where g.status = 'placement'
      and s.phase->>'kind' = 'initial_placement'
      and s.phase->>'step' = 'road';
    ```

    Zero rows, and no client old enough to send `place_settlement` still in the
    wild (the action is only reachable from a build that predates this change —
    check the oldest OTA/native version still in use before deciding).

    Snapshot at the time this shipped (2026-07-30): three games in
    `placement` — `66328d5b` (2 seats) and `9ce26e45` (3 seats) both at
    `round 1, step: 'settlement'`, and `7db0bfb5` still in `select_bonus`.
    **None at `'road'`**, so nothing was stranded by the change itself; the
    wait is for step 1 above and for old clients to age out.

3. **Then delete:**
    - `place_settlement` / `place_road` — body types, `Body` union entries,
      handlers, dispatcher cases, and the two bullets in the file's header
      comment. `placeSettlementPiece` / `placeRoadPiece` stay: `place_start`
      is built on them.
    - `placeRoad` in `lib/stores/useGamesStore.ts` (type + implementation).
    - The `step === 'road'` branch in `PlacementLayer` — and with it
      `RoadSpots`' `selected` param, which the surviving caller only ever
      passes `null`.
    - `placementDrafting` in `gameScreenContext.tsx`: with one flow left it is
      always true, so `placementStage` collapses to the draft derivation and
      `onConfirm`'s third branch goes. `selection` narrows to `pick_last`
      only, so it can become `Vertex | null`.
    - The `'road'` cases in `confirmLabel` (`BottomArea`), `PlacementHeader`,
      and `spectatorStatus` (`TopArea`) — including `confirmLabel`'s
      `drafted === 0` legacy test.
    - `'road'` from the `initial_placement` step union in `types.ts` and its
      edge mirror, which is what makes the compiler find anything missed.

Nothing else reads the step: `pendingSeats` switches on `phase.kind`, and the
event log's shape never distinguished the two flows.

## Verification

- `npx tsx dev/check-catan-placement.ts` — new cases: `applyPlacementDraft`
  blocks a second settlement adjacent to the first, and its road validity is
  scoped to the second settlement; `placementPairsExpected` returns 2 only for
  seat `N-1` in round 1.
- `npm run check` (includes `deno check` on the edge function).
- Manual: a 3-player game through both rounds — undo at each stage, the double
  seat's four-piece turn, then `pick_last`.
