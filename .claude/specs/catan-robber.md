# Catan — robber + 7-roll handling

Follows `catan-roll-turn.md` and `catan-building.md`. Implements the robber: a visual on the desert initially, a 7-roll chain that halves oversized hands, lets the active player move the robber to any other hex, and steal a random card from an opponent whose building touches that hex. Also adds the "hex is blocked" check to resource distribution.

Trade and dev cards remain out of scope. Victory-condition checks still deferred.

## Scope

In scope:

- `lib/catan/types.ts` — add `robber: Hex` to `GameState` and three new `Phase` variants: `discard`, `move_robber`, `steal`.
- `lib/catan/generate.ts` — `initialGameState` sets `robber` to the desert hex.
- `lib/catan/roll.ts` — `distributeResources` skips the hex the robber is on. Add exported `blockedHexes(state): Set<Hex>` helper (single element today) for consistency.
- `lib/catan/robber.ts` (new) — pure helpers:
    - `validRobberHexes(state): Hex[]` — all hexes except `state.robber`.
    - `stealCandidates(state, hex, meIdx): number[]` — distinct opponent player indices with a building on `hex` AND at least one resource card. (If they have zero cards, no one can steal from them.)
    - `requiredDiscards(players): Record<number, number>` — per-player half-of-hand for any hand > 7.
    - `isValidDiscardSelection(hand, selection, required)` — sums match required; each `selection[r] ≤ hand[r]`.
- `lib/catan/RobberPiece.tsx` (new) — SVG dark pawn (filled circle + small stroke ring) anchored over a hex center, rendered inside `BoardSvg`.
- `lib/catan/RobberLayer.tsx` (new) — SVG overlay, analogous to `BuildLayer`. Renders pulsing-hex-center targets when phase is `move_robber` and my turn, or pulsing opponent-building targets when phase is `steal` and my turn.
- `lib/catan/DiscardBar.tsx` (new) — inline above-board UI with +/- steppers for each resource, a live `N / target` counter, and a Confirm button.
- `lib/stores/useGamesStore.ts` — three new wrappers: `discard`, `moveRobber`, `steal`. New `GameEvent` variants.
- `supabase/functions/game-service/index.ts` — four new actions (`discard`, `move_robber`, `steal`) plus the 7-roll branch in `roll`. Duplicate the new pure helpers inline.
- `app/game/[id].tsx` — route each new phase to its UI. The board render gains a `<RobberPiece>` and the new `RobberLayer` overlay. The `StatusHeader` switches on phase to show "You rolled 7 — discard N" / "You rolled 7 — move the robber" / "You rolled 7 — steal from …" / "Waiting for X, Y to discard".
- `lib/catan/CLAUDE.md` — mention `robber.ts`.
- `dev/check-catan-robber.ts` — unit checks.

Out of scope:

- Knight dev card (no dev cards yet).
- Discard during the build phase for hand limits not triggered by 7 (doesn't exist in Catan anyway).
- Per-player private event visibility. Events are public but we **do not** include resource types in `discarded`/`stolen` payloads, so no new hand-leak.
- Optimistic UI. Clients wait on realtime, same as other actions.
- Victory-condition check.

## Locked decisions (confirmed with user)

1. **Discard-on-7 included.** Threshold = 8 (hand > 7). Discard = `floor(hand / 2)`.
2. **Discard is parallel.** Any player with an outstanding discard can submit independently. Active player can only move the robber after all outstanding discards are submitted.
3. **Steal event hides the resource.** Only thief + victim are logged publicly. The stolen resource is transferred silently.
4. **Robber must move to a different hex.** Placing on the current hex is a validation error.
5. **No valid steal targets → skip.** If `stealCandidates(state, chosenHex, meIdx)` is empty, `move_robber` transitions directly to `main`. No extra event.
6. **Discard UI = inline stepper bar** above the board, +/- per resource, live counter, Confirm enabled only when totals match. Players with nothing to discard see "Waiting for X, Y, Z to discard".
7. **Steal target UI = tap opponent's building on that hex.** Consistent with the existing build-layer interaction style.
8. **Robber render = dark filled circle with stroke ring at the hex center.** Sits above the number token.
9. **`robber: Hex` is a first-class field on `GameState`.** Initialized to the desert.

## Data model

### `types.ts` diff

```diff
 export type Phase =
     | { kind: 'initial_placement'; round: 1 | 2; step: 'settlement' | 'road' }
     | { kind: 'roll' }
+    | {
+          kind: 'discard'
+          roll: DiceRoll
+          // Pending amount each player still owes; entries removed as they submit.
+          pending: Partial<Record<number, number>>
+      }
+    | { kind: 'move_robber'; roll: DiceRoll }
+    | { kind: 'steal'; roll: DiceRoll; hex: Hex; candidates: number[] }
     | { kind: 'main'; roll: DiceRoll }
     | { kind: 'game_over' }

 export type GameState = {
     variant: Variant
     hexes: Record<Hex, HexData>
     vertices: Partial<Record<Vertex, VertexState>>
     edges: Partial<Record<Edge, EdgeState>>
     players: PlayerState[]
     phase: Phase
+    robber: Hex
 }
```

### `generate.ts` diff

After generating hexes, pick the hex with `resource: null` and initialize `robber` to that hex id.

## `lib/catan/robber.ts` — outline

```ts
import { HEXES, adjacentVertices, type Hex } from './board'
import {
	vertexStateOf,
	type GameState,
	type PlayerState,
	type ResourceHand,
} from './types'

export function validRobberHexes(state: GameState): Hex[] {
	return HEXES.filter((h) => h !== state.robber)
}

export function stealCandidates(
	state: GameState,
	hex: Hex,
	meIdx: number
): number[] {
	const set = new Set<number>()
	for (const v of adjacentVertices[hex]) {
		const vs = vertexStateOf(state, v)
		if (!vs.occupied) continue
		if (vs.player === meIdx) continue
		const hand = state.players[vs.player].resources
		const total =
			hand.brick + hand.wood + hand.sheep + hand.wheat + hand.ore
		if (total <= 0) continue
		set.add(vs.player)
	}
	return Array.from(set)
}

export function handSize(hand: ResourceHand): number {
	return hand.brick + hand.wood + hand.sheep + hand.wheat + hand.ore
}

export function requiredDiscards(
	players: PlayerState[]
): Partial<Record<number, number>> {
	const out: Partial<Record<number, number>> = {}
	players.forEach((p, i) => {
		const total = handSize(p.resources)
		if (total > 7) out[i] = Math.floor(total / 2)
	})
	return out
}

export function isValidDiscardSelection(
	hand: ResourceHand,
	selection: ResourceHand,
	required: number
): boolean {
	if (handSize(selection) !== required) return false
	for (const r of ['brick', 'wood', 'sheep', 'wheat', 'ore'] as const) {
		if (selection[r] < 0) return false
		if (selection[r] > hand[r]) return false
	}
	return true
}
```

## `roll.ts` — blocked-hex skip

`distributeResources` gains a check: `if (hex === state.robber) continue` before reading `hd.resource`. Empty desert hex is also skipped by the existing `resource === null` check; the robber skip is in addition to that.

## Edge function additions

### `roll` branch for 7

Inside `handleRoll`, after computing `total = a + b`:

```ts
if (total === 7) {
	const pending = requiredDiscards(state.players)
	const nextPhase: Phase =
		Object.keys(pending).length > 0
			? { kind: 'discard', roll: dice, pending }
			: { kind: 'move_robber', roll: dice }
	// players unchanged (no distribution)
	// write game_states.phase, append 'rolled' event with total=7, return
}
```

Note: the `'rolled'` event is logged for 7 the same as any other roll (dice, total, player, at).

### `discard` action

Body: `{ action: 'discard', game_id, discard: ResourceHand }`.

Flow:

1. Load game + state. 404 on miss.
2. `game.status === 'active'`, `phase.kind === 'discard'`. 400 otherwise.
3. Caller is a participant. 403 otherwise.
4. `pending[meIdx]` set (i.e., they owe). 400 otherwise.
5. `isValidDiscardSelection(hand, body.discard, pending[meIdx])`. 400 otherwise.
6. Deduct `body.discard` from `state.players[meIdx].resources`.
7. Remove `pending[meIdx]`. Build `nextPhase`:
    - If `pending` now empty → `{ kind: 'move_robber', roll: phase.roll }`.
    - Else → `{ kind: 'discard', roll: phase.roll, pending: nextPending }`.
8. Update `game_states.players` + `game_states.phase`.
9. Append event `{ kind: 'discarded', player: meIdx, count: sumOf(body.discard), at }`. No resource detail.
10. Return `{ ok: true }`.

### `move_robber` action

Body: `{ action: 'move_robber', game_id, hex }`.

Flow:

1. Load. 404.
2. `status === 'active'`, `phase.kind === 'move_robber'`. 400.
3. `meIdx = current player`. 403 if not a participant; 403 if `current_turn !== meIdx`.
4. `hex` is a known Hex AND `hex !== state.robber`. 400 otherwise.
5. Compute `candidates = stealCandidates(state, hex, meIdx)` AGAINST `robber = hex` (using the new robber position — but `stealCandidates` only looks at buildings adjacent to `hex`, so passing the updated state or the plain `hex` is equivalent). Pass `hex` directly.
6. Update state: `robber = hex`.
7. Next phase:
    - If `candidates.length === 0` → `{ kind: 'main', roll: phase.roll }`.
    - Else → `{ kind: 'steal', roll: phase.roll, hex, candidates }`.
8. Update `game_states.robber` + `game_states.phase`.
9. Append event `{ kind: 'robber_moved', player: meIdx, hex, at }`.
10. Return `{ ok: true }`.

### `steal` action

Body: `{ action: 'steal', game_id, victim: number }`.

Flow:

1. Load. 404.
2. `status === 'active'`, `phase.kind === 'steal'`. 400.
3. `meIdx === current_turn`. 403 otherwise.
4. `phase.candidates.includes(body.victim)`. 400 otherwise.
5. Pick a random resource from `state.players[victim].resources` (weighted by count). Victim has ≥1 card guaranteed by the candidates check.
6. Transfer: `victim[res] -= 1`, `me[res] += 1`.
7. Transition phase to `{ kind: 'main', roll: phase.roll }`.
8. Update `game_states.players` + `game_states.phase`.
9. Append event `{ kind: 'stolen', thief: meIdx, victim: body.victim, at }`. **No resource field.**
10. Return `{ ok: true }`.

### Duplicated helpers

Add to the edge function:

- `validRobberHexes`, `stealCandidates`, `handSize`, `requiredDiscards`, `isValidDiscardSelection`. Pasted from `robber.ts`. Update `distributeResources` to skip `state.robber`.

## Store additions

```ts
export type GameEvent =
    | ...existing...
    | { kind: 'discarded'; player: number; count: number; at: string }
    | { kind: 'robber_moved'; player: number; hex: string; at: string }
    | { kind: 'stolen'; thief: number; victim: number; at: string }

type GamesStore = {
    // ... existing ...
    discard: (gameId: string, discard: ResourceHand) => Promise<ActionResult>
    moveRobber: (gameId: string, hex: string) => Promise<ActionResult>
    steal: (gameId: string, victim: number) => Promise<ActionResult>
}
```

Each wraps `supabase.functions.invoke('game-service', { body: { action, game_id, ... } })` with the established error shape.

## UI — `app/game/[id].tsx`

### Board render

`<BoardSvg>` always renders `<RobberPiece hex={state.robber} layout={hexLayout} size={layout.s} />` (a dark filled circle with a stroke, slightly offset from the number token or overlaid at ~55% token opacity — pick whichever reads best in practice).

### `RobberLayer` overlay

Renders inside `<BoardSvg>`, takes `{ state, meIdx, layoutS, hexLayouts, vertexPositions, onMoveRobber, onSteal }`. Gated on `state.phase.kind === 'move_robber' || 'steal'`.

- In `move_robber` and my turn: pulse each hex center of `validRobberHexes(state)`; tap fires `onMoveRobber(hex)`.
- In `steal` and my turn: pulse each opponent's building vertex adjacent to `phase.hex` whose player is in `phase.candidates`; tap fires `onSteal(victimPlayerIdx)`.
- Otherwise render nothing (spectator view for these phases).

Tap a spot → `Alert.alert('Move robber here?' | 'Steal from {name}?', undefined, [Cancel, Confirm])`, identical to the build confirm flow.

### Status line / action bar

Add phase-specific branches to whatever rendering `MainLoopBar` / status currently does:

| phase.kind       | my turn (active player)                                 | my turn (non-active)                        | other player                     |
| ---------------- | ------------------------------------------------------- | ------------------------------------------- | -------------------------------- |
| `discard`        | "Discard N cards" + `<DiscardBar>` if I owe; else below | "Discard N cards" + `<DiscardBar>` if I owe | "Waiting for {names} to discard" |
| `move_robber`    | "You rolled 7 — move the robber"                        | —                                           | "{name} is moving the robber"    |
| `steal`          | "Pick a player to steal from"                           | —                                           | "{name} is stealing"             |
| `main` (after 7) | unchanged                                               | unchanged                                   | unchanged                        |

`{names}` = comma-separated usernames of `pending` keys, with "You" substituted for the viewer if applicable.

`DiscardBar`: standalone component. Props `{ hand: ResourceHand, required: number, submitting, onSubmit }`. Internal state for the per-resource discard count. +/- buttons per resource, disabled at 0/hand[r]. A live `total / required` display. Submit button disabled until `total === required`.

### Build bar gating

`BuildTradeBar` enablement already gates on `phase.kind === 'main'`. No change needed — during `discard`/`move_robber`/`steal` all build buttons stay disabled naturally.

## Dev checks (`dev/check-catan-robber.ts`)

1. `requiredDiscards`: hands of sizes 7/8/9 → {7: none, 8: 4, 9: 4}.
2. `isValidDiscardSelection`: positive case (exact match), under-count, over-count, exceeds a resource.
3. `stealCandidates`: with a handcrafted state — settlement for me + city for opponent on the target hex, opponent has cards → returns `[opponent]`. Opponent empty-handed → `[]`. Opponent not adjacent → `[]`.
4. `validRobberHexes`: excludes current robber only; length 18.
5. `distributeResources` with robber on a number-matching hex → no gain from that hex for any adjacent settlement.

## Verification checklist

- [ ] `lib/catan/types.ts`: `robber` field added to `GameState`; three new `Phase` variants.
- [ ] `lib/catan/generate.ts`: initial `robber` = desert hex.
- [ ] `lib/catan/robber.ts`: helpers exported.
- [ ] `lib/catan/roll.ts`: `distributeResources` skips `state.robber`.
- [ ] Edge function: 7-roll branches to `discard` or `move_robber`; new actions validate + update atomically; event shapes match spec.
- [ ] Store: `discard` / `moveRobber` / `steal` wrappers; `GameEvent` extended.
- [ ] `RobberPiece` + `RobberLayer` + `DiscardBar` render per spec.
- [ ] `app/game/[id].tsx`: each new phase routes to its UI; status line matches spec; `RobberPiece` always rendered.
- [ ] `dev/check-catan-robber.ts` runs green.
- [ ] `npm run check` passes.
- [ ] `npm run format` run.
- [ ] Smoke test: force a 7, verify discard step, then move robber, then steal (with and without candidates), then resume main phase.

## Follow-ups (not this spec)

- Knight dev card (moves robber without rolling).
- Reveal stolen resource privately to involved players via per-player event filtering.
- Victory-condition check on every state write.
- Trade (bank / port / player-to-player).
- Replace edge-function helper duplication with a shared shim.
