// Runtime checks for lib/catan/placement.ts. Run with
// `npx tsx dev/check-catan-placement.ts`. Exits 0 on success; throws with a
// specific message on the first failure.

import {
	VERTICES,
	adjacentEdges,
	adjacentHexes,
	edgeBetween,
	neighborVertices,
	type Edge,
	type Hex,
	type Vertex,
} from '../lib/catan/board'
import { initialGameState } from '../lib/catan/generate'
import {
	isValidRoadEdge,
	isValidSettlementVertex,
	nextPlacementTurn,
	placementTurnPlayer,
	startingResourcesForVertex,
	targetSettlement,
	validRoadEdges,
	validSettlementVertices,
} from '../lib/catan/placement'
import type { GameState } from '../lib/catan/types'

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(`assert: ${msg}`)
}

function equal(a: unknown, b: unknown, msg: string) {
	if (a !== b) throw new Error(`${msg}: ${a} !== ${b}`)
}

function placeSettlement(s: GameState, v: Vertex, player: number): GameState {
	return {
		...s,
		vertices: {
			...s.vertices,
			[v]: { occupied: true, player, building: 'settlement' },
		},
	}
}

function placeRoad(s: GameState, e: Edge, player: number): GameState {
	return {
		...s,
		edges: { ...s.edges, [e]: { occupied: true, player } },
	}
}

function assertVerticesEqual(got: Vertex[], want: Vertex[], msg: string) {
	const gs = new Set(got)
	const ws = new Set(want)
	for (const v of ws) {
		if (!gs.has(v)) throw new Error(`${msg}: missing ${v}`)
	}
	for (const v of gs) {
		if (!ws.has(v)) throw new Error(`${msg}: unexpected ${v}`)
	}
}

// --- Tests -----------------------------------------------------------------

function testFreshGameAllValid() {
	const s = initialGameState('standard', 3)
	const valid = validSettlementVertices(s)
	equal(valid.length, VERTICES.length, 'fresh game: all 54 vertices valid')
}

function testDistanceRule() {
	const s0 = initialGameState('standard', 3)
	const s = placeSettlement(s0, '3F', 0)
	assert(
		!isValidSettlementVertex(s, '3F'),
		'occupied vertex must not be valid'
	)
	for (const n of neighborVertices['3F']) {
		assert(
			!isValidSettlementVertex(s, n as Vertex),
			`neighbor ${n} of 3F must be invalid`
		)
	}
	// A vertex 2+ steps away should still be valid. Pick one not in 3F's
	// neighbor set, non-adjacent, and not 3F itself.
	const blocked = new Set<Vertex>([
		'3F',
		...(neighborVertices['3F'] as readonly Vertex[]),
	])
	const farVertex = VERTICES.find((v) => !blocked.has(v))
	assert(farVertex, 'need a far vertex for test')
	assert(
		isValidSettlementVertex(s, farVertex),
		`far vertex ${farVertex} should be valid`
	)
}

function testTargetSettlementRound1() {
	const s0 = initialGameState('standard', 3)
	const s = placeSettlement(s0, '3F', 0)
	equal(targetSettlement(s, 0), '3F', 'round-1 target = only settlement')
	equal(targetSettlement(s, 1), null, 'other player has no target')
}

function testTargetSettlementRound2() {
	let s = initialGameState('standard', 3)
	// Round 1: player 0 places settlement 3F + a road on one of its edges.
	s = placeSettlement(s, '3F', 0)
	const firstEdge = adjacentEdges['3F'][0] as Edge
	s = placeRoad(s, firstEdge, 0)
	// Round 2: player 0 places a second settlement far away, no road yet.
	// Pick a vertex guaranteed non-adjacent to 3F.
	const blocked = new Set<Vertex>([
		'3F',
		...(neighborVertices['3F'] as readonly Vertex[]),
	])
	const farVertex = VERTICES.find((v) => !blocked.has(v))
	assert(farVertex, 'need far vertex')
	s = placeSettlement(s, farVertex, 0)
	equal(
		targetSettlement(s, 0),
		farVertex,
		'round-2 target = the un-roaded settlement'
	)
}

function testValidRoadEdges() {
	let s = initialGameState('standard', 3)
	s = placeSettlement(s, '3F', 0)
	const edges = validRoadEdges(s, 0)
	assert(edges.length > 0 && edges.length <= 3, 'road count 1..3')
	for (const e of edges) {
		assert(
			adjacentEdges['3F'].includes(e),
			`road ${e} must touch target settlement`
		)
		assert(
			isValidRoadEdge(s, 0, e),
			`isValidRoadEdge should agree for ${e}`
		)
	}
	// Roads not incident to 3F are invalid.
	const otherEdge = edgeBetween('1A', '1B') as Edge
	equal(isValidRoadEdge(s, 0, otherEdge), false, 'non-incident road rejected')
}

function testStartingResourcesInterior() {
	const s = initialGameState('standard', 3)
	// Find an interior vertex (touches 3 hexes).
	const interior = VERTICES.find((v) => adjacentHexes[v].length === 3)
	assert(interior, 'board must have at least one interior vertex')
	const hand = startingResourcesForVertex(s, interior)
	const total = hand.wood + hand.wheat + hand.sheep + hand.brick + hand.ore
	// Interior vertex touches 3 hexes; 0..3 could be desert. On the standard
	// board only 1 desert exists, so total is 2 or 3.
	const desertCount = adjacentHexes[interior].filter(
		(h: Hex) => s.hexes[h].resource === null
	).length
	equal(
		total,
		3 - desertCount,
		`interior hand total = 3 - deserts (${desertCount})`
	)
}

function testNextPlacementTurnBoundaries() {
	// Round 1, 3 players.
	let t = nextPlacementTurn(1, 0, 3)
	assert(t && t.round === 1 && t.currentTurn === 1, 'r1 0->1')
	t = nextPlacementTurn(1, 1, 3)
	assert(t && t.round === 1 && t.currentTurn === 2, 'r1 1->2')
	// Last player of round 1 becomes first of round 2 (same index).
	t = nextPlacementTurn(1, 2, 3)
	assert(t && t.round === 2 && t.currentTurn === 2, 'r1 2 -> r2 2')
	t = nextPlacementTurn(2, 2, 3)
	assert(t && t.round === 2 && t.currentTurn === 1, 'r2 2->1')
	t = nextPlacementTurn(2, 1, 3)
	assert(t && t.round === 2 && t.currentTurn === 0, 'r2 1->0')
	// End of placement.
	t = nextPlacementTurn(2, 0, 3)
	equal(t, null, 'r2 0 -> null (placement complete)')

	// Sanity: placementTurnPlayer snake logic.
	equal(placementTurnPlayer(1, 0, 4), 0, 'r1 p0')
	equal(placementTurnPlayer(1, 3, 4), 3, 'r1 p3')
	equal(placementTurnPlayer(2, 0, 4), 3, 'r2 first is last of r1')
	equal(placementTurnPlayer(2, 3, 4), 0, 'r2 last is first of r1')
}

function testValidSettlementExcludesAllNeighbors() {
	const s0 = initialGameState('standard', 3)
	const s = placeSettlement(s0, '3F', 0)
	const valid = new Set(validSettlementVertices(s))
	const want = new Set<Vertex>(VERTICES)
	want.delete('3F')
	for (const n of neighborVertices['3F']) want.delete(n as Vertex)
	assertVerticesEqual(
		Array.from(valid),
		Array.from(want),
		'valid set excludes 3F + neighbors'
	)
}

// --- Run ------------------------------------------------------------------

const tests: [string, () => void][] = [
	['fresh game: all vertices valid', testFreshGameAllValid],
	['distance rule', testDistanceRule],
	[
		'valid settlements excludes neighbors',
		testValidSettlementExcludesAllNeighbors,
	],
	['target settlement — round 1', testTargetSettlementRound1],
	['target settlement — round 2', testTargetSettlementRound2],
	['valid road edges', testValidRoadEdges],
	['starting resources — interior', testStartingResourcesInterior],
	['nextPlacementTurn boundaries', testNextPlacementTurnBoundaries],
]

for (const [name, fn] of tests) {
	fn()
	console.log(`  ok  ${name}`)
}
console.log(`OK: ${tests.length} placement tests passed.`)
