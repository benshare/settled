# Catan — Longest Road, Largest Army visibility, and Victory

Follows `catan-dev-cards.md`. Closes the three remaining gameplay follow-ups:

1. **Longest Road** (+2 VP) — classic Catan bonus for owner of the longest continuous road of ≥ 5 segments. Strict majority; ties keep the current holder. Recomputed after every road build, settlement build (can split an opponent's chain), and Road Building card finalization.
2. **Largest Army badge on `PlayerStrip`** — visible indicator next to the sword/knight stat when a player holds the bonus. (Data already tracked; just UI.)
3. **Victory detection & game-over flow** — on any state write, if any player's `totalVP` ≥ 10, set `games.status = 'complete'`, `games.winner = i`, `state.phase = { kind: 'game_over' }`, log `game_complete`. The game screen renders a final-scoreboard overlay with VP cards revealed.

Pattern matches `catan-dev-cards.md`: pure rules in `lib/catan/`, duplicated into the edge function, gated recomputes on the write paths that can change the value. No new config flag — Longest Road and win detection are always on.

## Locked decisions (proposed, please confirm)

1. **Longest Road threshold + tie rule.** Holder requires ≥ 5 connected road segments, strict majority over all other players. Ties keep the current holder. If the current holder drops below the new lead (e.g. someone else just reached 6 and holder is still at 5), the bonus transfers. If the current holder's count falls below the threshold OR below a sole challenger's count due to an opponent splitting their road, they lose it. Mirrors `recomputeLargestArmy` semantics.
2. **Longest Road trail definition.** Edge-disjoint walk (each road used at most once), vertices may be revisited. Blocked by opponent settlement/city at an interior vertex: the trail cannot cross through that vertex (can terminate there, or start from there if the player owns adjacent roads but no settlement, since an opponent's building also blocks "pass-through"). Own buildings do not block. Matches Catan official rules.
3. **Algorithm.** Brute-force DFS per connected component; for each edge as a starting point, recurse over unused adjacent edges, respecting the opponent-vertex block. Track the max length. Board size (≤ 15 player roads, 72 edges total) makes the search trivial.
4. **Recompute triggers.** After every `build_road` (including Road Building card placements — trigger on completion, not per placement, to avoid mid-card thrash), and after every `build_settlement` (an opponent's settlement can split my road). Not triggered by initial_placement roads (nobody reaches 5 segments during placement). Not by cities (cities don't change the road graph). Result stored in `GameState.longestRoad: number | null`.
5. **Event logging.** New event kind `longest_road_changed { player: number | null, at: string }`. Fires on acquisition AND on loss — `player: null` announces a holder losing it with no successor (more common than Largest Army because settlements can force it). Emitted only when `longestRoad` actually changes. Largest Army stays as-is (acquisition only — that behavior is intentional; a knight play cannot reduce anyone's knight count).
6. **Victory check location.** Runs at the end of every edge-function handler that mutates `game_states` or `games` and could raise a player's VP: `build_settlement`, `build_city`, `build_road` (via Longest Road shift), `play_dev_card` (knight → Largest Army, victory*point → hidden VP), `buy_dev_card` (hidden VP draw). Settlement build by an opponent could \_demote* a holder, but demotion can't push someone over 10 — so victory checks on `build_settlement` only need to consider the builder.
7. **Victory detection uses `totalVP` with hidden VP included.** The edge function has full visibility. VP cards count the moment they're drawn (matches classic "win on the turn you buy the 10th VP").
8. **Auto-declare winner at ≥ 10 VP.** Check after every write. Simpler than "only on active player's turn"; safe because only active-player actions raise VP. The helper scans all players for `totalVP >= 10` and sets the first match as `winner`.
9. **`game_over` phase is terminal.** Every edge-function handler guards on `game.status === 'active'` already; we also treat `phase.kind === 'game_over'` as a hard stop. Once a game is complete, no further writes succeed. `end_turn` and all action handlers early-return with `"game complete"`.
10. **Game-over UI — dismissable overlay with both exits.** Overlay on the game screen when `game.status === 'complete'`: a card with the winner's name + color, final scoreboard per player with breakdown (settlements, cities, Largest Army, Longest Road, dev VP cards — _all_ players' hidden VP cards revealed here), a primary "Back to games" button (routes to `/games`) and a secondary "View board" button that dismisses the overlay to inspect the final board. A small "Final score" floating button reappears in the HUD once dismissed; tapping it restores the overlay. Placement/main-phase inputs are hidden in both states.
11. **`PlayerStrip` badges.** Add a `MaterialCommunityIcons` `road-variant` stat (parallel to the `sword` for knights) showing the player's _longest-trail length_ (not total roads built — mirrors the knight stat semantics for Largest Army). Colored `colors.brand` when `state.longestRoad === i`. Hidden when the player has zero roads, to avoid clutter early in the game. Independent of any config flag.
12. **Victory-point card reveal.** On `game_complete`, the edge function writes a public snapshot of VP-card counts per player into the event payload (`vpCards: Record<number, number>`) so observers reconstruct the score without a live read. The `devCards` arrays themselves are left in place (no server-side transform).
13. **5/5 tie resolution.** `recomputeLongestRoad` uses the same strict-majority-with-holder-keeps rule as `recomputeLargestArmy`. Because the recompute runs after every road/settlement build, the "first to 5" case is naturally the sole-holder-at-5 case (they crossed the threshold and became holder on that write); a later challenger reaching 5 ties the holder and holder keeps. Dropping-below-threshold always releases the bonus (returns null if no one else has ≥ 5).

## Scope

In scope:

- `lib/catan/longestRoad.ts` (new) — pure rules:
    - `longestRoadFor(state, playerIdx): number` — length of player's longest edge-disjoint trail.
    - `recomputeLongestRoad(state): number | null` — returns the new holder index or keeps current. Mirrors `recomputeLargestArmy` semantics (threshold 5, strict majority, tie keeps holder).
- `lib/catan/types.ts` — add `longestRoad: number | null` to `GameState`.
- `lib/catan/dev.ts` — `totalVP` gains `+2` when `state.longestRoad === playerIdx`. Signature unchanged.
- `lib/catan/generate.ts` — `initialGameState` seeds `longestRoad = null`.
- `lib/catan/PlayerStrip.tsx` — new road-icon stat, brand-colored when `state.longestRoad === i`.
- `lib/catan/GameOverOverlay.tsx` (new) — overlay component; final scoreboard.
- `app/game/[id].tsx` — render `GameOverOverlay` when `game.status === 'complete'`. Hide placement/main-phase UI. Keep board visible behind.
- `lib/stores/useGamesStore.ts` — `GameEvent` union gains `longest_road_changed` and `game_complete`. No new wrappers (pure UI read).
- `supabase/functions/game-service/index.ts`:
    - Duplicate `longestRoadFor` + `recomputeLongestRoad`.
    - `handleBuildRoad`: after the commit (or in the commit update), recompute `longestRoad` and write if changed; emit event; then run victory check.
    - `handleBuildSettlement`: recompute `longestRoad` (opponent split), write if changed, emit event; run victory check on builder.
    - `handleBuildCity`: no road recompute; run victory check.
    - `handleBuyDevCard`: after VP draw, run victory check.
    - `handlePlayDevCard` (knight branch — Largest Army), run victory check.
    - Road Building card's final placement (the existing `build_road` path with `isRoadBuilding` true) recomputes Longest Road on the last placement (when `remainingAfter === 0` or no legal follow-up).
    - New helper `finalizeWriteWithVictoryCheck(admin, game, state, update, events)` that wraps the `game_states.update` + `games.update` (events + optional status/winner) in one place. Appends `longest_road_changed` / `largest_army_changed` / `game_complete` as applicable.
    - Add `game.status === 'complete'` and `phase.kind === 'game_over'` as early rejects in every existing handler (belt-and-suspenders; the `status !== 'active'` check already fires, but make the phase variant explicit).
- `supabase/migrations/YYYYMMDDHHMMSS_catan_longest_road.sql` (new) — add `longest_road int null` column to `game_states` (indexing not needed; read pattern is "one state per game"). Default null. No RLS changes.
- `lib/supabase/database-types.ts` — regenerated via `npm run types` after migration.
- `dev/check-catan-longest-road.ts` (new) — unit coverage (see verification below).
- `lib/catan/CLAUDE.md` — mention `longestRoad.ts`. Note `totalVP` now includes Longest Road bonus.

Out of scope:

- Historical replay / per-turn VP timeline.
- MVP / stats page for completed games beyond the overlay (game history screens already exist and will pick up `status = 'complete'` rows; no change needed here).
- Resigning / concession flow.
- Tie resolution beyond the "current-holder keeps" rule.
- Different board variants — `variant: 'standard'` only (current codebase constraint).

## Data model

### `types.ts` diff

```diff
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
     devDeck: DevCardId[]
     largestArmy: number | null
+    // Player index holding Longest Road (≥ 5 roads, strict majority), or null.
+    // Recomputed after road builds, Road Building card plays, and settlement
+    // builds (an opponent's settlement can split a road). Ties keep the holder.
+    longestRoad: number | null
     round: number
 }
```

### Migration

```sql
-- supabase/migrations/YYYYMMDDHHMMSS_catan_longest_road.sql
alter table public.game_states
    add column longest_road int null;

comment on column public.game_states.longest_road is
    'Player index (0-based in games.player_order) holding Longest Road, or null.';
```

No RLS change: `game_states` already has its select policy; writes go through service-role.

### `longestRoad.ts` outline

```ts
import { adjacentEdges, edgeEndpoints, type Edge, type Vertex } from './board'
import { edgeStateOf, vertexStateOf, type GameState } from './types'

const ROAD_THRESHOLD = 5

export function longestRoadFor(state: GameState, playerIdx: number): number {
	// Collect the player's edges.
	const ownEdges: Edge[] = []
	for (const [edge, es] of Object.entries(state.edges) as [
		Edge,
		EdgeState | undefined,
	][]) {
		if (es?.occupied && es.player === playerIdx) ownEdges.push(edge)
	}
	if (ownEdges.length === 0) return 0

	// For each edge, start DFS from both endpoints, trying all extensions.
	// Edge-disjoint trail: edges can't repeat; vertices may. Opponent buildings
	// at an interior vertex block pass-through.
	let best = 0
	for (const start of ownEdges) {
		const [a, b] = edgeEndpoints(start)
		best = Math.max(
			best,
			walk(state, playerIdx, start, a, new Set([start]))
		)
		best = Math.max(
			best,
			walk(state, playerIdx, start, b, new Set([start]))
		)
		if (best === ownEdges.length) return best // can't exceed total count
	}
	return best
}

function walk(
	state: GameState,
	playerIdx: number,
	prevEdge: Edge,
	head: Vertex,
	used: Set<Edge>
): number {
	const vs = vertexStateOf(state, head)
	const blocked = vs.occupied && vs.player !== playerIdx
	if (blocked) return used.size
	let best = used.size
	for (const e of adjacentEdges[head]) {
		if (used.has(e)) continue
		const es = edgeStateOf(state, e)
		if (!es.occupied || es.player !== playerIdx) continue
		const [a, b] = edgeEndpoints(e)
		const next = a === head ? b : a
		used.add(e)
		const len = walk(state, playerIdx, e, next, used)
		if (len > best) best = len
		used.delete(e)
	}
	return best
}

export function recomputeLongestRoad(state: GameState): number | null {
	let bestIdx: number | null = null
	let best = ROAD_THRESHOLD - 1 // must be strictly > (threshold - 1), i.e. ≥ 5
	state.players.forEach((_, i) => {
		const len = longestRoadFor(state, i)
		if (len > best) {
			best = len
			bestIdx = i
		} else if (len === best && state.longestRoad === i) {
			// Holder keeps the bonus on a tie.
		}
	})
	if (bestIdx === null) {
		// Nobody newly qualifies. Check if current holder still qualifies.
		if (state.longestRoad !== null) {
			const holderLen = longestRoadFor(state, state.longestRoad)
			if (holderLen < ROAD_THRESHOLD) return null
			return state.longestRoad
		}
		return null
	}
	return bestIdx
}
```

Edge-function duplicate follows the established pattern (constants already shared; helpers mirrored).

### Victory helper (shared in `lib/catan/dev.ts`)

```diff
 export function totalVP(
     state: GameState,
     playerIdx: number,
     includeHiddenVP: boolean = true,
 ): number {
     const p = state.players[playerIdx]
     let vp = 0
     for (const v of Object.values(state.vertices)) {
         if (v?.occupied && v.player === playerIdx) {
             vp += v.building === 'city' ? 2 : 1
         }
     }
     if (state.largestArmy === playerIdx) vp += 2
+    if (state.longestRoad === playerIdx) vp += 2
     if (includeHiddenVP) {
         for (const e of p.devCards) {
             if (e.id === 'victory_point') vp += 1
         }
     }
     return vp
 }
```

### Events

```ts
// In useGamesStore GameEvent union:
| { kind: 'longest_road_changed'; player: number | null; at: string }
| {
      kind: 'game_complete'
      winner: number
      at: string
      // Public snapshot of VP card counts for the final scoreboard.
      vpCards: Record<number, number>
  }
```

## Edge-function flow changes

### Write-finalize helper

```ts
async function finalizeWrite(
    admin: SupabaseClient,
    game: GameRow,
    nextState: GameState,
    stateUpdate: Record<string, unknown>,
    events: GameEvent[],
): Promise<Response | null> {
    // 1. Recompute Longest Road if this write touched edges/vertices.
    //    Callers that didn't touch road-graph data set `skipLongestRoad: true`
    //    on the update payload (we strip it before writing).
    const touchedGraph = 'edges' in stateUpdate || 'vertices' in stateUpdate
    const { longest_road: currentLR = game.longestRoadField } = ...
    let nextLongestRoad = nextState.longestRoad
    if (touchedGraph) {
        const newHolder = recomputeLongestRoad(nextState)
        if (newHolder !== nextState.longestRoad) {
            nextLongestRoad = newHolder
            stateUpdate.longest_road = newHolder
            events.push({ kind: 'longest_road_changed', player: newHolder, at: now() })
        }
    }
    // 2. Victory check.
    const stateWithLR: GameState = { ...nextState, longestRoad: nextLongestRoad }
    let winner: number | null = null
    for (let i = 0; i < stateWithLR.players.length; i++) {
        if (totalVP(stateWithLR, i, true) >= 10) { winner = i; break }
    }
    if (winner !== null) {
        stateUpdate.phase = { kind: 'game_over' } satisfies Phase
        events.push({
            kind: 'game_complete',
            winner,
            at: now(),
            vpCards: vpCardCountsByPlayer(stateWithLR),
        })
    }
    // 3. Commit state row.
    const { error: stateErr } = await admin.from('game_states').update(stateUpdate).eq('game_id', game.id)
    if (stateErr) return err(500, 'could not update state')
    // 4. Commit games row (events + optional winner/status).
    const gameUpdate: Record<string, unknown> = { events: [...(game.events ?? []), ...events] }
    if (winner !== null) { gameUpdate.status = 'complete'; gameUpdate.winner = winner }
    const { error: gameErr } = await admin.from('games').update(gameUpdate).eq('id', game.id)
    if (gameErr) return err(500, 'could not log event')
    return null // ok
}
```

Existing handlers refactor to build `stateUpdate` + local `events[]` and end with `return finalizeWrite(...)` instead of the current two-step game_states / games updates. Handlers that don't touch road graph (e.g. `buy_dev_card`, knight play) just pass `touchedGraph = false` and skip the recompute.

### Handler-by-handler deltas

- **`handleBuildRoad`** (`main` phase): recompute Longest Road, victory check on builder. (Road Building flow: only recompute on the last road placement — guarded by `remainingAfter === 0 || !hasLegalRoadPlacement`.)
- **`handleBuildSettlement`**: recompute Longest Road (opponent split possibility), victory check on builder.
- **`handleBuildCity`**: no road recompute; victory check.
- **`handleBuyDevCard`**: no road recompute; victory check (VP card could push to 10).
- **`handlePlayDevCard`** — knight: existing Largest Army recompute; victory check (Largest Army swing). road_building: final placement handled via `handleBuildRoad`. monopoly/yop: no VP change.
- **`handleEndTurn`**: no changes; turn can't end with phase.kind === 'main' if the game just ended (finalizeWrite set it to game_over), so the guard holds.
- **Every handler**: early-return `err(400, 'game complete')` if `state.phase.kind === 'game_over'`. (Redundant with `game.status === 'active'`, but explicit.)

## UI

### `GameOverOverlay.tsx`

```tsx
export function GameOverOverlay({
    game,
    gameState,
    profilesById,
}: {
    game: Game
    gameState: GameState
    profilesById: Record<string, Profile>
}) {
    const winnerIdx = game.winner
    if (winnerIdx === null) return null
    const winnerUid = game.player_order[winnerIdx]
    const winnerProfile = profilesById[winnerUid]
    return (
        <View style={styles.backdrop} pointerEvents="box-none">
            <View style={styles.card}>
                <Text style={styles.title}>Game over</Text>
                <Text style={styles.winner}>{winnerProfile?.username ?? 'Player'} wins!</Text>
                <Scoreboard gameState={gameState} playerOrder={game.player_order} profilesById={profilesById} />
                <Button label="Back to games" onPress={...} />
            </View>
        </View>
    )
}
```

Scoreboard rows: settlements (×1), cities (×2), Largest Army (+2), Longest Road (+2), VP cards (+1 each — revealed via `totalVP(state, i, /*includeHiddenVP*/ true)`).

### `PlayerStrip.tsx` changes

Add a stat entry (parallel to the sword):

```tsx
{
	roads > 0 && (
		<View style={styles.stat}>
			<MaterialCommunityIcons
				name="road-variant"
				size={12}
				color={hasLongestRoad ? colors.brand : colors.textSecondary}
			/>
			<Text
				style={[
					styles.statText,
					hasLongestRoad && { color: colors.brand },
				]}
			>
				{roads}
			</Text>
		</View>
	)
}
```

Where `roads = longestRoadFor(gameState, i)` (computed client-side; cheap). `hasLongestRoad = gameState.longestRoad === i`.

## Verification (green-light criteria)

`dev/check-catan-longest-road.ts` covers:

1. Straight line of 5 roads → length 5, acquires Longest Road.
2. Branching Y-shape (e.g. 4 segments + 2 branch) → length 6 (walk one branch, then backtrack rule — wait, re-visit rule — confirm trail is edge-disjoint so max is 6).
3. Cycle / triangle of 3 roads → length 3 (trail can use all 3 via revisiting a vertex).
4. 5 roads split by opponent settlement mid-chain → length reduces to the larger of the two sub-chains.
5. 5-road holder loses bonus when opponent builds a 6-road. Previous holder retains nothing.
6. Tie at 5 after holder had 5 first: holder keeps.
7. `recomputeLongestRoad` on a state below threshold → null; on current holder dropping below 5 → null.
8. Victory check: player with 4 settlements, 3 cities, Largest Army → 4 + 6 + 2 = 12 → wins. With `longestRoad === i` only: 4 + 6 + 2 + 2 = 14. With `largestArmy === i` + `longestRoad === i` + hidden VP 2 → …
9. Opponent's knight play that takes Largest Army from me AND drops me under 10 does not un-win me (we don't un-set once `status === 'complete'`).

Manual / integration:

- Play through a local game: build 5 roads → PlayerStrip shows brand-color road badge. Event log shows `longest_road_changed`.
- Opponent settlement splits chain → badge transfers or disappears.
- Reach 10 VP → overlay shows; board behind; "Back to games" routes correctly.
- Further actions (`roll`, `build_*`, `play_dev_card`, `end_turn`) all return 400 / "game complete".

Type checks: `npx tsx dev/check-catan-longest-road.ts`, plus the existing seven check scripts (should still pass). Edge function compiles via `npm run edge`.

## Follow-ups (explicit backlog)

- Completed-game detail screen (currently just a list entry from `completeGames`). The overlay gets the job done for the just-finished view; cold navigation to a completed game just renders the board + overlay.
- Winner badge on the game list row.
- Replay / per-turn VP timeline.
- Resigning / concession flow.
- Longest Road via Road Building card pedantry: if a player's _first_ Road Building road reaches length 5 and the _second_ extends to 6, we currently recompute only on the second placement. That's correct (no intermediate "Longest Road briefly held then extended" event noise).
