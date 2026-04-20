# Catan — roll + turn main loop

Follows `catan-initial-placement.md`. Wires up the main-phase loop between initial placement and the (still to come) building/trading pass. At the end of this pass: once placement completes, the active player can roll 2d6, the board pays out resources to every settlement/city touching a matching hex, and the active player can end their turn to pass the roll to the next player clockwise.

Build, trade, dev-card, and robber actions remain deferred — this is just the turn skeleton.

## Scope

In scope:

- `lib/catan/roll.ts` — pure helpers: `rollDice()`, `distributeResources(state, total)`, `nextMainTurn(currentTurn, playerCount)`, and a `totalDice(roll)` convenience. No I/O.
- `lib/catan/types.ts` — add `lastRoll: DiceRoll | null` to `GameState`. `DiceRoll = { a: 1|2|3|4|5|6; b: 1|2|3|4|5|6 }`.
- `supabase/functions/game-service/index.ts` — two new actions: `roll`, `end_turn`. Plus the duplicated helpers from `lib/catan/roll.ts`.
- `lib/stores/useGamesStore.ts` — `roll(gameId)` and `endTurn(gameId)` wrappers. New `GameEvent` variants for `rolled` and `turn_ended`.
- `app/game/[id].tsx` — Roll button (phase='roll', your turn), dice readout (after roll), End Turn button (phase='main', your turn), "Waiting for X…" copy for everyone else. Event feed is still not rendered.
- Migration: tiny — `game_states.players` / `phase` shape is JSONB so no schema change; but we need to **initialize `lastRoll` to `null`** on new `game_states` rows. Done in the edge function's `respond` action, not a DB migration.
- `dev/check-catan-roll.ts` — dev checks for the helpers.

Out of scope:

- Robber / moving the robber / 7-rolls' discard step. A `7` in this pass is a no-op (no distribution, no robber). Noted as a follow-up.
- Hand-size limit / discard-on-7 (deferred with robber).
- Building actions (road / settlement / city), cost tables, buy dev card.
- Trading (player-to-player, bank 4:1, ports).
- Longest road / largest army / VP tracking beyond what already exists.
- Dice animation. Dice render as two static pips-or-numerals after roll.
- Optimistic UI. Clients wait on the server response and let realtime push the update.

## Locked decisions (confirmed with user)

1. **`7` is a no-op this pass.** Transitions to `phase='main'`; no distribution, no robber, no discards. Robber lands in a follow-up.
2. **Dice readout lives on `phase`.** Instead of a separate `lastRoll` field, the `main` phase variant carries the roll: `{ kind: 'main'; roll: DiceRoll }`. Avoids a DB migration (phase is already a jsonb column) and makes the invariant "a roll is meaningful only after you've rolled" a type-level guarantee. Cleared implicitly when `end_turn` sets `phase = { kind: 'roll' }`.
3. **Cities pay 2.** Distribution pays `settlement → 1, city → 2` per adjacent matching hex, even though building cities isn't possible yet.
4. **No bank depletion.** We ignore the 19-card-per-resource bank limit.
5. **End turn is manual.** Active player must tap "End turn". No auto-advance after roll.
6. **Roll event payload:** `{ kind: 'rolled', player, dice: [a,b], total, at }`. Per-player distribution is derivable from state + total, not logged.
7. **Placement → roll handoff:** `games.current_turn = 0` → first player in `player_order` rolls first in the main loop.

## `lib/catan/roll.ts` — outline

```ts
import { HEXES, type Hex } from './board'
import {
	adjacentVertices, // NOTE: not currently exported; add named export if not there
} from './board'
import { vertexStateOf, type GameState, type ResourceHand } from './types'

export type DiceRoll = { a: 1 | 2 | 3 | 4 | 5 | 6; b: 1 | 2 | 3 | 4 | 5 | 6 }

export function rollDice(): DiceRoll {
	const d = () => (1 + Math.floor(Math.random() * 6)) as DiceRoll['a']
	return { a: d(), b: d() }
}

export function totalDice(r: DiceRoll): number {
	return r.a + r.b
}

// For every hex whose number token equals `total`, every settlement/city
// adjacent to it pays 1 (settlement) or 2 (city) of that hex's resource
// to the hex's owner(s). Returns a deep per-player gain map.
// Desert hexes can't have a number, so they never pay out. On a 7, returns
// an empty gain map (robber deferred).
export function distributeResources(
	state: GameState,
	total: number
): Record<number, ResourceHand>

// Straight rotation in main phase: (currentTurn + 1) % playerCount.
export function nextMainTurn(currentTurn: number, playerCount: number): number
```

Distribution algorithm:

```
if total === 7: return {}
for hex in HEXES:
    hd = state.hexes[hex]
    if hd.resource === null: continue
    if hd.number !== total: continue
    for v in adjacentVertices[hex]:
        vs = vertexStateOf(state, v)
        if !vs.occupied: continue
        gain = vs.building === 'city' ? 2 : 1
        result[vs.player][hd.resource] += gain
return result
```

## `lib/catan/types.ts` — diff

```diff
+export type DieFace = 1 | 2 | 3 | 4 | 5 | 6
+export type DiceRoll = { a: DieFace; b: DieFace }
+
 export type Phase =
     | { kind: 'initial_placement'; round: 1 | 2; step: 'settlement' | 'road' }
     | { kind: 'roll' }
-    | { kind: 'main' }
+    | { kind: 'main'; roll: DiceRoll }
     | { kind: 'game_over' }
```

`GameState` itself is unchanged — the roll rides on `phase.main`. `DiceRoll` is defined in `types.ts` (persisted shape) and re-exported from `roll.ts` for convenience. `generate.ts` is unchanged.

## Edge function — new actions

Add to `supabase/functions/game-service/index.ts`.

### `roll`

Body: `{ action: 'roll', game_id: string }`

Flow:

1. Load `games` + `game_states`. 404 on miss.
2. Caller must be `player_order[current_turn]`. 403 otherwise.
3. `games.status === 'active'` and `game_states.phase.kind === 'roll'`. 400 otherwise.
4. `dice = rollDice()`; `total = a + b`.
5. Compute `gains = distributeResources(state, total)`.
6. Apply `gains` into `state.players[i].resources` for each `i`. Plain addition per resource key.
7. Update `game_states` atomically:
    - `players: nextPlayers`
    - `phase: { kind: 'main', roll: dice }`
8. Append event to `games.events`: `{ kind: 'rolled', player: meIdx, dice: [a,b], total, at }`.
9. Return `{ ok: true, dice, total }`.

### `end_turn`

Body: `{ action: 'end_turn', game_id: string }`

Flow:

1. Load. 404 on miss.
2. Caller must be `player_order[current_turn]`. 403 otherwise.
3. `games.status === 'active'` and `phase.kind === 'main'`. 400 otherwise.
4. `nextTurn = nextMainTurn(current_turn, player_order.length)`.
5. Atomic updates:
    - `game_states`: `phase = { kind: 'roll' }` (implicitly drops the prior roll).
    - `games`: `current_turn = nextTurn`; append event `{ kind: 'turn_ended', player: meIdx, at }`.
6. Return `{ ok: true }`.

### Duplicated helpers

Add to the edge function:

- `distributeResources`, `nextMainTurn`, `rollDice`, `totalDice`. Paste from `lib/catan/roll.ts`. `adjacentVertices` already lives in the edge function (it's the source-of-truth table in the file).

## Store additions

`useGamesStore.ts`:

```ts
type GamesStore = {
    // ... existing ...
    roll: (gameId: string) => Promise<ActionResult & { dice?: DiceRoll; total?: number }>
    endTurn: (gameId: string) => Promise<ActionResult>
}

// GameEvent — add:
export type GameEvent =
    | ...existing...
    | { kind: 'rolled'; player: number; dice: [number, number]; total: number; at: string }
    | { kind: 'turn_ended'; player: number; at: string }
```

Implementation mirrors `placeSettlement` / `placeRoad` — `supabase.functions.invoke('game-service', { body: { action, game_id } })`, surface the returned error string generically.

## UI — `app/game/[id].tsx`

Extend the existing body. We already render `PlacementHeader` + `BoardView` + (optional) `ResourceHand`. Add a parallel section rendered when `game.status === 'active'`:

**When it's your turn, `phase.kind === 'roll'`:**

- Status line: "Your turn — roll the dice".
- Action bar: `<Button onPress={onRoll}>Roll dice</Button>` (loading while request in flight).
- If `lastRoll` is set (shouldn't be in this state, but guard — could be stale), hide or ignore.

**When it's your turn, `phase.kind === 'main'`:**

- Status line: "Your turn — rolled {total}".
- A dice display next to the line: two mini rectangles with the pip count (numeric "4" is fine in this pass — no pip art yet).
- Action bar: `<Button onPress={onEndTurn}>End turn</Button>`.

**When it's someone else's turn, `phase.kind === 'roll'`:**

- Status line: "Waiting for {name} to roll".

**When it's someone else's turn, `phase.kind === 'main'`:**

- Status line: "{name} rolled {total} — waiting for them to end turn". Dice display same as above.

The avatar ring (already present) keeps highlighting the current player — reuse it.

The board still renders via `<BoardView state={gameState} />` but with `interaction={undefined}` — no tap-to-place in the main phase (building actions land later).

Refactor the inner body so the "status header" component switches on phase:

```tsx
function StatusHeader({ game, gameState, meIdx, profilesById }) {
    if (gameState.phase.kind === 'initial_placement') return <PlacementHeader ... />
    if (gameState.phase.kind === 'roll' || gameState.phase.kind === 'main') {
        return <MainPhaseHeader ... />
    }
    return null
}
```

The existing `ResourceHand` keeps rendering `gameState.players[meIdx]?.resources` — it'll update via realtime when the roll pays out.

## Dev checks (`dev/check-catan-roll.ts`)

Cases:

1. `distributeResources` on a rolled number: a settlement on a vertex adjacent to two number-matching hexes gets 2 of that resource (or 1+1 if different resources).
2. A city gets 2 instead of 1.
3. Rolling `7` returns `{}`.
4. `nextMainTurn(0, 3) === 1`, `nextMainTurn(2, 3) === 0`.
5. `rollDice` over 1000 calls produces only 1..6 per die, and total in 2..12.

## Verification checklist (phase 2 done when all green)

- [ ] `lib/catan/roll.ts` exports the four helpers + `DiceRoll`.
- [ ] `GameState.lastRoll` added; `initialGameState` returns `null`.
- [ ] Edge function `roll` validates turn/status/phase, distributes, updates atomically, logs event.
- [ ] Edge function `end_turn` validates, advances turn, clears `lastRoll`, logs event.
- [ ] Store `roll` + `endTurn` wrapped, `GameEvent` extended.
- [ ] UI shows roll button, dice readout, end-turn button gated on phase + current_turn.
- [ ] `dev/check-catan-roll.ts` runs green.
- [ ] `npm run check` passes.
- [ ] `npm run format` run.
- [ ] Smoke test: run a 2-player game through placement, then roll → main → end turn → next player's roll. Confirm resources accumulate, `lastRoll` flips correctly, and `current_turn` rotates.

## Follow-ups (not this spec)

- Robber + 7-roll discard + rob-adjacent-player. Brings back hand-size limit.
- Build actions (road / settlement / city) with cost deduction + validity.
- Trading (bank 4:1, ports, player-to-player).
- Dev cards.
- Victory-condition check (10 VP) on state mutations.
- Dice animation / pip rendering.
