# Catan — player-to-player trades

Follows `catan-building.md`. Adds proposer-initiated resource trades between players during the main phase. Only player-to-player this pass — bank 4:1 and port ratios stay deferred.

## Scope

In scope:

- `lib/catan/trade.ts` (new) — pure helpers:
    - `TradeOffer` type, `newTradeId()`, `canProposeTrade(hand, give, receive, to)`, `canAcceptTrade(hand, offer)`, validity of give/receive shapes (non-empty, non-overlapping).
    - `applyTrade(state, offer, accepterIdx)` — returns next `players[]` with the swap applied.
- `lib/catan/TradePanel.tsx` (new) — the trade-form UI that takes over the action-bar slot when open. Rows for give / receive (per-resource ± steppers gated by your hand for `give`), "to" selector (chips per other player, "All" toggle), Send / Cancel buttons.
- `lib/catan/TradeOffers.tsx` (new) — horizontal strip of open-trade cards above the action bar. Each card shows proposer name + colors + `give → receive` resource chips + either Accept (if you're addressed & can afford) or Cancel (if you proposed) or disabled.
- `lib/catan/types.ts` — add `trades: TradeOffer[]` to `GameState`. Lives inside `game_states.phase`? No — on `GameState` top-level, because active trades survive across `phase.kind === 'main'` re-entries. Wait, they don't — trades always clear on end_turn. Even so, cleaner as a separate field than crammed onto `Phase`.
- `supabase/functions/game-service/index.ts` — three new actions: `propose_trade`, `accept_trade`, `cancel_trade`. Plus the duplicated trade rules. Plus: `end_turn` clears the leaving player's open trades.
- `lib/stores/useGamesStore.ts` — `proposeTrade`, `acceptTrade`, `cancelTrade` wrappers. Extend `GameEvent`.
- `app/game/[id].tsx` — action-bar mode state (`main` | `trade`). Opening Trade panel hides MainLoopBar; closing returns to MainLoopBar. Render `TradeOffers` strip above the action bar.
- `dev/check-catan-trade.ts` — dev checks for the helpers.

Out of scope:

- Bank 4:1 and port ratios (separate follow-up).
- Counter-offers. To counter, you cancel and propose a new one.
- Free-form notes / messaging.
- Auto-decline / decline action. If you don't want to accept, just don't.
- Optimistic UI. Trades round-trip through the edge function.

## Open questions — need user input

1. **Who can propose.** Default: only the current main-phase player (standard Catan). Other players can't propose. Confirm, or allow anyone at any time?
2. **"To" selector shape.** Default: chips per other player, default-all-selected. An "All" master toggle. Confirm. (Alternative: radio between "All" and "one specific player" — simpler but less flexible.)
3. **Auto-expire on end_turn.** Default: when the current player ends their turn, any trade they proposed that's still open is silently cleared. Confirm.
4. **Validation:**
    - Give must have at least one resource > 0 AND receive must have at least one resource > 0.
    - Give and receive must not share any non-zero resource (no wheat-for-wheat).
    - Proposer must have the `give` resources **at propose time** (cheap filter; also re-checked at accept).
    - Accepter must have `receive` resources at accept time.
    - First accept wins. After accept, the offer's `status` flips to `accepted` and stays visible in the strip until proposer ends turn (so both sides see what happened).
5. **Multiple concurrent offers** from the same proposer: allowed, no dedup.
6. **Storage:** `GameState.trades: TradeOffer[]` (top-level field). Cleared on `end_turn`.
7. **Events:** `trade_proposed`, `trade_accepted`, `trade_canceled`. Default: yes, append each.
8. **Addressees** — does the `to` list gate accept server-side? Default: yes. If `to` is empty (or all), anyone can accept; otherwise only listed player indices.
9. **Rendering when no trades are open:** `TradeOffers` returns null (no row). Confirm (as opposed to a persistent placeholder).

## Data shapes

```ts
// lib/catan/types.ts additions
export type TradeOffer = {
	id: string
	from: number // player idx
	to: number[] // empty = all players (except proposer)
	give: ResourceHand
	receive: ResourceHand
	status: 'open' | 'accepted' | 'canceled'
	acceptedBy?: number
	createdAt: string
}

export type GameState = {
	// ... existing ...
	trades: TradeOffer[]
}
```

`generate.ts` — `initialGameState` returns `trades: []`.

## `lib/catan/trade.ts` — outline

```ts
import { RESOURCES, type Resource } from './board'
import type { ResourceHand, TradeOffer } from './types'

export function emptyHand(): ResourceHand

export function handIsEmpty(h: ResourceHand): boolean

// Give/receive share no resource type; at least one of each > 0.
export function isValidTradeShape(
	give: ResourceHand,
	receive: ResourceHand
): boolean

export function canAfford(hand: ResourceHand, cost: ResourceHand): boolean
// (re-export or duplicate from build.ts — kept in trade.ts so consumers don't
// pull in build.ts just for this. Alternatively, import from build.)

export function canAcceptTrade(hand: ResourceHand, offer: TradeOffer): boolean {
	return offer.status === 'open' && canAfford(hand, offer.receive)
}

// Players array after a trade executes between from and accepter.
// Caller has already validated affordability on both sides.
export function applyTradeToPlayers(
	players: PlayerState[],
	fromIdx: number,
	toIdx: number,
	give: ResourceHand,
	receive: ResourceHand
): PlayerState[]

export function newTradeId(): string // random 8-char id
```

## Edge function — new actions + end_turn tweak

### `propose_trade`

Body: `{ action: 'propose_trade', game_id, give, receive, to }` where `give`/`receive` are `ResourceHand`s and `to` is `number[]` (empty = all other players).

1. Load. 404 / 403 / 400 as usual.
2. Caller must be `player_order[current_turn]`. 403 otherwise.
3. `status === 'active'` and `phase.kind === 'main'`. 400 otherwise.
4. `isValidTradeShape(give, receive)` (non-empty, non-overlapping). 400 otherwise.
5. `canAfford(proposerHand, give)` at current state. 400 otherwise.
6. `to` contains only valid player indices (0..N-1) and excludes the proposer. 400 otherwise.
7. Build `offer = { id: newTradeId(), from: meIdx, to, give, receive, status: 'open', createdAt: now }`.
8. Append to `game_states.trades`. Append event `{ kind: 'trade_proposed', offer_id, from, to, give, receive, at }`.
9. Return `{ ok: true, offer_id: offer.id }`.

### `accept_trade`

Body: `{ action: 'accept_trade', game_id, offer_id }`.

1. Load. Find offer by id in `state.trades`. 404 if missing.
2. Offer must be `status === 'open'`. 400 otherwise.
3. Caller must be in `offer.to` (or `offer.to` is empty). Caller must not be `offer.from`. 403 otherwise.
4. `canAfford(state.players[fromIdx].resources, offer.give)`. 400 if no longer true.
5. `canAfford(state.players[meIdx].resources, offer.receive)`. 400 if not.
6. Apply swap; update `state.players`; flip offer `status='accepted', acceptedBy: meIdx`.
7. Event `{ kind: 'trade_accepted', offer_id, from, to: meIdx, at }`.
8. Return `{ ok: true }`.

### `cancel_trade`

Body: `{ action: 'cancel_trade', game_id, offer_id }`.

1. Load. Find offer. 404 if missing.
2. Caller must be `offer.from`. 403 otherwise.
3. Offer must be `open`. 400 otherwise.
4. Flip `status='canceled'`. Event `trade_canceled`.
5. Return `{ ok: true }`.

### `end_turn` — add one step

Before building the state update, also clear open trades proposed by the leaving player (`trades.filter(t => !(t.from === meIdx && t.status === 'open'))`). Don't log per-trade cancellation events — just clear silently. Accepted offers remain visible for record, but — since they sit on `game_states` not `games.events` — they'll clear once the next player ends their turn the same way. Hmm. Simpler: **on `end_turn`, clear the entire `trades` array.** No per-turn residue. Confirm this choice.

## Store additions

```ts
type GamesStore =
	| {
			// ... existing ...
			proposeTrade: (
				gameId: string,
				give: ResourceHand,
				receive: ResourceHand,
				to: number[]
			) => Promise<ActionResult & { offerId?: string }>
			acceptTrade: (
				gameId: string,
				offerId: string
			) => Promise<ActionResult>
			cancelTrade: (
				gameId: string,
				offerId: string
			) => Promise<ActionResult>
	  }

	// GameEvent additions:
	| {
			kind: 'trade_proposed'
			offer_id: string
			from: number
			to: number[]
			give: ResourceHand
			receive: ResourceHand
			at: string
	  }
	| {
			kind: 'trade_accepted'
			offer_id: string
			from: number
			to: number
			at: string
	  }
	| { kind: 'trade_canceled'; offer_id: string; from: number; at: string }
```

## UI — action-bar mode

New state:

```ts
const [actionMode, setActionMode] = useState<'main' | 'trade'>('main')
```

Switching:

- `BuildTradeBar` trade panel: tap it → `setActionMode('trade')`. When trade panel is open, `BuildTradeBar` shows Trade as active (same X-badge treatment as active build icons); tapping the X closes the trade panel.
- When the trade panel is closed (Cancel/Send success), `setActionMode('main')`.
- When trade panel is open, hide the `MainLoopBar` (it's replaced by the `TradePanel`). The PlayerStrip and BuildTradeBar stay visible above.
- Enter / exit also clears any selected build tool.

TradePanel shape:

```
+---------------------------------------------------+
| You give                                          |
|   [wood −  0  +] [wheat −  0  +] ... (5 rows)     |
| You receive                                       |
|   [wood −  0  +] [wheat −  0  +] ... (5 rows)     |
| To: [ All ]  [Alice]  [Bob]  [Carol]              |
| [Cancel]                              [Send]      |
+---------------------------------------------------+
```

- `give` stepper's `+` disabled when you don't have another of that resource.
- `give` and `receive` `+` disabled when shape becomes invalid (overlap).
- `Send` enabled iff shape valid + can afford + at least one addressee.
- "All" chip toggles all others on/off; individual chips default selected.

`BuildTradeBar` Trade panel:

- Make it tappable (previously greyed permanently). Enabled iff it's my turn and `phase.kind === 'main'`.
- When active (trade panel open), same X-badge treatment as a build tool; tap again or tap the big panel closes it.

## UI — TradeOffers strip

Render above the action bar, only when there are offers with status !== 'canceled' (show `open` and `accepted` — accepted stay visible as a record until turn ends).

Each card:

- 2 narrow columns of resource chips (give on top, receive below, or side-by-side with a ↔ separator).
- Proposer's color bar or avatar + name on one side.
- Button on the right:
    - `Cancel` if I'm the proposer & status=open.
    - `Accept` if I'm in `to` (or to-all) & status=open & I can afford.
    - Disabled / faded if neither.
    - Greyed "Accepted by {name}" label if status=accepted.

Horizontal scroll if there are many; up to ~3 fit without scroll on typical phones.

## Dev checks (`dev/check-catan-trade.ts`)

1. `isValidTradeShape`: empty give → false; overlapping (wood-for-wood) → false; one-for-one → true.
2. `canAcceptTrade`: accepter lacks a resource → false; has it + status=open → true.
3. `applyTradeToPlayers`: proposer hand decreases by give, increases by receive; accepter hand mirror.
4. `newTradeId`: returns distinct ids on repeated calls (small sample size).

## Verification checklist (phase 2 done when all green)

- [ ] `lib/catan/trade.ts` exports helpers.
- [ ] `TradePanel` + `TradeOffers` render and gate correctly.
- [ ] BuildTradeBar's Trade panel is tappable, shows X when active.
- [ ] Edge function `propose_trade` / `accept_trade` / `cancel_trade` validate and update atomically.
- [ ] `end_turn` clears the full `trades` array.
- [ ] Store wrappers + `GameEvent` variants.
- [ ] Game screen: action-bar mode state, mutually exclusive with build tool.
- [ ] `dev/check-catan-trade.ts` green.
- [ ] `npm run check` + `npm run format`.
- [ ] Smoke test: 2-player game, P0 proposes a trade, P1 accepts; check hands swap; verify decline-by-inaction (P1 doesn't accept, P0 ends turn → trades array empty).

## Follow-ups (not this spec)

- Bank 4:1.
- Ports (2:1 / 3:1).
- Counter-offers.
- Decline action (recipient actively rejects without canceling the whole offer; matters when there are multiple recipients).
- Trade UI polish (animations, accept toasts).
