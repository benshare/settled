// Pure helpers for the initial-placement phase. No I/O — usable from client UI
// (compute valid highlights) or a test harness. The edge function re-implements
// the same logic against its duplicated adjacency constants.

import {
	boardFor,
	RESOURCES,
	edgeEndpoints,
	type Edge,
	type Vertex,
} from './board'
import { isGhost } from './bonus'
import { canPlaceUnderPower, settlementKeepsYouthOK } from './curses'
import {
	edgeStateOf,
	vertexStateOf,
	type GameState,
	type ResourceHand,
} from './types'

// --- Turn order -------------------------------------------------------------

// Snake order: round 1 is 0..N-1, round 2 is N-1..0. The last player of
// round 1 is the first player of round 2 (two consecutive turns).
export function placementTurnPlayer(
	round: 1 | 2,
	posInRound: number,
	playerCount: number
): number {
	return round === 1 ? posInRound : playerCount - 1 - posInRound
}

// Snake order makes the last seat of round 1 the first of round 2, so that
// seat — and only that seat — places both settlements back-to-back with no
// intervening turn. Nothing fixes which of the two it placed first, so it gets
// to nominate the one that pays out (`step: 'pick_last'`).
export function isDoublePlacementSeat(
	playerIdx: number,
	playerCount: number
): boolean {
	return playerIdx === playerCount - 1
}

// Advance one placement step (settlement+road is one step) from the given
// round/turn. Returns null once round 2's last placement is complete, which
// is the signal to transition out of initial placement.
export function nextPlacementTurn(
	round: 1 | 2,
	currentTurn: number,
	playerCount: number
): { round: 1 | 2; currentTurn: number } | null {
	if (round === 1) {
		if (currentTurn < playerCount - 1) {
			return { round: 1, currentTurn: currentTurn + 1 }
		}
		// Last player of round 1 plays again as first of round 2.
		return { round: 2, currentTurn: playerCount - 1 }
	}
	if (currentTurn > 0) {
		return { round: 2, currentTurn: currentTurn - 1 }
	}
	return null
}

// --- Settlement validity ----------------------------------------------------

// Standard distance rule: vertex is valid iff itself is unoccupied AND no
// neighbor vertex is occupied. Same rule both rounds during initial placement.
//
// When `playerIdx` is provided, the curse-aware checks (`youth`, `power`)
// are also applied. Callers that know the acting player (UI + handlers)
// should always pass it; unit-tests that only care about the distance rule
// can omit it.
export function isValidSettlementVertex(
	state: GameState,
	vertex: Vertex,
	playerIdx?: number
): boolean {
	if (vertexStateOf(state, vertex).occupied) return false
	for (const n of boardFor(state.variant).neighborVertices[vertex]) {
		const nvs = vertexStateOf(state, n)
		// Ghosts (haunt bonus) don't enforce the distance rule for others.
		if (nvs.occupied && !isGhost(nvs)) return false
	}
	if (playerIdx !== undefined) {
		if (!canPlaceUnderPower(state, playerIdx, vertex)) return false
		if (!settlementKeepsYouthOK(state, playerIdx, vertex)) return false
	}
	return true
}

export function validSettlementVertices(
	state: GameState,
	playerIdx?: number
): Vertex[] {
	return boardFor(state.variant).vertices.filter((v) =>
		isValidSettlementVertex(state, v, playerIdx)
	)
}

// A player's own settlements. During initial placement this is the pair the
// `pick_last` step chooses between. Ghosts (haunt) are excluded — they don't
// exist this early, but they aren't the player's own placements either.
export function ownSettlementVertices(
	state: GameState,
	playerIdx: number
): Vertex[] {
	return boardFor(state.variant).vertices.filter((v) => {
		const vs = vertexStateOf(state, v)
		return (
			vs.occupied &&
			vs.player === playerIdx &&
			vs.building === 'settlement' &&
			!isGhost(vs)
		)
	})
}

// --- Road validity ----------------------------------------------------------

// During step='road', the just-placed settlement is the player's settlement
// that has no incident road they own. Round 1 after settlement: 1 settlement,
// 0 roads — trivially that vertex. Round 2 after settlement: 2 settlements,
// 1 road — the second settlement is the one without an owned adjacent edge.
export function targetSettlement(
	state: GameState,
	playerIdx: number
): Vertex | null {
	const board = boardFor(state.variant)
	let found: Vertex | null = null
	for (const v of board.vertices) {
		const vs = vertexStateOf(state, v)
		if (!vs.occupied || vs.player !== playerIdx) continue
		const hasOwnRoad = board.adjacentEdges[v].some((e) => {
			const es = edgeStateOf(state, e)
			return es.occupied && es.player === playerIdx
		})
		if (hasOwnRoad) continue
		// Should be exactly one un-roaded settlement; if somehow there's a
		// second, prefer the first encountered — caller treats this as a bug.
		if (found) return found
		found = v
	}
	return found
}

// Valid road edges = unoccupied edges incident to targetSettlement(player).
export function validRoadEdges(state: GameState, playerIdx: number): Edge[] {
	const target = targetSettlement(state, playerIdx)
	if (!target) return []
	return boardFor(state.variant).adjacentEdges[target].filter(
		(e) => !edgeStateOf(state, e).occupied
	)
}

export function isValidRoadEdge(
	state: GameState,
	playerIdx: number,
	edge: Edge
): boolean {
	const target = targetSettlement(state, playerIdx)
	if (!target) return false
	if (!boardFor(state.variant).adjacentEdges[target].includes(edge))
		return false
	return !edgeStateOf(state, edge).occupied
}

// --- Starting resources -----------------------------------------------------

// Standard rule: placing the second settlement grants 1 of each adjacent
// non-desert hex's resource. Interior vertices touch 3 hexes; coastal 1–2.
export function startingResourcesForVertex(
	state: GameState,
	vertex: Vertex
): ResourceHand {
	const hand: ResourceHand = {
		brick: 0,
		wood: 0,
		sheep: 0,
		wheat: 0,
		ore: 0,
	}
	for (const h of boardFor(state.variant).adjacentHexes[vertex]) {
		const hd = state.hexes[h]
		if (hd.resource === null) continue
		hand[hd.resource] += 1
	}
	return hand
}

export function addHand(a: ResourceHand, b: ResourceHand): ResourceHand {
	const out: ResourceHand = { ...a }
	for (const r of RESOURCES) out[r] = a[r] + b[r]
	return out
}

// --- Nominating the last-placed settlement ----------------------------------

// Rewrites a seat's two placement pairs in `games.events` so the log shows the
// order the player nominated on the `pick_last` step. Only the payloads move —
// `round` and `at` stay put, which keeps timestamps monotonic and keeps each
// road with the settlement it was placed from (a road is always incident to
// its own settlement, so swapping pairwise is the whole operation).
//
// Events are located by scanning backwards for the seat's last two
// `settlement_placed` / `road_placed` entries rather than by index arithmetic,
// so an unrelated event landing between them can't corrupt the rewrite. A log
// missing either pair is returned untouched — the resource grant is the part
// that matters and it applies either way. Typed loosely because the caller is
// the edge function, which handles `games.events` as `unknown[]`.
export function swapPlacementPairs(
	events: readonly unknown[],
	playerIdx: number
): unknown[] {
	const indicesOf = (kind: string) => {
		const out: number[] = []
		for (let i = events.length - 1; i >= 0 && out.length < 2; i--) {
			const e = events[i] as { kind?: string; player?: number }
			if (e?.kind === kind && e.player === playerIdx) out.unshift(i)
		}
		return out
	}
	const settlements = indicesOf('settlement_placed')
	const roads = indicesOf('road_placed')
	if (settlements.length < 2 || roads.length < 2) return events.slice()

	const next = events.slice()
	const swap = (idxs: number[], key: 'vertex' | 'edge') => {
		const a = { ...(next[idxs[0]] as Record<string, unknown>) }
		const b = { ...(next[idxs[1]] as Record<string, unknown>) }
		const tmp = a[key]
		a[key] = b[key]
		b[key] = tmp
		next[idxs[0]] = a
		next[idxs[1]] = b
	}
	swap(settlements, 'vertex')
	swap(roads, 'edge')
	return next
}

// --- Misc -------------------------------------------------------------------

// Confirms that an edge touches a vertex. Useful in tests/assertions.
export function edgeTouchesVertex(edge: Edge, vertex: Vertex): boolean {
	const [a, b] = edgeEndpoints(edge)
	return a === vertex || b === vertex
}
