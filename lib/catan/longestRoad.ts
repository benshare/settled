// Pure rules for the Longest Road bonus: compute a player's longest
// edge-disjoint road trail and decide who holds the bonus. No I/O; callable
// from UI helpers and tests. The edge function re-implements the same logic
// against its duplicated adjacency constants.
//
// Rule summary:
// - Trail is edge-disjoint: each road used at most once; vertices may be
//   revisited (paths can cross themselves).
// - An opponent building at an interior vertex blocks pass-through (you can
//   end a trail at that vertex but cannot continue through it). Own
//   buildings never block.
// - Bonus goes to the player with the strictly longest trail ≥ 5. Ties keep
//   the current holder; falling below 5 releases the bonus.

import {
	adjacentEdges,
	edgeEndpoints,
	EDGES,
	type Edge,
	type Vertex,
} from './board'
import { edgeStateOf, vertexStateOf, type GameState } from './types'

export const LONGEST_ROAD_THRESHOLD = 5

export function longestRoadFor(state: GameState, playerIdx: number): number {
	// Collect the player's roads. Small: up to 15 per player.
	const ownEdges: Edge[] = []
	for (const edge of EDGES) {
		const es = edgeStateOf(state, edge)
		if (es.occupied && es.player === playerIdx) ownEdges.push(edge)
	}
	if (ownEdges.length === 0) return 0

	let best = 0
	const used = new Set<Edge>()
	for (const start of ownEdges) {
		const [a, b] = edgeEndpoints(start)
		used.add(start)
		// Try extending from each endpoint of this starter edge.
		const lenA = walk(state, playerIdx, a, used)
		const lenB = walk(state, playerIdx, b, used)
		used.delete(start)
		const local = Math.max(lenA, lenB)
		if (local > best) best = local
		if (best === ownEdges.length) return best
	}
	return best
}

function walk(
	state: GameState,
	playerIdx: number,
	head: Vertex,
	used: Set<Edge>
): number {
	// Opponent building at the head blocks continuation (but the trail is
	// still valid up to here — `used.size` is the length of the trail that
	// arrived at `head`).
	const vs = vertexStateOf(state, head)
	if (vs.occupied && vs.player !== playerIdx) return used.size

	let best = used.size
	for (const e of adjacentEdges[head]) {
		if (used.has(e)) continue
		const es = edgeStateOf(state, e)
		if (!es.occupied || es.player !== playerIdx) continue
		const [a, b] = edgeEndpoints(e)
		const next = a === head ? b : a
		used.add(e)
		const len = walk(state, playerIdx, next, used)
		used.delete(e)
		if (len > best) best = len
	}
	return best
}

// Holder after a state change. Strict-majority rule with the current holder
// keeping the bonus on ties. Dropping below LONGEST_ROAD_THRESHOLD releases
// the bonus (returns null if no one else qualifies).
export function recomputeLongestRoad(state: GameState): number | null {
	const lengths = state.players.map((_, i) => longestRoadFor(state, i))

	let bestIdx: number | null = null
	let bestLen = LONGEST_ROAD_THRESHOLD - 1 // must be > this to qualify (≥ 5)
	lengths.forEach((len, i) => {
		if (len > bestLen) {
			bestLen = len
			bestIdx = i
		}
	})

	if (bestIdx === null) return null

	// Tie at the leading length — keep current holder if they're in the tie.
	const tiedAtLead = lengths
		.map((len, i) => ({ len, i }))
		.filter((e) => e.len === bestLen)
	if (tiedAtLead.length > 1) {
		if (
			state.longestRoad !== null &&
			tiedAtLead.some((e) => e.i === state.longestRoad)
		) {
			return state.longestRoad
		}
		// Brand-new tie with no incumbent — nobody qualifies.
		return null
	}

	return bestIdx
}
