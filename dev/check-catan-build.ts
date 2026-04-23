// Runtime checks for lib/catan/build.ts. Run with
// `npx tsx dev/check-catan-build.ts`. Exits 0 on success; throws on the first
// failure.

import {
	adjacentEdges,
	edgeBetween,
	neighborVertices,
	type Edge,
	type Vertex,
} from '../lib/catan/board'
import {
	BUILD_COSTS,
	canAfford,
	deductHand,
	isValidBuildCityVertex,
	isValidBuildRoadEdge,
	validBuildCityVertices,
	validBuildRoadEdges,
	validBuildSettlementVertices,
} from '../lib/catan/build'
import { initialGameState } from '../lib/catan/generate'
import type { GameState, ResourceHand } from '../lib/catan/types'

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(`assert: ${msg}`)
}
function equal(a: unknown, b: unknown, msg: string) {
	if (a !== b) throw new Error(`${msg}: ${a} !== ${b}`)
}

function hand(partial: Partial<ResourceHand>): ResourceHand {
	return {
		wood: partial.wood ?? 0,
		wheat: partial.wheat ?? 0,
		sheep: partial.sheep ?? 0,
		brick: partial.brick ?? 0,
		ore: partial.ore ?? 0,
	}
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

function upgradeToCity(s: GameState, v: Vertex, player: number): GameState {
	return {
		...s,
		vertices: {
			...s.vertices,
			[v]: { occupied: true, player, building: 'city' },
		},
	}
}

function placeRoad(s: GameState, e: Edge, player: number): GameState {
	return {
		...s,
		edges: { ...s.edges, [e]: { occupied: true, player } },
	}
}

// --- Tests -----------------------------------------------------------------

function testCanAfford() {
	const h = hand({ wood: 2, brick: 1 })
	assert(canAfford(h, BUILD_COSTS.road), 'can afford road with 2W+1B')
	assert(
		!canAfford(h, BUILD_COSTS.settlement),
		'cannot afford settlement without sheep+wheat'
	)
	assert(!canAfford(h, BUILD_COSTS.city), 'cannot afford city without ore')
}

function testDeductHand() {
	const h = hand({ wood: 2, brick: 1, sheep: 3 })
	const after = deductHand(h, BUILD_COSTS.road)
	equal(after.wood, 1, 'wood -1')
	equal(after.brick, 0, 'brick -1')
	equal(after.sheep, 3, 'sheep unchanged')
}

function testRoadValidity() {
	let s = initialGameState('standard', 3, { bonuses: false, devCards: false })
	s = placeSettlement(s, '3F', 0)
	const firstEdge = adjacentEdges['3F'][0] as Edge
	s = placeRoad(s, firstEdge, 0)
	// Extension off my road chain should be valid.
	const edges = validBuildRoadEdges(s, 0)
	assert(edges.length > 0, 'player 0 should have road options')
	assert(edges.includes(firstEdge) === false, 'occupied edge not in valids')
	// Player 1 has no pieces — no valid edges.
	equal(validBuildRoadEdges(s, 1).length, 0, 'player 1 has no roads')
}

function testRoadBlockedByOpponentSettlement() {
	let s = initialGameState('standard', 3, { bonuses: false, devCards: false })
	// Player 0 settles at 3E and builds a road out to 4E.
	s = placeSettlement(s, '3E', 0)
	const seedEdge = edgeBetween('3E', '4E') as Edge
	assert(seedEdge, 'edge 3E-4E exists')
	s = placeRoad(s, seedEdge, 0)
	// Opponent plants a settlement on 4E, blocking my chain through it.
	s = placeSettlement(s, '4E', 1)
	const onward = adjacentEdges['4E'].filter((e) => e !== seedEdge)
	assert(onward.length > 0, 'vertex should have other edges')
	for (const e of onward) {
		if (edgeStateOfUnowned(s, e)) {
			equal(
				isValidBuildRoadEdge(s, 0, e),
				false,
				`road through opponent at 4E blocked: ${e}`
			)
		}
	}
}

function edgeStateOfUnowned(s: GameState, e: Edge): boolean {
	const es = s.edges[e]
	return !es || !es.occupied
}

function testSettlementValidity() {
	let s = initialGameState('standard', 3, { bonuses: false, devCards: false })
	s = placeSettlement(s, '3F', 0)
	const myEdge = adjacentEdges['3F'][0] as Edge
	s = placeRoad(s, myEdge, 0)
	const valids = validBuildSettlementVertices(s, 0)
	// 3F itself and its neighbors are excluded by distance rule.
	const excluded = new Set<Vertex>([
		'3F',
		...(neighborVertices['3F'] as readonly Vertex[]),
	])
	for (const v of valids) {
		assert(!excluded.has(v), `distance-rule violation: ${v}`)
		// All returned vertices must be an endpoint of one of my roads.
		const touchesMyRoad = adjacentEdges[v].some((e) => e === myEdge)
		assert(touchesMyRoad, `${v} should connect to my road`)
	}
}

function testSettlementNeedsRoad() {
	let s = initialGameState('standard', 3, { bonuses: false, devCards: false })
	s = placeSettlement(s, '3F', 0)
	// No road yet — no valid settlement sites.
	equal(
		validBuildSettlementVertices(s, 0).length,
		0,
		'no road → no valid settlement targets'
	)
}

function testCityValidity() {
	let s = initialGameState('standard', 3, { bonuses: false, devCards: false })
	s = placeSettlement(s, '3F', 0)
	s = placeSettlement(s, '1A', 1)
	const cities = validBuildCityVertices(s, 0)
	equal(cities.length, 1, 'one settlement → one city target')
	equal(cities[0], '3F', 'city target is my settlement vertex')
	assert(
		!isValidBuildCityVertex(s, 0, '1A'),
		'opponent settlement not a city target for me'
	)
	const upgraded = upgradeToCity(s, '3F', 0)
	equal(
		validBuildCityVertices(upgraded, 0).length,
		0,
		'no settlement left to upgrade'
	)
}

// --- Run ------------------------------------------------------------------

const tests: [string, () => void][] = [
	['canAfford', testCanAfford],
	['deductHand', testDeductHand],
	['road validity', testRoadValidity],
	[
		'road blocked by opponent settlement',
		testRoadBlockedByOpponentSettlement,
	],
	['settlement validity + distance rule', testSettlementValidity],
	['settlement needs connected road', testSettlementNeedsRoad],
	['city validity', testCityValidity],
]

for (const [name, fn] of tests) {
	fn()
	console.log(`  ok  ${name}`)
}
console.log(`OK: ${tests.length} build tests passed.`)
