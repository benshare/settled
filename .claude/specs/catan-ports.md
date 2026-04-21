# Catan — ports (harbors) + bank trades

Follows `catan-trade.md` (player-to-player). Adds:

1. Static port structure on the board (9 ports, 4 generic 3:1 + 5 resource-specific 2:1).
2. Randomized placement on coastal edges at game start.
3. Port visuals on the board (docks + icon).
4. Per-player "which ports can I use" derivation (settlement/city at either endpoint of the port edge).
5. Bank trades: 4:1 baseline, 3:1 via generic port, 2:1 via specific port.

## Scope

In scope:

- `lib/catan/board.ts` — static coastal data: `COASTAL_EDGES` (18 entries), `PORT_SLOTS` (9 edges chosen in the canonical alternating pattern; used as the deterministic base for the variant), `PORT_KINDS` (`['3:1', 'brick', 'wood', 'sheep', 'wheat', 'ore']`).
- `lib/catan/types.ts` — add `Port` type and `ports: Port[]` to `GameState`.
- `lib/catan/generate.ts` — shuffle port kinds across `PORT_SLOTS`, return `ports` on `initialGameState`. Board position is standard; port _type_ per slot is randomized. (Decision 1.)
- `lib/catan/ports.ts` (new) — pure helpers:
    - `playerPortKinds(state, playerIdx) → Set<PortKind>`
    - `availableBankOptions(state, playerIdx) → PortKind[]` — each owned 2:1 port, plus `'3:1'` if owned, plus a sentinel `'4:1'`. Used to drive the step-1 selector.
    - `ratioOf(kind) → 2 | 3 | 4` — `'2:1-*' → 2`, `'3:1' → 3`, `'4:1' → 4`.
    - `isValidBankTradeShape(give, receive, kind)` — see below.
    - `applyBankTradeToPlayer(players, idx, give, receive)`.
- `lib/catan/layout.ts` — `computePortLayout(boardLayout, ports)` returns, per port, the water-side anchor point + the two dock endpoint vertices, used by the renderer.
- `lib/catan/PortBadge.tsx` (new) — SVG group: a small rounded rectangle on the water side of the coastal edge with the port label (e.g. `3:1`, `2:1 🪵`) and two thin "dock" lines to the two endpoint vertices. Color-coded by resource (use `resourceColor`) or neutral for `3:1`.
- `lib/catan/BoardView.tsx` — render `PortBadge` for each port on top of hex tiles but beneath vertex/edge pieces.
- `lib/catan/TradePanel.tsx` — add a "Trade with bank" button under the heading. When bank-mode is on:
    - If multiple ratio options exist, show a step-1 picker listing each option (chips: "2:1 wood", "3:1 generic", "4:1 bank", …).
    - Step 2: give/receive rows of tap-to-add chips. Give chip disabled when player has `< ratio` of that resource remaining. For 2:1 kinds, only the matching give resource is tappable. Receive chip disabled when `sum(receive) === sum(give) / ratio` (all groups spent) or when it would equal the give resource.
    - Reset button clears step-2 composition. Back button returns to step-1 (if shown).
    - Send fires `bank_trade`.
- `supabase/functions/game-service/index.ts` — new action `bank_trade`. Rule re-implementations for coastal edges, ports array initialization, port-kind derivation, bank ratio lookup. Also: include `ports` in seeded `game_states.state`.
- `lib/stores/useGamesStore.ts` — `bankTrade(gameId, give, receive)` wrapper. Extend `GameEvent` with `{ kind: 'bank_trade', player, give, receive, ratio, at }`.
- `app/game/[id].tsx` — no structural change; `TradePanel` grows a mode toggle but the action-bar slot is unchanged.
- `dev/check-catan-ports.ts` — dev checks for helpers and coastal/port data shape.

Out of scope:

- Changing port _positions_ per-game (positions stay at the canonical 9 slots; only _kinds_ are shuffled — see open question 2).
- Port upgrades / leader-based port bonuses.
- Bank-trade counter-offers or approvals (bank trades are one-shot, instant).
- Animation of port badges, port zoom-in detail, or tap-to-inspect.
- Changing visuals of water hexes (we don't model water hexes as tiles; ports live on the coastal edges of land hexes).

## Locked decisions

1. **Port positions are fixed.** The canonical 9 `PORT_SLOTS` are the same every game. Only port _kinds_ are shuffled across those slots.
2. **`PORT_SLOTS` choice.** The 9 canonical slots are every-other-edge walking the outer ring clockwise from `1A`'s top edge. I'll enumerate the 18 in `board.ts` and pick 9 myself.
3. **Bank trade grammar — two-step flow.**
    - **Step 1 (ratio selection):** when the user opens bank trade, if they have access to more than one ratio (e.g., a 2:1 port + the 4:1 bank), show a small selector listing each available option (one per 2:1 specific port, one for 3:1 generic port if owned, always 4:1). If only 4:1 is available, skip the selector and go directly to step 2.
    - **Step 2 (give/receive composition):**
        - Each `give` resource chip is tap-to-add: tapping adds N copies (N = selected ratio). Tapping again adds another N. Chips are disabled when the player's hand has `< N` remaining of that resource.
        - For 2:1 specific ports: only the matching resource is tappable (all others disabled).
        - For 3:1 and 4:1: any resource is tappable.
        - Each `receive` resource chip is tap-to-add-one. Receive side is disabled when `total receive units === total give units / ratio` (i.e. they've "spent" all give groups). Can't receive the same resource as the give-side (no same-resource swap).
        - A "Reset" (or similar) resets the in-progress composition. A "Back" control returns to step 1 (if a selector was shown).
        - Send button enabled iff at least one group selected on each side, hands affordable.
4. **UI entry.** Inside the existing `TradePanel` (which today is just player trading), add a "Trade with bank" button under the panel's current heading area. Tapping it enters bank-mode (step 1 or step 2 as above). When in bank mode, a back/cancel returns to the player-trade default.
5. **When allowed.** Only the current main-phase player, `phase.kind === 'main'`, only for resources the player can afford.
6. **Visibility.** All players see all ports (positions + kinds).
7. **Port access.** Derived on read — `playerPortKinds(state, idx)`. No caching.
8. **Events.** Append one `bank_trade` event per trade.
9. **Starting-resource grant.** Ports don't grant starting resources during second-round placement.
10. **Render order.** PortBadges render above hex tiles, below edges / vertices / robber.
11. **Visual style.** Small rounded-rect badge on the water-side of the coastal edge; label `3:1` or `2:1`; resource-colored accent dot on 2:1 variants; two thin docks from edge midpoint to endpoint vertices.
12. **Water side.** Computed geometrically — no sea hexes are modeled. Outward direction = midpoint minus the adjacent land-hex center, normalized.
13. **Migration.** No migration; old games keep `ports` missing (treated as empty). Only new games get ports. User will clear existing games.

## Data shapes

```ts
// lib/catan/board.ts
export const PORT_KINDS = [
	'3:1',
	'brick',
	'wood',
	'sheep',
	'wheat',
	'ore',
] as const
export type PortKind = (typeof PORT_KINDS)[number]

// 18 coastal edges, walking the outer ring clockwise starting from the
// top edge of hex 1A. Exported as readonly tuple so tests can snapshot
// the ordering. To be filled in after verifying adjacency.
export const COASTAL_EDGES: readonly Edge[] = [
	/* 18 entries */
]

// 9 canonical port slots — every other edge from COASTAL_EDGES (offset 0).
export const PORT_SLOTS: readonly Edge[] = [
	/* 9 entries */
]

// Standard kind distribution: 4 × '3:1' + 1 each of 5 resources.
export const STANDARD_PORT_KINDS: readonly PortKind[] = [
	'3:1',
	'3:1',
	'3:1',
	'3:1',
	'brick',
	'wood',
	'sheep',
	'wheat',
	'ore',
]
```

```ts
// lib/catan/types.ts additions
export type Port = { edge: Edge; kind: PortKind }

export type GameState = {
	// ... existing ...
	ports: Port[]
}
```

`generate.ts` — `initialGameState`:

```ts
const kinds = shuffle([...STANDARD_PORT_KINDS])
const ports: Port[] = PORT_SLOTS.map((edge, i) => ({ edge, kind: kinds[i] }))
// ...
return { ..., ports }
```

## `lib/catan/ports.ts` — outline

```ts
import { edgeEndpoints, RESOURCES, type Resource } from './board'
import type {
	GameState,
	PlayerState,
	Port,
	PortKind,
	ResourceHand,
} from './types'
import { vertexStateOf } from './types'

// Which port kinds are accessible to a player via their occupied vertices.
export function playerPortKinds(
	state: GameState,
	playerIdx: number
): Set<PortKind> {
	const out = new Set<PortKind>()
	for (const p of state.ports) {
		const [a, b] = edgeEndpoints(p.edge)
		for (const v of [a, b]) {
			const vs = vertexStateOf(state, v)
			if (vs.occupied && vs.player === playerIdx) {
				out.add(p.kind)
				break
			}
		}
	}
	return out
}

// Best ratio a player has for a given resource (2, 3, or 4).
export function bestBankRatio(
	state: GameState,
	playerIdx: number,
	resource: Resource
): 2 | 3 | 4 {
	const kinds = playerPortKinds(state, playerIdx)
	if (kinds.has(resource)) return 2
	if (kinds.has('3:1')) return 3
	return 4
}

// A bank trade is multi-group: each give resource amount must be a multiple
// of `ratio`; sum(give) === ratio × sum(receive); give/receive are
// non-overlapping; at least one group traded. For 2:1 specific ports, only
// the matching resource can appear on `give`.
export function isValidBankTradeShape(
	give: ResourceHand,
	receive: ResourceHand,
	kind: BankKind // '2:1-brick' | '2:1-wood' | ... | '3:1' | '4:1'
): boolean {
	const ratio = ratioOf(kind)
	let giveTotal = 0
	let receiveTotal = 0
	for (const r of RESOURCES) {
		if (give[r] < 0 || receive[r] < 0) return false
		if (give[r] > 0 && receive[r] > 0) return false
		if (give[r] % ratio !== 0) return false
		if (kind.startsWith('2:1-') && give[r] > 0) {
			const only = kind.slice(4) as Resource
			if (r !== only) return false
		}
		giveTotal += give[r]
		receiveTotal += receive[r]
	}
	return giveTotal > 0 && giveTotal === ratio * receiveTotal
}

export function applyBankTradeToPlayer(
	players: PlayerState[],
	idx: number,
	give: ResourceHand,
	receive: ResourceHand
): PlayerState[]
```

## Layout — `computePortLayout`

```ts
export type PortVisual = {
	port: Port
	// Midpoint of the coastal edge (where the dock lines start).
	anchor: { x: number; y: number }
	// Where the badge sits (outside the land, on the water side).
	badge: { x: number; y: number }
	// Two vertex endpoint coordinates (for drawing the docks).
	docks: [{ x: number; y: number }, { x: number; y: number }]
}

export function computePortLayout(
	layout: BoardLayout,
	ports: Port[]
): PortVisual[]
```

Geometry: `badge = edgeMidpoint + outwardUnit * (~0.6 × s)`. `outwardUnit` is the unit vector from the adjacent land hex's center to the edge midpoint, away from land. Since each coastal edge has exactly one adjacent land hex, resolution is unambiguous.

## `PortBadge.tsx` — outline

```tsx
export function PortBadge({ visual }: { visual: PortVisual }) {
	const { port, anchor, badge, docks } = visual
	return (
		<G>
			<Line
				x1={anchor.x}
				y1={anchor.y}
				x2={docks[0].x}
				y2={docks[0].y}
				stroke="#666"
				strokeWidth={1.5}
			/>
			<Line
				x1={anchor.x}
				y1={anchor.y}
				x2={docks[1].x}
				y2={docks[1].y}
				stroke="#666"
				strokeWidth={1.5}
			/>
			<Rect
				x={badge.x - w / 2}
				y={badge.y - h / 2}
				width={w}
				height={h}
				rx={r}
				fill="white"
				stroke={strokeColor(port.kind)}
			/>
			<Text
				x={badge.x}
				y={badge.y}
				textAnchor="middle"
				alignmentBaseline="central"
			>
				{port.kind === '3:1' ? '3:1' : '2:1'}
			</Text>
			{port.kind !== '3:1' && (
				<Circle
					cx={badge.x + dx}
					cy={badge.y}
					r={3}
					fill={resourceColor[port.kind]}
				/>
			)}
		</G>
	)
}
```

## Edge function — new action

### `bank_trade`

Body: `{ action: 'bank_trade', game_id, give: ResourceHand, receive: ResourceHand }`.

1. Load. 404 / 403 / 400 as usual.
2. Caller must be `player_order[current_turn]`. 403 otherwise.
3. `status === 'active'` and `phase.kind === 'main'`. 400 otherwise.
4. Determine the give-resource (exactly one resource with positive count). 400 if zero or >1.
5. `ratio = bestBankRatio(state, meIdx, giveResource)`.
6. `isValidBankTradeShape(give, receive, ratio)`. 400 otherwise.
7. `canAfford(meHand, give)`. 400 otherwise.
8. Apply swap to `state.players[meIdx]`.
9. Append event `{ kind: 'bank_trade', player: meIdx, give, receive, ratio, at: now }`.
10. Return `{ ok: true, ratio }`.

Bank is not a player; no opponent state changes.

### `initial_state` (generation)

Update to seed `ports` using the randomized shuffle across `PORT_SLOTS`.

## Store additions

```ts
type GamesStore =
	| {
			// ... existing ...
			bankTrade: (
				gameId: string,
				give: ResourceHand,
				receive: ResourceHand
			) => Promise<ActionResult & { ratio?: 2 | 3 | 4 }>
	  }

	// GameEvent addition:
	| {
			kind: 'bank_trade'
			player: number
			give: ResourceHand
			receive: ResourceHand
			ratio: 2 | 3 | 4
			at: string
	  }
```

## UI — TradePanel mode toggle

- Top-of-panel pill: `[ Player | Bank ]`, default `Player`.
- Bank mode:
    - Hide the "to" chip row.
    - Give: tapping a resource auto-fills its count to the best ratio (pre-computed from `bestBankRatio`); subsequent `+` taps are disabled (fixed ratio). Only one resource can be non-zero at a time.
    - Receive: tapping a resource sets its count to 1 and disables `+` (fixed single unit). Only one resource can be non-zero.
    - Disabling rules: `Send` enabled iff exactly one give + one receive (different resources) + can afford.
    - `Send` → calls `bankTrade` store method.
- Resource chips show a small `2:1` / `3:1` / `4:1` badge below them (the player's best ratio for that resource).

## Dev checks (`dev/check-catan-ports.ts`)

1. `COASTAL_EDGES` length 18; all entries in `EDGES`; each edge adjacent to exactly one land hex.
2. `PORT_SLOTS` length 9; all ∈ `COASTAL_EDGES`; alternating spacing (no two chosen edges share a vertex on the coastal path).
3. `STANDARD_PORT_KINDS` length 9; 4×'3:1', 1 of each resource.
4. `playerPortKinds`: occupied vertex at endpoint of a port edge → kind in set; occupied elsewhere → absent.
5. `bestBankRatio`: 2 when matching specific port; 3 when only generic; 4 when no ports.
6. `isValidBankTradeShape`: reject multi-give; reject wrong ratio; reject same-resource swap; accept canonical.
7. `applyBankTradeToPlayer`: hand decreases by give, increases by receive; other players unchanged.

## Verification checklist (phase 2 done when all green)

- [ ] `COASTAL_EDGES`, `PORT_SLOTS`, `STANDARD_PORT_KINDS` exported from `board.ts`.
- [ ] `Port` type + `ports: Port[]` on `GameState`.
- [ ] `initialGameState` seeds `ports` with shuffled kinds across `PORT_SLOTS`.
- [ ] `lib/catan/ports.ts` exports helpers and passes dev checks.
- [ ] Port layout (`computePortLayout`) + `PortBadge` render on board.
- [ ] Existing boards without `ports` in state don't crash (migration strategy: TBD — see open question 13 below).
- [ ] `TradePanel` has Bank mode; valid bank trades submit and update hand.
- [ ] Edge function `bank_trade` validates and updates atomically.
- [ ] Store wrapper + `GameEvent` variant.
- [ ] `dev/check-catan-ports.ts` green.
- [ ] `npm run check` + `npm run format`.
- [ ] Smoke test: new game → confirm 9 ports visible, kinds randomized between two runs. Place a settlement adjacent to the wood 2:1 port → bank trade 2 wood → 1 brick succeeds. Without that port → 4 wood → 1 brick succeeds, 2 wood → 1 brick rejected.

## Open question 13 — migration

Existing in-progress games in the DB won't have `ports` on their state. Options:

- (a) Ignore; treat missing as empty (no ports) for old games; new games get ports.
- (b) Write a one-shot migration script that seeds `ports` for existing active games (deterministic from board hash? or randomized?).

Default (a). Confirm.

## Follow-ups (not this spec)

- Fully randomized port positions (choose 9 of 18 coastal edges each game with alternating constraint).
- Explicit sea hex tiles for visual polish.
- Port inspector modal / tap-to-see-ratios UI.
- Multi-unit bank trades if user prefers that grammar (open question 3).
