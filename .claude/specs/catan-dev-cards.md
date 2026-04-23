# Catan — development cards

Follows `catan-robber.md`, `catan-building.md`, `catan-trade.md`, and `catan-ports.md`. Adds the five standard Catan development cards (Knight, Victory Point, Road Building, Year of Plenty, Monopoly) as a buyable + playable card type. Ships behind a `devCards` config flag, parallel to `bonuses`.

Classic Catan rules throughout: finite 25-card deck, can't play on turn bought, one non-VP card played per turn, Largest Army bonus, VP cards hidden from opponents, and dev cards can be played **before** the dice roll.

Patterns after bonuses (card data in `lib/catan/devCards.ts`, rules in `lib/catan/dev.ts`) and the robber chain (new sub-phases with a `resume` pointer for returning to the original phase).

## Locked decisions (confirmed with user)

1. **Cards in v1: all 5 classic.** Knight, Victory Point, Road Building, Year of Plenty, Monopoly.
2. **Finite shuffled deck.** 25 cards: 14 knight / 5 VP / 2 road_building / 2 year_of_plenty / 2 monopoly. Shuffle seeded by the edge function (via `crypto.getRandomValues`). Top of deck = index 0.
3. **Can't play on turn bought.** Enforced by tagging each entry with `purchasedTurn`; playable only when `purchasedTurn < state.round`.
4. **Max 1 non-VP card per turn.** Tracked via `playedDevThisTurn` on `PlayerState`. VP cards are passive and don't consume the slot.
5. **Pre-roll dev play allowed.** Active player in `roll` phase may also `play_dev_card`. After the effect resolves, the phase returns to `roll` (dice not yet thrown). Implemented via a `resume: ResumePhase` field on the effect sub-phases — see data model.
6. **Largest Army** awards +2 VP for ≥3 played knights with strict majority. Ties keep the current holder.
7. **VP cards are hidden.** `dev_bought` events log no card id. `dev_played` logs id + payload only for non-VP plays. VP totals flow through `totalVP()`, but opponents can't reconstruct them from the event feed alone. Final reveal happens on `game_over` (follow-up spec).
8. **Config-flag gated: `config.devCards: boolean`.** Default false. Migrates `GameConfig` + `DEFAULT_CONFIG` + `propose_game` RPC + `handleRespond`, matching the bonuses pattern.
9. **Sub-phases carry a `resume` pointer.** Instead of separate "pre-roll" variants, the existing `move_robber`/`steal` variants gain `resume: ResumePhase` so a knight played during `roll` returns to `roll`, while a 7-roll-triggered robber or a main-phase knight returns to `main`. Same pattern for the new `road_building` variant. This supersedes the `roll: DiceRoll` field on `move_robber`/`steal` (the roll lives inside `resume` when applicable).
10. **Road Building card is consumed on play.** If the player has fewer than 2 legal placements, the remaining placement is forfeited; no cancel button.
11. **No bank supply cap.** We don't track resource supply anywhere else (roll/distribute doesn't either), so Year of Plenty + Monopoly can hand out arbitrary totals.
12. **Monopoly / YoP payload and event detail is public.** Events include resource + total. (Matches classic Catan where the play is announced.)
13. **Victory detection stays out.** `totalVP()` is exposed but no game-over transition lands in this spec.

## Scope

In scope:

- `lib/catan/devCards.ts` (new) — `DevCardId` union + `DEV_CARD_POOL` with title/description/icon per card + `DEV_DECK_COMPOSITION` map. Mirrors `bonuses.ts`.
- `lib/catan/dev.ts` (new) — pure rules:
    - `DEV_CARD_COST: ResourceHand` = `{ brick: 0, wood: 0, sheep: 1, wheat: 1, ore: 1 }`.
    - `buildInitialDevDeck(rng: () => number): DevCardId[]` — 25-card shuffled deck. `rng` lets tests inject deterministic shuffles; edge function passes `Math.random` (seeded by platform CSPRNG).
    - `canBuyDevCard(state, meIdx): boolean` — `phase.kind === 'main'`, `current_turn === meIdx`, `devDeck.length > 0`, `canAfford(hand, DEV_CARD_COST)`.
    - `playableCards(player, round): DevCardId[]` — entries with `purchasedTurn < round` and `id !== 'victory_point'`. Deduplicated by id for UI grouping (the hand carries entries individually but the UI shows stacks).
    - `knightsPlayed(player): number` = `player.devCardsPlayed.knight ?? 0`.
    - `recomputeLargestArmy(state): number | null` — returns the player index with strictly most knights played ≥ 3. Ties keep `state.largestArmy` (a read of the current holder).
    - `totalVP(state, playerIdx): number` — settlements + 2 × cities + (2 if holder of `largestArmy`) + VP-card count.
    - `hasLegalRoadPlacement(state, meIdx): boolean` — any `edges` key that would pass the existing road-placement predicate.
- `lib/catan/types.ts` — changes detailed below: new `ResumePhase` type; `move_robber`/`steal`/`road_building` gain `resume`; `PlayerState` gains `devCards` / `devCardsPlayed` / `playedDevThisTurn`; `GameState` gains `devDeck` / `largestArmy` / `round`; `GameConfig` gains `devCards: boolean`.
- `lib/catan/generate.ts` — `initialGameState` seeds `devDeck = buildInitialDevDeck(Math.random)` when `config.devCards`, else `devDeck = []`. Seeds `largestArmy = null`, `round = 0`, per-player `devCards: []`, `devCardsPlayed: {}`, `playedDevThisTurn: false`.
- `lib/catan/BuildTradeBar.tsx` — wire the existing `dev_card` entry (early-return placeholder at line 56) to dispatch `buyDevCard`. Disable on unaffordable cost, empty deck, wrong phase, or not-my-turn. Hide the item entirely when `!config.devCards`.
- `lib/catan/DevCardHand.tsx` (new) — compact fanned display of the viewer's dev cards, rendered in the main HUD next to `ResourceHand`. Grouped by id with stack count. Tapping a stack opens a confirm sheet with title + description + Play button. VP stacks show "worth 1 VP each" and no Play button. Newly-purchased entries show "Available next turn" badge.
- `lib/catan/MonopolyPicker.tsx` / `lib/catan/YearOfPlentyPicker.tsx` (new) — modal resource pickers. Monopoly picks one resource → confirm → dispatch. YoP picks two (duplicates allowed) → confirm → dispatch.
- `lib/stores/useGamesStore.ts` — new wrappers `buyDevCard(gameId)` and `playDevCard(gameId, id, payload?)`. `GameEvent` extended with `dev_bought`, `dev_played`, `largest_army_changed`. `GameConfig.devCards` propagated through `propose_game` callsites (match bonuses).
- `supabase/functions/game-service/index.ts`:
    - New actions: `buy_dev_card`, `play_dev_card`.
    - `build_road` handler: when `phase.kind === 'road_building'`, skip cost check, decrement `remaining`; on 0 restore `phase.resume`.
    - `end_turn` handler: increment `state.round`, reset `playedDevThisTurn` for outgoing active player. (Could reset globally; outgoing-only is sufficient since we only ever read for the active player.)
    - `roll` handler: `phase.kind === 'roll'` unchanged; knight played during roll transitions into `move_robber` with `resume: { kind: 'roll' }`.
    - `move_robber` / `steal` handlers (existing): on completion, transition to `phase.resume` rather than hardcoded `{ kind: 'main', roll }`.
    - Duplicated helpers: `buildInitialDevDeck`, `DEV_CARD_COST`, `canAfford`/`deductHand` already present, `recomputeLargestArmy`, `hasLegalRoadPlacement`, `totalVP`, `DEV_DECK_COMPOSITION`.
    - `propose_game` RPC + `handleRespond`: accept `config.devCards` boolean and forward to `initialGameState`.
- `supabase/migrations/` — **no new migration.** `game_config` JSONB already exists; `devCards` is just another key.
- `app/game/[id].tsx` — render `DevCardHand` in the HUD (viewer's hand). Route `road_building` phase to `BuildLayer` in edge-only mode with a "Placing road N/2" status header. Knight-triggered `move_robber` / `steal` go through the existing `RobberLayer` unchanged.
- `lib/catan/CLAUDE.md` — mention `devCards.ts` + `dev.ts`; note that sub-phases carry `resume: ResumePhase`.
- `dev/check-catan-dev.ts` — unit checks (see list below).

Out of scope:

- Victory-condition check / `game_over` transition. `totalVP` is exposed but unused by this spec.
- Largest Army badge on `PlayerStrip` (event fires, but no visual tracker beyond the VP number). Follow-up.
- Animated card draw / play.
- Private event visibility. YoP + Monopoly events include resource + total publicly.
- Resource-supply tracking for the bank.
- Hiding the deck order from the edge function (deck is opaque to clients; only top card revealed on buy).

## Data model

### `types.ts` diff

```diff
 import type { BonusId, CurseId } from './bonuses'
+import type { DevCardId } from './devCards'

 export type GameConfig = {
     bonuses: boolean
+    devCards: boolean
 }

-export const DEFAULT_CONFIG: GameConfig = { bonuses: false }
+export const DEFAULT_CONFIG: GameConfig = { bonuses: false, devCards: false }

+export type DevCardEntry = {
+    id: DevCardId
+    // Value of `state.round` at time of purchase. Playable once `state.round`
+    // has advanced past this value.
+    purchasedTurn: number
+}

 export type PlayerState = {
     resources: ResourceHand
     bonus?: BonusId
     curse?: CurseId
+    devCards: DevCardEntry[]
+    // Count per id, for Largest Army + stats. Incremented on play.
+    devCardsPlayed: Partial<Record<DevCardId, number>>
+    // Reset on end_turn for the outgoing active player.
+    playedDevThisTurn: boolean
 }

+// Phase to restore after a dev-card effect sub-phase (road_building / knight
+// → move_robber → steal) completes. Knight played pre-roll returns to `roll`;
+// anything triggered from main returns to `main` with its trade snapshot.
+// Also used by the 7-roll robber chain (resume = main).
+export type ResumePhase =
+    | { kind: 'roll' }
+    | { kind: 'main'; roll: DiceRoll; trade: TradeOffer | null }

 export type Phase =
     | { kind: 'select_bonus'; hands: Record<number, SelectBonusHand> }
     | { kind: 'initial_placement'; round: 1 | 2; step: 'settlement' | 'road' }
     | { kind: 'roll' }
     | {
           kind: 'discard'
-          roll: DiceRoll
+          // Discard chain only happens on 7-roll, so resume is always `main`
+          // with the matching dice roll. Kept explicit for symmetry.
+          resume: ResumePhase
           pending: Partial<Record<number, number>>
       }
-    | { kind: 'move_robber'; roll: DiceRoll }
-    | { kind: 'steal'; roll: DiceRoll; hex: Hex; candidates: number[] }
+    | { kind: 'move_robber'; resume: ResumePhase }
+    | { kind: 'steal'; resume: ResumePhase; hex: Hex; candidates: number[] }
+    | { kind: 'road_building'; resume: ResumePhase; remaining: 1 | 2 }
     | { kind: 'main'; roll: DiceRoll; trade: TradeOffer | null }
     | { kind: 'game_over' }

 export type GameState = {
     variant: Variant
     hexes: Record<Hex, HexData>
     vertices: Partial<Record<Vertex, VertexState>>
     edges: Partial<Record<Edge, EdgeState>>
     players: PlayerState[]
     phase: Phase
     robber: Hex
     ports?: Port[]
     config: GameConfig
+    // Top = index 0. Edge function splices from the front on buy. `[]` when
+    // devCards config is off.
+    devDeck: DevCardId[]
+    // Player index holding Largest Army, or null. Recomputed after every knight play.
+    largestArmy: number | null
+    // Monotonic turn counter. Increments on each `end_turn`. Used to enforce
+    // "can't play dev card on turn bought" and to stamp DevCardEntry.purchasedTurn.
+    round: number
 }
```

**Migration of existing `discard` / `move_robber` / `steal` call sites.** The robber spec's edge function already constructs these phases. Updating them to carry `resume` is a mechanical change:

- 7-roll → `{ kind: 'discard' | 'move_robber', resume: { kind: 'main', roll: dice, trade: null } }` (trade is null after a roll anyway).
- `discard` completion → transition to `{ kind: 'move_robber', resume: phase.resume }` (identity).
- `move_robber` completion → `{ kind: 'steal', resume: phase.resume, hex, candidates }` or directly to `phase.resume` when no candidates.
- `steal` completion → `phase.resume`.

### `devCards.ts`

```ts
import type { Ionicons } from '@expo/vector-icons'
import type React from 'react'

type IoniconName = React.ComponentProps<typeof Ionicons>['name']

export type DevCardId =
	| 'knight'
	| 'victory_point'
	| 'road_building'
	| 'year_of_plenty'
	| 'monopoly'

export type DevCard = {
	id: DevCardId
	title: string
	description: string
	icon: IoniconName
}

export const DEV_CARD_POOL: readonly DevCard[] = [
	{
		id: 'knight',
		title: 'Knight',
		description:
			'Move the robber and steal 1 card from an adjacent opponent.',
		icon: 'shield',
	},
	{
		id: 'victory_point',
		title: 'Victory Point',
		description:
			'Worth 1 victory point. Stays hidden in your hand until the game ends.',
		icon: 'trophy',
	},
	{
		id: 'road_building',
		title: 'Road Building',
		description: 'Place 2 free roads.',
		icon: 'git-branch',
	},
	{
		id: 'year_of_plenty',
		title: 'Year of Plenty',
		description:
			'Take any 2 resource cards from the bank (duplicates allowed).',
		icon: 'cafe',
	},
	{
		id: 'monopoly',
		title: 'Monopoly',
		description:
			'Name a resource. Every opponent gives you all of their cards of that type.',
		icon: 'flash',
	},
]

export const DEV_DECK_COMPOSITION: Record<DevCardId, number> = {
	knight: 14,
	victory_point: 5,
	road_building: 2,
	year_of_plenty: 2,
	monopoly: 2,
}

export function devCardById(id: string): DevCard | undefined {
	return DEV_CARD_POOL.find((c) => c.id === id)
}
```

### `dev.ts` — outline

```ts
import type { Resource } from './board'
import { canAfford, deductHand } from './build'
import { DEV_CARD_POOL, DEV_DECK_COMPOSITION, type DevCardId } from './devCards'
import {
	vertexStateOf,
	type GameState,
	type PlayerState,
	type ResourceHand,
} from './types'

export const DEV_CARD_COST: ResourceHand = {
	brick: 0,
	wood: 0,
	sheep: 1,
	wheat: 1,
	ore: 1,
}

export function buildInitialDevDeck(rng: () => number): DevCardId[] {
	const deck: DevCardId[] = []
	for (const card of DEV_CARD_POOL) {
		const n = DEV_DECK_COMPOSITION[card.id]
		for (let i = 0; i < n; i++) deck.push(card.id)
	}
	// Fisher–Yates.
	for (let i = deck.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1))
		;[deck[i], deck[j]] = [deck[j], deck[i]]
	}
	return deck
}

export function canBuyDevCard(
	state: GameState,
	meIdx: number,
	currentTurn: number
): boolean {
	if (state.phase.kind !== 'main') return false
	if (currentTurn !== meIdx) return false
	if (state.devDeck.length === 0) return false
	return canAfford(state.players[meIdx].resources, DEV_CARD_COST)
}

export function knightsPlayed(p: PlayerState): number {
	return p.devCardsPlayed.knight ?? 0
}

export function recomputeLargestArmy(state: GameState): number | null {
	let bestIdx: number | null = null
	let best = 2 // must be strictly > 2 (i.e. ≥ 3) to qualify
	state.players.forEach((p, i) => {
		const k = knightsPlayed(p)
		if (k > best) {
			best = k
			bestIdx = i
		} else if (k === best && state.largestArmy === i) {
			/* holder keeps on tie */
		}
	})
	// If no one reaches 3 knights, return the existing holder (possibly null).
	return bestIdx !== null ? bestIdx : state.largestArmy
}

export function totalVP(state: GameState, playerIdx: number): number {
	const p = state.players[playerIdx]
	let vp = 0
	for (const v of Object.values(state.vertices)) {
		if (v?.occupied && v.player === playerIdx) {
			vp += v.building === 'city' ? 2 : 1
		}
	}
	if (state.largestArmy === playerIdx) vp += 2
	for (const e of p.devCards) {
		if (e.id === 'victory_point') vp += 1
	}
	return vp
}

export function hasLegalRoadPlacement(
	state: GameState,
	meIdx: number
): boolean {
	// Defers to the existing `isValidRoadEdge` predicate from build.ts.
	// Returns true iff any Edge passes that predicate for meIdx.
	// (Implementation: iterate EDGES.)
	// ...
}
```

## Edge function actions

### `buy_dev_card`

Body: `{ action: 'buy_dev_card', game_id }`.

1. Load + validate: `status === 'active'`, `phase.kind === 'main'`, `current_turn === meIdx`, `config.devCards === true`, `devDeck.length > 0`, `canAfford(hand, DEV_CARD_COST)`.
2. `deductHand(state.players[meIdx].resources, DEV_CARD_COST)`.
3. `const card = state.devDeck[0]; state.devDeck = state.devDeck.slice(1);`
4. `state.players[meIdx].devCards.push({ id: card, purchasedTurn: state.round })`.
5. Append event `{ kind: 'dev_bought', player: meIdx, at }`. **No card id.**
6. Write `players`, `devDeck`, append event.
7. Return `{ ok: true }`.

### `play_dev_card`

Body: `{ action: 'play_dev_card', game_id, id: DevCardId, payload?: { r1?: Resource; r2?: Resource; resource?: Resource } }`.

Shared validation:

- `status === 'active'`, `current_turn === meIdx`.
- `phase.kind === 'main' || phase.kind === 'roll'` (pre-roll permitted).
- `id !== 'victory_point'` (400).
- Player has an entry with matching `id` where `purchasedTurn < state.round` (400 otherwise).
- `playedDevThisTurn === false` (400 otherwise).

Shared post-validation:

- Remove the oldest matching entry (splice first match).
- `state.players[meIdx].devCardsPlayed[id] = (prev ?? 0) + 1`.
- `state.players[meIdx].playedDevThisTurn = true`.
- Compute `resume: ResumePhase`:
    - If `phase.kind === 'roll'` → `{ kind: 'roll' }`.
    - If `phase.kind === 'main'` → `{ kind: 'main', roll: phase.roll, trade: phase.trade }`.

Branch on `id`:

**knight**

1. `recomputeLargestArmy(state)`. If owner changed to `meIdx`, append `{ kind: 'largest_army_changed', player: meIdx, at }` and set `state.largestArmy`.
2. Transition to `{ kind: 'move_robber', resume }`.
3. Append `{ kind: 'dev_played', player: meIdx, id: 'knight', at }`.

**road_building**

1. If `hasLegalRoadPlacement(state, meIdx)` is false → skip sub-phase, stay in `resume`, append `dev_played` anyway (card is consumed). No 400 — classic Catan forfeits.
2. Else: transition to `{ kind: 'road_building', resume, remaining: 2 }`.
3. Append `{ kind: 'dev_played', player: meIdx, id: 'road_building', at }`.

**year_of_plenty**
Payload required: `{ r1: Resource, r2: Resource }` (duplicates allowed).

1. Validate r1/r2 ∈ Resource (400 otherwise).
2. `hand[r1] += 1; hand[r2] += 1`.
3. Transition to `resume`.
4. Append `{ kind: 'dev_played', player: meIdx, id: 'year_of_plenty', take: [r1, r2], at }`.

**monopoly**
Payload required: `{ resource: Resource }`.

1. Validate resource ∈ Resource (400 otherwise).
2. `stolen = sum of players[i].resources[resource] for i !== meIdx`. Zero each opponent's `[resource]`. `me[resource] += stolen`.
3. Transition to `resume`.
4. Append `{ kind: 'dev_played', player: meIdx, id: 'monopoly', resource, total: stolen, at }`.

### `build_road` handler — `road_building` awareness

Extend the existing handler: when `phase.kind === 'road_building'`, skip the cost check, decrement `remaining`. If `remaining - 1 === 0` → transition to `phase.resume`; else → `{ kind: 'road_building', resume: phase.resume, remaining: 1 }`.

If after decrement `remaining > 0` but no legal edge remains (`!hasLegalRoadPlacement`), transition to `phase.resume` (forfeit the second road).

### `move_robber` / `steal` handler updates

Replace hardcoded transitions `{ kind: 'main', roll: phase.roll }` with `phase.resume`. The 7-roll branch already constructs a `resume: { kind: 'main', roll: dice, trade: null }` when entering the chain. The knight branch constructs a `resume` matching the triggering phase.

### `end_turn` handler updates

- `state.round += 1`.
- Outgoing active player's `playedDevThisTurn = false`. (Not strictly needed — only read for active player — but keeps state tidy.)

### `roll` handler

No changes to the existing 7-branch / distribute logic, other than the phase-construction tweaks above to thread `resume`.

### Duplicated helpers in edge function

Inline-paste from `dev.ts`: `DEV_CARD_COST`, `buildInitialDevDeck`, `canBuyDevCard`, `knightsPlayed`, `recomputeLargestArmy`, `totalVP`, `hasLegalRoadPlacement`, `DEV_CARD_POOL`, `DEV_DECK_COMPOSITION`. Follows the established "source-of-truth is `lib/catan/`, edge function is the copy" policy in `lib/catan/CLAUDE.md`.

### `propose_game` RPC + `handleRespond`

- Accept `devCards: boolean` in the proposer's config, default false. Forward through to `initialGameState`.
- Parallel to the bonuses wiring landed in `20260422120000_game_config.sql` + matching edge function changes.

## Store additions

```ts
export type GameEvent =
    | ...existing...
    | { kind: 'dev_bought'; player: number; at: string }
    | {
          kind: 'dev_played'
          player: number
          id: Exclude<DevCardId, 'victory_point'>
          // Per-card payload fields folded in (flat shape for simple discriminated events):
          take?: [Resource, Resource]   // year_of_plenty
          resource?: Resource            // monopoly
          total?: number                 // monopoly
          at: string
      }
    | { kind: 'largest_army_changed'; player: number; at: string }

type GamesStore = {
    // ...
    buyDevCard: (gameId: string) => Promise<ActionResult>
    playDevCard: (
        gameId: string,
        id: DevCardId,
        payload?: { r1?: Resource; r2?: Resource; resource?: Resource }
    ) => Promise<ActionResult>
}
```

## UI

### `DevCardHand`

Props: `{ player: PlayerState; round: number; myTurn: boolean; phaseKind: Phase['kind']; onPlay: (id: DevCardId, payload?) => void }`.

- Renders inside the main HUD, next to `ResourceHand`. Grouped by id, each group showing a single compact tile + stack count. Hidden when `player.devCards.length === 0`.
- Tap group → modal sheet with title + description. If the card is unplayable, the reason is shown and the Play button is disabled:
    - VP: "Counts silently toward your score."
    - Purchased this turn: "Available next turn."
    - Already played a dev card this turn: "One dev card per turn."
    - Wrong phase: "Wait for the next turn." (shouldn't render if the surrounding game gates correctly, but defensive.)
- Playing Monopoly or Year of Plenty routes to `MonopolyPicker` / `YearOfPlentyPicker` respectively before dispatching.

### `MonopolyPicker` / `YearOfPlentyPicker`

Full-screen modals with five resource icons (same icons used in `ResourceHand`).

- Monopoly: tap one → confirm → dispatch `playDevCard(id='monopoly', payload={resource})`.
- Year of Plenty: tap two in sequence (duplicates allowed — second tap of same icon increments the counter) → confirm → dispatch `playDevCard(id='year_of_plenty', payload={r1, r2})`.

### Road Building sub-phase

- `BuildLayer` renders in road-only mode. `BuildTradeBar` entries for settlement / city / trade / dev_card / end_turn are hidden or disabled.
- `StatusHeader` shows "Road Building — place road {3-remaining}/2" on active player's turn, "{name} is placing free roads" for spectators.
- No cancel button (card consumed on play).

### Status header branches (additions)

| phase.kind      | my turn (active)                  | other player                |
| --------------- | --------------------------------- | --------------------------- |
| `road_building` | "Place free road {3-remaining}/2" | "{name} is placing 2 roads" |

Knight-triggered `move_robber` / `steal` reuse the headers from `catan-robber.md` — same strings. Pre-roll knight: the pre-roll context is invisible to the user because the robber UI is identical regardless of trigger; status header follows the sub-phase, not the trigger.

### `BuildTradeBar`

- Wire the existing `dev_card` entry (line 56 early-return) to dispatch `buyDevCard`.
- Disabled when `!canBuyDevCard(state, meIdx, currentTurn)`.
- Hidden entirely when `!state.config.devCards`.

### `PlayerStrip` / `PlayerDetailOverlay`

- Add a small "{n} dev cards" label under each player (visible publicly — card count is public, contents are not). Shows each player's `devCards.length`.
- VP number on detail overlay uses `totalVP(state, idx)`, which folds in Largest Army + VP cards. For spectators, VP cards in the viewed player's hand are excluded (to avoid leaking hidden info) — add a `showHiddenVP: boolean` arg to `totalVP` for the self view.

## Dev checks (`dev/check-catan-dev.ts`)

1. `buildInitialDevDeck` with a deterministic `rng` returns 25 cards with exact composition; two different seeds yield different first-card order.
2. `canBuyDevCard`: affordable + main + my turn + non-empty deck → true. Each missing precondition → false.
3. Purchased card's `purchasedTurn === state.round` at buy time; `playableCards` excludes it until `state.round` advances; after end_turn → includes it.
4. One-per-turn: after playing any non-VP card, `playedDevThisTurn` blocks further plays; end_turn clears the flag.
5. Monopoly: 4 opponents holding {2, 3, 0, 1} wheat + me holding 1 → I end with 7, others 0. Event includes `resource: 'wheat', total: 6`.
6. Year of Plenty: `(wheat, sheep)` → +1/+1; `(wheat, wheat)` → +2.
7. Road Building (2 legal placements): after two `build_road` calls in the sub-phase, card is removed from hand and phase returns to `resume`.
8. Road Building (1 legal placement then none): first `build_road` succeeds, sub-phase forfeits and returns to `resume` with card consumed.
9. Road Building (0 legal placements at play time): skips sub-phase, card consumed, `dev_played` logged, phase unchanged.
10. Largest Army: knight counts {3, 2, 2, 2} → holder = 0; holder plays 4th knight → still 0; opponent plays 4th → holder = opponent (strict overtake); opponent ties at 4 → holder unchanged.
11. `totalVP` = settlements + 2·cities + (2 if LA) + VP-card count.
12. Pre-roll knight: from `{ kind: 'roll' }`, play knight → transition to `move_robber` with `resume.kind === 'roll'`. After steal, phase returns to `{ kind: 'roll' }`.
13. 7-roll chain with new `resume` shape: `resume.kind === 'main'` and `resume.roll === dice` throughout discard/move_robber/steal.

## Verification checklist

- [ ] `lib/catan/devCards.ts` + `lib/catan/dev.ts` exist per outline.
- [ ] `types.ts`: `DevCardEntry`, `ResumePhase`, `GameConfig.devCards`, `GameState.devDeck`/`largestArmy`/`round`, new Phase variants/resume threading.
- [ ] `generate.ts`: deck seeded when `config.devCards`, `round = 0`, per-player defaults.
- [ ] `BuildTradeBar`: dev_card wired to `buyDevCard`; gated on canBuyDevCard + config.
- [ ] `DevCardHand`, `MonopolyPicker`, `YearOfPlentyPicker` render.
- [ ] Edge function: `buy_dev_card`, `play_dev_card` implemented; `build_road` aware of `road_building`; `end_turn` increments `round` + clears flag; `move_robber`/`steal` transition to `phase.resume`; `propose_game` accepts `devCards`.
- [ ] Store: `buyDevCard`, `playDevCard`; `GameEvent` extended.
- [ ] `app/game/[id].tsx` routes `road_building` to `BuildLayer` in road-only mode; knight-triggered robber UI reused.
- [ ] `PlayerStrip` / `PlayerDetailOverlay` show dev card count + `totalVP` (hiding VP-card contribution for non-self views).
- [ ] `dev/check-catan-dev.ts` runs green.
- [ ] `npm run check` passes.
- [ ] `npm run format` run.
- [ ] Smoke: create game with `devCards: true`; buy 3 cards; end turn so they become playable; play knight → robber chain → resume main; play road building; play year of plenty; play monopoly; largest army transitions correctly; try to play on buy-turn (blocked); try to play 2 in one turn (blocked); try to play VP (blocked).

## Follow-ups (not this spec)

- Victory-condition check (game_over on `totalVP ≥ 10` on your turn) + reveal VP cards in final event.
- Largest Army badge on `PlayerStrip` (explicit indicator beyond the VP number).
- Private event visibility — hide YoP pick / Monopoly resource from spectators (or show only to involved players).
- Animated card draw + play.
- Resource-supply tracking for the bank (affects YoP + roll distribution).
- Replace edge-function helper duplication with a shared shim (same follow-up as robber spec).
