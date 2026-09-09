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
// intervening turn. Nothing fixes which of the two it placed first, so it
// drafts both pairs at once and submits them in whichever order it nominates:
// the second pair is stamped round 2 and pays the starting resources.
export function isDoublePlacementSeat(
	playerIdx: number,
	playerCount: number
): boolean {
	return playerIdx === playerCount - 1
}

// How many settlement+road pairs the seat submits in one go. The snake order
// gives seat N-1 both of its turns back-to-back, so on its round-1 turn it
// chooses all four pieces at once; everyone else chooses one pair per turn.
// Mirrored in the edge function, which validates the submitted count against it.
export function placementPairsExpected(
	round: 1 | 2,
	playerIdx: number,
	playerCount: number
): 1 | 2 {
	return round === 1 && isDoublePlacementSeat(playerIdx, playerCount) ? 2 : 1
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

// --- Road validity ----------------------------------------------------------

// While a road is being chosen, the settlement it must attach to is the
// player's settlement with no incident road they own — the one just placed.
// Every earlier settlement of theirs already got its road in the same turn.
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

// --- Local drafts -----------------------------------------------------------

// One settlement, and the road placed from it once it's been chosen. A whole
// placement turn is one of these — two for the seat that places back-to-back.
export type PlacementDraftEntry = { vertex: Vertex; edge?: Edge }

// The board as it would be with the draft applied, so validity for a later
// piece is computed against the earlier ones: the second settlement must
// respect the first's distance footprint, and its road must attach to it
// rather than to the first. Never persisted — the server applies the same
// pairs itself when the draft is submitted.
export function applyPlacementDraft(
	state: GameState,
	playerIdx: number,
	draft: readonly PlacementDraftEntry[]
): GameState {
	if (draft.length === 0) return state
	const vertices = { ...state.vertices }
	const edges = { ...state.edges }
	for (const entry of draft) {
		vertices[entry.vertex] = {
			occupied: true,
			player: playerIdx,
			building: 'settlement',
			placedTurn: state.round,
		}
		if (entry.edge === undefined) continue
		edges[entry.edge] = {
			occupied: true,
			player: playerIdx,
			placedTurn: state.round,
		}
	}
	return { ...state, vertices, edges }
}

// The draft as it is submitted: complete pairs only, with the nominated
// settlement's pair last. The server stamps the last pair round 2 and pays its
// starting resources, so pair order *is* the nomination — see
// `.claude/specs/inline-last-settlement.md`. Reordering can't invalidate a
// draft the client already accepted: the distance rule is symmetric and the
// `power`/`youth` curse checks are monotone in the settlements owned, so if
// the pair of pairs is legal at all, it is legal in either order.
export function orderedPlacementPairs(
	draft: readonly PlacementDraftEntry[],
	nominated: Vertex | null
): { vertex: Vertex; edge: Edge }[] {
	const pairs = draft.flatMap((e) =>
		e.edge === undefined ? [] : [{ vertex: e.vertex, edge: e.edge }]
	)
	if (pairs.length !== 2 || nominated === null) return pairs
	return pairs[0].vertex === nominated ? [pairs[1], pairs[0]] : pairs
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

// --- Misc -------------------------------------------------------------------

// Confirms that an edge touches a vertex. Useful in tests/assertions.
export function edgeTouchesVertex(edge: Edge, vertex: Vertex): boolean {
	const [a, b] = edgeEndpoints(edge)
	return a === vertex || b === vertex
}
