// Pure helpers for the main-phase build actions (road, settlement, city).
// Costs, affordability, and validity of build targets for a given player.
// No I/O — usable from client UI (button gating + highlight pulses) or tests.
// The edge function re-implements the same logic against its duplicated
// adjacency constants.

import {
	RESOURCES,
	VERTICES,
	adjacentEdges,
	edgeEndpoints,
	neighborVertices,
	type Edge,
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

export function canAfford(hand: ResourceHand, cost: ResourceHand): boolean {
	for (const r of RESOURCES) {
		if (hand[r] < cost[r]) return false
	}
	return true
}

export function deductHand(
	hand: ResourceHand,
	cost: ResourceHand
): ResourceHand {
	const out = { ...hand }
	for (const r of RESOURCES) out[r] = hand[r] - cost[r]
	return out
}

// --- Roads ------------------------------------------------------------------

// An edge E connects to the player through endpoint V iff:
//   - V holds one of the player's own buildings (settlement/city); or
//   - V is empty AND one of V's other adjacent edges is one of the player's
//     own roads. An opponent building on V blocks the chain through V
//     (standard "no road through opponent settlement" rule).
function roadConnectsVia(
	state: GameState,
	playerIdx: number,
	edge: Edge,
	vertex: Vertex
): boolean {
	const vs = vertexStateOf(state, vertex)
	if (vs.occupied) return vs.player === playerIdx
	for (const e of adjacentEdges[vertex]) {
		if (e === edge) continue
		const es = edgeStateOf(state, e)
		if (es.occupied && es.player === playerIdx) return true
	}
	return false
}

export function isValidBuildRoadEdge(
	state: GameState,
	playerIdx: number,
	edge: Edge
): boolean {
	if (edgeStateOf(state, edge).occupied) return false
	const [a, b] = edgeEndpoints(edge)
	return (
		roadConnectsVia(state, playerIdx, edge, a) ||
		roadConnectsVia(state, playerIdx, edge, b)
	)
}

export function validBuildRoadEdges(
	state: GameState,
	playerIdx: number
): Edge[] {
	const out: Edge[] = []
	const seen = new Set<Edge>()
	// Iterate candidate edges via the player's owned roads + buildings so we
	// don't scan all 72 edges when most aren't touched by the player at all.
	for (const v of VERTICES) {
		const vs = vertexStateOf(state, v)
		const ownsVertex = vs.occupied && vs.player === playerIdx
		const hasAdjOwnRoad = adjacentEdges[v].some((e) => {
			const es = edgeStateOf(state, e)
			return es.occupied && es.player === playerIdx
		})
		if (!ownsVertex && !hasAdjOwnRoad) continue
		// If the vertex is an opponent's building, it blocks chaining through it.
		if (vs.occupied && vs.player !== playerIdx) continue
		for (const e of adjacentEdges[v]) {
			if (seen.has(e)) continue
			seen.add(e)
			if (isValidBuildRoadEdge(state, playerIdx, e)) out.push(e)
		}
	}
	return out
}

// --- Settlements ------------------------------------------------------------

export function isValidBuildSettlementVertex(
	state: GameState,
	playerIdx: number,
	vertex: Vertex
): boolean {
	if (vertexStateOf(state, vertex).occupied) return false
	for (const n of neighborVertices[vertex]) {
		if (vertexStateOf(state, n).occupied) return false
	}
	return adjacentEdges[vertex].some((e) => {
		const es = edgeStateOf(state, e)
		return es.occupied && es.player === playerIdx
	})
}

export function validBuildSettlementVertices(
	state: GameState,
	playerIdx: number
): Vertex[] {
	return VERTICES.filter((v) =>
		isValidBuildSettlementVertex(state, playerIdx, v)
	)
}

// --- Cities -----------------------------------------------------------------

export function isValidBuildCityVertex(
	state: GameState,
	playerIdx: number,
	vertex: Vertex
): boolean {
	const vs = vertexStateOf(state, vertex)
	return (
		vs.occupied && vs.player === playerIdx && vs.building === 'settlement'
	)
}

export function validBuildCityVertices(
	state: GameState,
	playerIdx: number
): Vertex[] {
	return VERTICES.filter((v) => isValidBuildCityVertex(state, playerIdx, v))
}
