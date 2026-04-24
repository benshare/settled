// Pure helpers for the initial-placement phase. No I/O — usable from client UI
// (compute valid highlights) or a test harness. The edge function re-implements
// the same logic against its duplicated adjacency constants.

import {
	RESOURCES,
	VERTICES,
	adjacentEdges,
	adjacentHexes,
	edgeEndpoints,
	neighborVertices,
	type Edge,
	type Vertex,
} from './board'
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
	for (const n of neighborVertices[vertex]) {
		if (vertexStateOf(state, n).occupied) return false
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
	return VERTICES.filter((v) => isValidSettlementVertex(state, v, playerIdx))
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
	let found: Vertex | null = null
	for (const v of VERTICES) {
		const vs = vertexStateOf(state, v)
		if (!vs.occupied || vs.player !== playerIdx) continue
		const hasOwnRoad = adjacentEdges[v].some((e) => {
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
	return adjacentEdges[target].filter((e) => !edgeStateOf(state, e).occupied)
}

export function isValidRoadEdge(
	state: GameState,
	playerIdx: number,
	edge: Edge
): boolean {
	const target = targetSettlement(state, playerIdx)
	if (!target) return false
	if (!adjacentEdges[target].includes(edge)) return false
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
	for (const h of adjacentHexes[vertex]) {
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

// --- Misc -------------------------------------------------------------------

// Confirms that an edge touches a vertex. Useful in tests/assertions.
export function edgeTouchesVertex(edge: Edge, vertex: Vertex): boolean {
	const [a, b] = edgeEndpoints(edge)
	return a === vertex || b === vertex
}
