# Catan — initial placement flow (logic only)

Second Catan pass, following `catan-state.md`. Implements the initial-placement phase's server-side logic and the client-side helpers for computing valid placement spots — **no UI rendering yet**. A later pass will wire up a hex-board renderer and interactive placement.

At the end of this pass, a player client can call the edge function to place settlements and roads, turn progression works in snake order, starting resources are granted on the second settlement, and the game transitions to `status='active'` / `phase={kind:'roll'}` when the last road is placed.

## Scope

In scope:

- `lib/catan/placement.ts` — pure helpers for computing (a) valid settlement vertices for a given player at the current phase, (b) valid road edges (standard rule: must be incident to the settlement just placed this turn), (c) the "target settlement" a road is being placed from, (d) snake-order turn advance, and (e) post-placement resource grant for a vertex.
- `supabase/functions/game-service/index.ts` — two new actions: `place_settlement`, `place_road`. Validation + atomic update of `games` + `game_states`. Duplicated constants/helpers as needed (per the existing "constants live in both places" convention for the Deno function).
- `lib/stores/useGamesStore.ts` — `placeSettlement(gameId, vertex)` and `placeRoad(gameId, edge)` wrappers that invoke the edge function.
- Event kinds added to `GameEvent` for `settlement_placed`, `road_placed`, and `placement_complete` (logged in `games.events`). No UI for events yet.

Out of scope:

- Board rendering, tap-to-place UI, highlight styling. A follow-up spec wires `app/game/[id].tsx` to use the helpers here.
- Roll/main-phase logic. This pass only transitions into `phase={kind:'roll'}`; the roll action itself is a later pass.
- Undo / cancel-selection. Placements are committed on submit.
- Port/robber/dev-card rules — deferred in `catan-state.md`, still deferred.

## Locked decisions (confirmed with user)

1. **Logic-only pass.** UI lands in a separate commit. Helpers in `lib/catan/placement.ts` are built now so the follow-up UI can consume them.
2. **Second-settlement starting resources = per standard Catan.** When a player's **second** settlement is placed, the player is granted 1 of each adjacent non-desert hex's resource (1, 2, or 3 resources total depending on vertex position). The grant happens atomically in the same `place_settlement` action that places the second settlement.
3. **Road-adjacency = "must touch the just-placed settlement".** The road placed in `step: 'road'` must be an edge incident to the settlement placed earlier in the same player's turn. Client helper returns the ≤3 incident edges; server validates. Derivation rule (see below) pins the "just-placed settlement" from state alone, no new phase fields.
4. **Post-placement transition.** After the last player's second road is placed, in one atomic update: `games.status = 'active'`, `games.current_turn = 0`, `game_states.phase = { kind: 'roll' }`, and an event `placement_complete` is appended.
5. **Snake order.**
    - Round 1: `current_turn` advances 0, 1, ..., N-1 through `player_order`.
    - Round 2: `current_turn` advances N-1, N-2, ..., 0. The last player of round 1 is the first player of round 2 (two consecutive turns, standard Catan).
    - `phase.round` flips 1 → 2 at the moment round 1's last player finishes their road (the turn stays on the same player, only `round` changes).
6. **"Just-placed settlement" is derived, not stored.** For a player `p` during `step: 'road'`: their settlement without any of `p`'s roads on an incident edge. This is unambiguous: in round-1 road step they have 1 settlement + 0 roads, in round-2 road step they have 2 settlements + 1 road (only the round-2 settlement is un-roaded). A helper `targetSettlement(state, playerIdx)` returns it. No change to `Phase` type.
7. **Settlement distance rule.** Standard Catan: a vertex is valid iff (a) itself is unoccupied AND (b) none of its `neighborVertices` are occupied. Applies both rounds.
8. **No port-based validation.** Coastal vertices are equally valid; ports are deferred.
9. **Events.** Append to `games.events jsonb[]`:
    - `{ kind: 'settlement_placed', player: number, vertex: Vertex, round: 1 | 2 }`
    - `{ kind: 'road_placed', player: number, edge: Edge, round: 1 | 2 }`
    - `{ kind: 'placement_complete' }` when the transition to roll fires.
10. **Atomic updates.** Each action does a single `update` on `game_states` (phase + vertices-or-edges + players as needed) plus a single `update` on `games` (current_turn / status / events). Postgres single-row updates are atomic; we accept the tiny window of cross-row inconsistency as the dice-game pattern already does.
11. **Optimistic UI not included.** Clients wait on the server response (realtime then updates descendants). UI pass can layer optimism on top if wanted.
12. **Duplicated Catan constants in the edge function are extended — not deduped.** `adjacentHexes` and `neighborVertices` maps are copied into the edge function. `CLAUDE.md` for `supabase/functions` already documents this trade-off.

## `lib/catan/placement.ts` — outline

All pure functions. No I/O, no realtime, no Supabase. Importable from both client and (if we ever restructure) server.

```ts
import {
    adjacentEdges,
    adjacentHexes,
    edgeEndpoints,
    neighborVertices,
    type Edge,
    type Resource,
    type Vertex,
} from './board'
import {
    edgeStateOf,
    vertexStateOf,
    type GameState,
    type ResourceHand,
} from './types'

// --- Turn info ---------------------------------------------------------------

// For initial_placement only. Returns the player index whose turn it is
// given the snake-ordered round and the 0-indexed position-within-round.
// Not strictly needed outside the edge function, but useful for tests.
export function placementTurnPlayer(
    round: 1 | 2,
    posInRound: number,
    playerCount: number
): number { ... }

// Advance from the current (round, currentTurn) one step in snake order.
// Returns null when the last placement-round turn is complete (caller then
// transitions to phase='roll'). Used by the edge function.
export function nextPlacementTurn(
    round: 1 | 2,
    currentTurn: number,
    playerCount: number
): { round: 1 | 2; currentTurn: number } | null { ... }

// --- Validity helpers --------------------------------------------------------

// Vertex is valid for a new settlement iff unoccupied AND no neighbor occupied.
// Works for round 1 and round 2 (rule is identical during initial placement).
export function isValidSettlementVertex(state: GameState, v: Vertex): boolean { ... }

// All valid settlement vertices given current state. Used by UI to highlight.
export function validSettlementVertices(state: GameState): Vertex[] { ... }

// For a player in step='road': return the settlement they placed earlier
// this turn, i.e. the one without any owned road on an incident edge.
export function targetSettlement(state: GameState, playerIdx: number): Vertex | null { ... }

// Valid road edges = incident to the target settlement, unoccupied.
export function validRoadEdges(state: GameState, playerIdx: number): Edge[] { ... }

export function isValidRoadEdge(
    state: GameState,
    playerIdx: number,
    edge: Edge
): boolean { ... }

// --- Resource grant ----------------------------------------------------------

// Sum of 1-of-each-adjacent-non-desert-resource for a vertex.
// Used when placing the SECOND settlement.
export function startingResourcesForVertex(
    state: GameState,
    vertex: Vertex
): ResourceHand { ... }
```

`ResourceHand` returns `{ wood, wheat, sheep, brick, ore }` with each key 0 unless the vertex touches a hex of that resource (then 1 per touching hex of that resource). A vertex touching two wheat hexes yields `wheat: 2`.

Unit tests — `dev/check-catan-placement.ts` in the same style as `dev/check-catan-board.ts`:

- `validSettlementVertices` on a fresh game returns all 54 vertices.
- After placing a settlement at `'3F'`, its neighbors are excluded from `validSettlementVertices`.
- `targetSettlement` returns correct vertex in round 1 (only settlement) and round 2 (the un-roaded one).
- `validRoadEdges` returns ≤3 edges incident to target settlement.
- `startingResourcesForVertex` on an interior vertex touching 3 resource hexes returns a hand with 3 total resources.
- `nextPlacementTurn` covers round-1→round-2 boundary (same player, round flips), mid-round advance, and end-of-round-2 (returns null).

## Edge function — new actions

Add to `supabase/functions/game-service/index.ts`.

### `place_settlement`

Body: `{ action: 'place_settlement', game_id: string, vertex: Vertex }`

Flow:

1. Load `games` + `game_states` rows for `game_id`. Return 404 if either missing.
2. Caller `me` must be `player_order[games.current_turn]`. Return 403 otherwise.
3. `games.status === 'placement'` and `game_states.phase.kind === 'initial_placement'` and `phase.step === 'settlement'`. Return 400 otherwise.
4. `isValidSettlementVertex(state, vertex)` must be true. Return 400 on invalid.
5. Update `game_states`:
    - `vertices[vertex] = { occupied: true, player: meIdx, building: 'settlement' }`
    - `phase = { kind: 'initial_placement', round, step: 'road' }`
    - **If `round === 2`:** also grant starting resources — `players[meIdx].resources` is incremented by `startingResourcesForVertex(state, vertex)`.
6. Update `games`: append event `{ kind: 'settlement_placed', player: meIdx, vertex, round }`.
7. Return `{ ok: true }`.

### `place_road`

Body: `{ action: 'place_road', game_id: string, edge: Edge }`

Flow:

1. Load rows. 404 if missing.
2. Turn check: caller is `player_order[current_turn]`. 403 otherwise.
3. Status/phase: `status === 'placement'`, `phase.kind === 'initial_placement'`, `phase.step === 'road'`. 400 otherwise.
4. `isValidRoadEdge(state, meIdx, edge)` must be true. 400 on invalid.
5. Compute next turn via `nextPlacementTurn(round, current_turn, playerCount)`:
    - If **not null** (still in placement): update `games.current_turn`, `game_states.phase = { kind: 'initial_placement', round: next.round, step: 'settlement' }`, set the edge in `edges`. Append `{ kind: 'road_placed', player, edge, round }`.
    - If **null** (last road placed): update `games.current_turn = 0`, `games.status = 'active'`, `game_states.phase = { kind: 'roll' }`, set the edge in `edges`. Append two events: `{ kind: 'road_placed', ... }` then `{ kind: 'placement_complete' }`.
6. Return `{ ok: true }`.

### Duplicated constants

Add to the edge function (like `HEXES` / `generateHexes` already):

- `neighborVertices: Record<Vertex, readonly Vertex[]>` — full 54-entry map.
- `adjacentEdges: Record<Vertex, readonly Edge[]>` — full 54-entry map.
- `adjacentHexes: Record<Vertex, readonly Hex[]>` — full 54-entry map.

These are copy-pasted from the compiled output of `lib/catan/board.ts`. To keep them in sync, add a dev script `dev/dump-catan-adjacency.ts` that prints the adjacency-map literals to stdout; the edge function's constants are paste-over-top of whatever this script emits. (Same ergonomic as the existing constants. We accept duplication; the CLAUDE.md for `supabase/functions` already justifies it.)

## Store additions

`lib/stores/useGamesStore.ts` — add two actions:

```ts
type GamesStore = {
	// ... existing ...
	placeSettlement: (gameId: string, vertex: string) => Promise<void>
	placeRoad: (gameId: string, edge: string) => Promise<void>
}
```

Implementation mirrors the dice-game `rollDice` pattern (from git history) — `supabase.functions.invoke('game-service', { body: { action, ... } })`, handle error, rely on realtime to surface the state update.

## Phase type

**No changes.** The existing `Phase` discriminated union is sufficient — the road step's target-settlement derivation does the work.

## Database

**No migration this pass.** Schema from `catan-state.md` covers what we need.

## Game screen (`app/game/[id].tsx`)

**No UI changes this pass.** The screen keeps rendering `"Placing initial settlements and roads…"` and `Phase: {phase.kind}`. The follow-up UI spec will add the board renderer.

One tiny non-UI change: import `targetSettlement` and compute a debug line like `Target: {vertex ?? '-'}` only if we're in placement road step, guarded on `__DEV__`. Skip if it clutters — call it optional.

## Verification checklist (phase 2 done when all green)

- [ ] `lib/catan/placement.ts` exports all helpers listed above.
- [ ] Unit/dev-script coverage for the validity + turn helpers (at minimum the cases listed).
- [ ] Edge function `place_settlement` action: validates turn, phase, vertex; updates state atomically; grants resources on round-2 settlement; logs event.
- [ ] Edge function `place_road` action: validates turn, phase, edge; advances snake order; transitions to `'active'` + `phase='roll'` when last road placed; logs events.
- [ ] Store `placeSettlement` and `placeRoad` actions added and typed.
- [ ] `npm run check` passes.
- [ ] `npm run format` run.
- [ ] Manual smoke test via REST: create a game with 2 test users, run through the 8 placements, assert final `games.status === 'active'`, `phase.kind === 'roll'`, and both players have the expected starting-resource totals.

## Follow-ups (not this spec)

- Board renderer (react-native-svg hex grid, vertex + edge hitboxes).
- Interactive placement UI (tap highlights, confirm/submit).
- Roll action + resource distribution.
- Main-phase actions (build settlement/road/city, trade, end turn).
