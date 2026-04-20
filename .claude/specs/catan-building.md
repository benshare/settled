# Catan — main-phase building

Follows `catan-roll-turn.md`. Adds the three build actions (road / settlement / city) to the main phase, with cost deduction, validity checks, button gating, a select-then-tap-then-confirm interaction, and a pulsing highlight of valid spots.

Trade and dev-card are **still** out of scope. The Trade panel and the Dev-card build icon render greyed-out.

## Scope

In scope:

- `lib/catan/build.ts` (new) — pure helpers:
    - `BUILD_COSTS: Record<'road'|'settlement'|'city', ResourceHand>` — the three standard-Catan cost tables.
    - `canAfford(hand, cost)` — cheap hand-comparison.
    - `validBuildRoadEdges(state, playerIdx)` — edges incident to any edge or vertex that the player already owns, filtered to unoccupied edges.
    - `validBuildSettlementVertices(state, playerIdx)` — unoccupied vertices that satisfy the distance rule AND are an endpoint of one of the player's own roads.
    - `validBuildCityVertices(state, playerIdx)` — the set of vertices where the player has a settlement (cities upgrade settlements).
    - `deductHand(hand, cost)` — returns `hand - cost` (caller guaranteed affordability).
- `lib/catan/BuildLayer.tsx` (new) — SVG overlay, analogous to `PlacementLayer`, that highlights valid spots for the currently-selected build tool and surfaces tap targets. Rendered inside `BoardView` when the user is in main-phase build-mode.
- `lib/catan/BuildTradeBar.tsx` — rework to accept `enabled` flags, an active-tool indicator, and an `onSelect` callback. Visual states: disabled (greyed), enabled idle, active (currently-selected tool). Dev-card + Trade are always disabled this pass.
- `supabase/functions/game-service/index.ts` — three new actions: `build_road`, `build_settlement`, `build_city`. Duplicate the build rules + cost tables inline.
- `lib/stores/useGamesStore.ts` — `buildRoad`, `buildSettlement`, `buildCity` wrappers; `GameEvent` extended with `road_built`, `settlement_built`, `city_built`.
- `app/game/[id].tsx` — build-tool state (`null | 'road' | 'settlement' | 'city'`), Alert-based confirm/cancel flow, selection UI in the action bar when a tool is active, tool auto-clear on turn change.
- `dev/check-catan-build.ts` — unit checks for the new helpers.

Out of scope:

- Trade of any form (bank, port, player-to-player). Trade panel stays greyed.
- Dev cards (buy, hold, play). Icon stays greyed.
- Longest-road / largest-army / port mechanics.
- Victory condition (10 VP) check. Wins are a follow-up.
- Resource bank depletion limits (still ignored).
- Optimistic UI — clients wait on realtime like the existing actions.
- Multi-step dialogs / custom confirm modal — using `Alert.alert` for confirm/cancel.

## Locked decisions (confirmed with user)

1. **Build costs = standard Catan.** Road: 1 wood + 1 brick. Settlement: 1 wood + 1 wheat + 1 sheep + 1 brick. City: 2 wheat + 3 ore.
2. **Validity rules = standard Catan, including "no road through opponent settlement".** A road's chain-through-vertex is broken if that vertex holds an opponent's building.
3. **Button enablement:** enabled iff `phase.kind === 'main'` AND it's my turn AND I can afford it AND there is ≥1 valid spot. Both must hold.
4. **Dev-card + Trade:** permanently disabled this pass. No `onPress` handler.
5. **Interaction:** Tap a build icon → board pulses valid spots. Tap a spot → `Alert.alert('Confirm <kind> placement', …, [Cancel, Confirm])`. Confirm fires the edge function and clears the tool. Alert's Cancel returns to the pulsing state with the tool still active. An X badge on the active build icon cancels the tool entirely.
6. **Auto-clear tool** when turn/phase flips away from us.
7. **Alert body = none, title = "Confirm road placement"** (and variants). Keep the prompt terse.
8. **Multiple builds per turn:** no limit.
9. **Confirm dialog uses `Alert.alert`.** Not a custom modal.
10. **Victory check deferred.** No auto-complete on 10 VP this pass.

## `lib/catan/build.ts` — outline

```ts
import {
	EDGES,
	VERTICES,
	adjacentEdges,
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

export type BuildKind = 'road' | 'settlement' | 'city'

export const BUILD_COSTS: Record<BuildKind, ResourceHand> = {
	road: { brick: 1, wood: 1, sheep: 0, wheat: 0, ore: 0 },
	settlement: { brick: 1, wood: 1, sheep: 1, wheat: 1, ore: 0 },
	city: { brick: 0, wood: 0, sheep: 0, wheat: 2, ore: 3 },
}

export function canAfford(hand: ResourceHand, cost: ResourceHand): boolean
export function deductHand(hand: ResourceHand, cost: ResourceHand): ResourceHand

// Edge is unoccupied, and one of its endpoints either has an owned piece
// (settlement/city) OR is adjacent to an owned road.
export function validBuildRoadEdges(state: GameState, playerIdx: number): Edge[]

// Unoccupied vertex, distance rule, AND endpoint of an owned road.
export function validBuildSettlementVertices(
	state: GameState,
	playerIdx: number
): Vertex[]

// Vertices where the player has a settlement.
export function validBuildCityVertices(
	state: GameState,
	playerIdx: number
): Vertex[]
```

## `lib/catan/BuildLayer.tsx` — outline

Analogous to `PlacementLayer`, renders valid-spot pulses + tap targets for the active build tool. Takes:

```ts
type BuildLayerProps = {
	state: GameState
	meIdx: number
	layoutS: number
	vertexPositions: Record<Vertex, { x: number; y: number }>
	tool: 'road' | 'settlement' | 'city' | null
	onSelect: (selection: BuildSelection) => void
}

export type BuildSelection =
	| { kind: 'road'; edge: Edge }
	| { kind: 'settlement'; vertex: Vertex }
	| { kind: 'city'; vertex: Vertex }
```

Renders nothing when `tool === null`. Otherwise pulses the `valid*` set and attaches `onPress` hit targets. Selection goes straight to the Alert confirm flow — no ghost-preview step (that was a placement-only thing). When a hit target fires, it bubbles up to the parent which opens the Alert.

## `BuildTradeBar` rework

```tsx
type Props = {
	// null when not your turn or not in main phase
	active: 'road' | 'settlement' | 'city' | null
	// enabled flags per tool. Dev-card stays false always.
	enabled: Record<'road' | 'settlement' | 'city' | 'dev_card', boolean>
	onSelect: (tool: 'road' | 'settlement' | 'city') => void
	// Tapping the same tool again toggles off.
}
```

Visual treatment:

- disabled: `opacity: 0.4`, no `onPress`.
- enabled idle: normal.
- active: filled/highlighted background + accent border in the player's color.

Trade panel: `opacity: 0.4`, no `onPress`, always.

## Edge function — new actions

Each action body carries `game_id` plus a kind-specific locator (`edge` or `vertex`).

### `build_road`

1. Load `games` + `game_states`. 404 on miss.
2. Caller must be current player. 403.
3. `status === 'active'` and `phase.kind === 'main'`. 400.
4. `edge` is a known Edge. 400.
5. `validBuildRoadEdges(state, meIdx).includes(edge)`. 400.
6. `canAfford(hand, BUILD_COSTS.road)`. 400 if not.
7. Update `game_states`:
    - `edges[edge] = { occupied: true, player: meIdx }`
    - `players[meIdx].resources = deductHand(..., BUILD_COSTS.road)`
8. Append event `{ kind: 'road_built', player, edge, at }`.
9. Return `{ ok: true }`.

### `build_settlement`

Same shape, `vertex` instead of `edge`. Validity uses `validBuildSettlementVertices`. State update writes to `vertices[vertex] = { occupied: true, player, building: 'settlement' }`. Event `{ kind: 'settlement_built', player, vertex, at }`.

### `build_city`

Same shape with `vertex`. Validity uses `validBuildCityVertices` (i.e. the player must own a settlement there). State update writes `vertices[vertex] = { occupied: true, player, building: 'city' }`. Event `{ kind: 'city_built', player, vertex, at }`.

### Duplicated helpers in the edge function

Add inline copies (next to the existing `distributeResources`, `targetSettlement`, etc.):

- `BUILD_COSTS`
- `canAfford`
- `deductHand`
- `validBuildRoadEdges`
- `validBuildSettlementVertices`
- `validBuildCityVertices`

Update `CLAUDE.md` of `lib/catan/` to mention `build.ts`.

## Store additions

```ts
type GamesStore = {
    // ... existing ...
    buildRoad: (gameId: string, edge: string) => Promise<ActionResult>
    buildSettlement: (gameId: string, vertex: string) => Promise<ActionResult>
    buildCity: (gameId: string, vertex: string) => Promise<ActionResult>
}

export type GameEvent =
    | ...existing...
    | { kind: 'road_built'; player: number; edge: string; at: string }
    | { kind: 'settlement_built'; player: number; vertex: string; at: string }
    | { kind: 'city_built'; player: number; vertex: string; at: string }
```

## UI wiring — `app/game/[id].tsx`

Add state:

```ts
const [buildTool, setBuildTool] = useState<BuildKind | null>(null)
```

Clear it on turn/phase change (effect keyed on `current_turn` + `phase.kind`). Clear it on successful build.

Compute:

```ts
const myHand = gameState?.players[meIdx]?.resources
const enabled = {
    road: isMyActiveTurn && phase === 'main' && canAfford(myHand, ROAD) && validBuildRoadEdges(state, me).length > 0,
    settlement: ...,
    city: ...,
    dev_card: false,
}
```

Pass `enabled`, `active: buildTool`, `onSelect` to the reworked `BuildTradeBar`. The `onSelect` toggles `buildTool`; if the same tool is passed, set to null.

Below the board, `BuildLayer` renders when `buildTool !== null`. Its `onSelect(selection)` opens:

```ts
Alert.alert('Build road?', `Place at ${selection.edge}?`, [
	{ text: 'Cancel', style: 'cancel' },
	{ text: 'Confirm', onPress: () => confirmBuild(selection) },
])
```

`confirmBuild` dispatches the right store action, clears `buildTool` on success, shows a generic error Alert on failure.

When `buildTool !== null`, the `MainLoopBar` (the dice+end-turn row) stays visible but the action bar gets an extra "Cancel" button row above End Turn, so the user can escape without having to retap the build icon.

## Dev checks (`dev/check-catan-build.ts`)

1. `canAfford` basic: hand `{ wood: 2, brick: 1, rest 0 }` can afford 1 road; can't afford 2.
2. `deductHand` subtracts correctly.
3. `validBuildRoadEdges`: with a single settlement + one owned road, returns edges that extend off of that road/settlement chain.
4. `validBuildSettlementVertices`: unoccupied, distance-rule-clean, endpoint of owned road — returns a small expected set in a fabricated state.
5. `validBuildCityVertices`: returns exactly the vertices where the player has a settlement.

## Verification checklist (phase 2 done when all green)

- [ ] `lib/catan/build.ts` exports all helpers.
- [ ] `BuildLayer` renders valid-spot pulses, gated on `tool !== null`.
- [ ] Reworked `BuildTradeBar` accepts `active`/`enabled`/`onSelect`.
- [ ] Edge function `build_road`, `build_settlement`, `build_city` validate turn/phase/ownership/resources/spot and update atomically.
- [ ] Store wrappers + `GameEvent` variants added.
- [ ] Game screen: build tool state, Alert confirm flow, cancel path, auto-clear on turn boundary.
- [ ] `dev/check-catan-build.ts` runs green.
- [ ] `npm run check` passes.
- [ ] `npm run format` run.
- [ ] Smoke test: take a 2-player game into main phase, build a road then a settlement with enough hand; confirm the settlement button disables when no connected road is available; confirm trade/dev-card stay greyed.

## Follow-ups (not this spec)

- Victory check: on any write, if a player's VP >= 10, set `games.status = 'complete'` and `games.winner = i`, log `game_complete`.
- Trade: bank 4:1 first, then ports, then player-to-player.
- Dev cards: buy / hold / play.
- Longest road / largest army.
- Block roads through opponent settlements.
- Main-phase undo buffer (undo a build within the same turn before End Turn).
