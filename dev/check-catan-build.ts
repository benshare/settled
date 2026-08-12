// Runtime checks for lib/catan/build.ts. Run with
// `npx tsx dev/check-catan-build.ts`. Exits 0 on success; throws on the first
// failure.

import {
	adjacentEdges,
	boardFor,
	edgeBetween,
	edgeEndpoints,
	neighborVertices,
	type Edge,
	type Vertex,
} from '../lib/catan/board'
import {
	BUILD_COSTS,
	canAfford,
	canBuildFence,
	deductHand,
	isValidBuildCityVertex,
	isValidBuildRoadEdge,
	payableBuildRoadEdges,
	validBuildCityVertices,
	validBuildFenceEdges,
	validBuildRoadEdges,
	validBuildSettlementVertices,
} from '../lib/catan/build'
import { isOwnFence } from '../lib/catan/bonus'
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
			[v]: {
				occupied: true,
				player,
				building: 'settlement',
				placedTurn: 0,
			},
		},
	}
}

function upgradeToCity(s: GameState, v: Vertex, player: number): GameState {
	return {
		...s,
		vertices: {
			...s.vertices,
			[v]: { occupied: true, player, building: 'city', placedTurn: 0 },
		},
	}
}

function placeRoad(s: GameState, e: Edge, player: number): GameState {
	return {
		...s,
		edges: { ...s.edges, [e]: { occupied: true, player, placedTurn: 0 } },
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
	let s = initialGameState('standard', 3, {
		bonuses: false,
		bonusSets: ['1'],
		bannedCombos: true,
		bonusCount: 2,
		curseCount: 1,
		devCards: false,
		numberLayout: 'random',
		honk: true,
		friendlyRobber: false,
		limitMonopoly: false,
		tradeMode: 'automatic',
		spectators: true,
		timeout: null,
		extraBuild: {
			enabled: false,
			buildPhases: 'every',
			moreThanSeven: false,
		},
	})
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
	let s = initialGameState('standard', 3, {
		bonuses: false,
		bonusSets: ['1'],
		bannedCombos: true,
		bonusCount: 2,
		curseCount: 1,
		devCards: false,
		numberLayout: 'random',
		honk: true,
		friendlyRobber: false,
		limitMonopoly: false,
		tradeMode: 'automatic',
		spectators: true,
		timeout: null,
		extraBuild: {
			enabled: false,
			buildPhases: 'every',
			moreThanSeven: false,
		},
	})
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
	let s = initialGameState('standard', 3, {
		bonuses: false,
		bonusSets: ['1'],
		bannedCombos: true,
		bonusCount: 2,
		curseCount: 1,
		devCards: false,
		numberLayout: 'random',
		honk: true,
		friendlyRobber: false,
		limitMonopoly: false,
		tradeMode: 'automatic',
		spectators: true,
		timeout: null,
		extraBuild: {
			enabled: false,
			buildPhases: 'every',
			moreThanSeven: false,
		},
	})
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
	let s = initialGameState('standard', 3, {
		bonuses: false,
		bonusSets: ['1'],
		bannedCombos: true,
		bonusCount: 2,
		curseCount: 1,
		devCards: false,
		numberLayout: 'random',
		honk: true,
		friendlyRobber: false,
		limitMonopoly: false,
		tradeMode: 'automatic',
		spectators: true,
		timeout: null,
		extraBuild: {
			enabled: false,
			buildPhases: 'every',
			moreThanSeven: false,
		},
	})
	s = placeSettlement(s, '3F', 0)
	// No road yet — no valid settlement sites.
	equal(
		validBuildSettlementVertices(s, 0).length,
		0,
		'no road → no valid settlement targets'
	)
}

function testCityValidity() {
	let s = initialGameState('standard', 3, {
		bonuses: false,
		bonusSets: ['1'],
		bannedCombos: true,
		bonusCount: 2,
		curseCount: 1,
		devCards: false,
		numberLayout: 'random',
		honk: true,
		friendlyRobber: false,
		limitMonopoly: false,
		tradeMode: 'automatic',
		spectators: true,
		timeout: null,
		extraBuild: {
			enabled: false,
			buildPhases: 'every',
			moreThanSeven: false,
		},
	})
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

function placeFence(s: GameState, e: Edge, player: number): GameState {
	return { ...s, fenceTokens: { ...(s.fenceTokens ?? {}), [e]: player } }
}

// A 3-player set-3 game with seat 0 settled at 3F. Every fencer test builds
// off this.
function fencerState(): GameState {
	const s = initialGameState('standard', 3, {
		bonuses: true,
		bonusSets: ['3'],
		bannedCombos: true,
		bonusCount: 2,
		curseCount: 1,
		devCards: false,
		numberLayout: 'random',
		honk: true,
		friendlyRobber: false,
		limitMonopoly: false,
		tradeMode: 'automatic',
		spectators: true,
		timeout: null,
		extraBuild: {
			enabled: false,
			buildPhases: 'every',
			moreThanSeven: false,
		},
	})
	return placeSettlement(
		{
			...s,
			players: s.players.map((p, i) =>
				i === 0 ? { ...p, bonus: 'fencer' } : p
			),
		},
		'3F',
		0
	)
}

function withHand(s: GameState, h: ResourceHand, player = 0): GameState {
	return {
		...s,
		players: s.players.map((p, i) =>
			i === player ? { ...p, resources: h } : p
		),
	}
}

// A fence places under road connectivity, except that the fencer's own fences
// chain where roads do not.
function testFenceValidity() {
	const s = fencerState()
	const first = adjacentEdges['3F'][0] as Edge
	assert(
		validBuildFenceEdges(s, 0).includes(first),
		'a fence reaches an edge off the settlement'
	)

	const fenced = placeFence(s, first, 0)
	assert(
		!validBuildFenceEdges(fenced, 0).includes(first),
		'an already-fenced edge is taken'
	)
	// Edges past the far end of `first` — reachable only through the fence.
	const far = edgeEndpoints(first).find((v) => v !== '3F') as Vertex
	const beyond = adjacentEdges[far].filter((e) => e !== first) as Edge[]
	assert(beyond.length > 0, 'the fenced edge has an onward edge')
	for (const e of beyond) {
		assert(
			validBuildFenceEdges(fenced, 0).includes(e),
			'a fence chains off another fence'
		)
		assert(
			!validBuildRoadEdges(fenced, 0).includes(e),
			'a road does NOT chain off a fence'
		)
		assert(
			!validBuildSettlementVertices(fenced, 0).length ||
				!validBuildSettlementVertices(fenced, 0).includes(
					edgeEndpoints(e).find((v) => v !== '3F') as Vertex
				),
			'a fence does not satisfy settlement adjacency'
		)
	}

	// Occupied edges are out, and a non-fencer gets nothing at all.
	const roaded = placeRoad(s, first, 0)
	assert(
		!validBuildFenceEdges(roaded, 0).includes(first),
		'an occupied edge is out'
	)
	const notFencer: GameState = {
		...s,
		players: s.players.map((p, i) =>
			i === 0 ? { ...p, bonus: 'smith' } : p
		),
	}
	equal(
		validBuildFenceEdges(notFencer, 0).length,
		0,
		'a non-fencer has no fence targets'
	)

	// Another player's fence blocks their roads but leaves their fences alone
	// (they have none there to chain from anyway).
	const theirs = placeFence(s, first, 1)
	assert(
		!validBuildRoadEdges(theirs, 0).includes(first),
		"an opponent's fence blocks a road"
	)
	assert(
		!validBuildFenceEdges(theirs, 0).includes(first),
		"an opponent's fence blocks a fence"
	)
}

// Roads and fences come out of one 15-piece supply, but the upgrade is
// supply-neutral and stays legal at the cap.
function testFenceSupplyCap() {
	const s = fencerState()
	const first = adjacentEdges['3F'][0] as Edge
	// 14 roads elsewhere on the board + the one fence = 15 pieces.
	let full = placeFence(s, first, 0)
	const filler = boardFor(full.variant)
		.edges.filter((e) => e !== first)
		.slice(0, 14)
	for (const e of filler) full = placeRoad(full, e, 0)

	full = withHand(full, hand({ wood: 4, brick: 4 }))
	equal(validBuildFenceEdges(full, 0).length, 0, 'at the cap, no new fence')
	assert(
		validBuildRoadEdges(full, 0).includes(first),
		'the upgrade is supply-neutral, so it survives the cap'
	)
	assert(
		!validBuildRoadEdges(full, 0).some((e) => e !== first),
		'but no fresh road at the cap'
	)
}

// A fencer short of Wood + Brick is narrowed to the 1-brick upgrade on their
// own fences instead of being blocked outright.
function testFencerPayableRoads() {
	const s = placeFence(fencerState(), adjacentEdges['3F'][0] as Edge, 0)
	const fenced = adjacentEdges['3F'][0] as Edge

	const both = withHand(s, hand({ wood: 1, brick: 1 }))
	equal(
		payableBuildRoadEdges(both, 0).length,
		validBuildRoadEdges(both, 0).length,
		'full cost in hand keeps every legal edge'
	)

	const brickOnly = withHand(s, hand({ brick: 1 }))
	equal(
		payableBuildRoadEdges(brickOnly, 0).length,
		1,
		'brick-only: the upgrade only'
	)
	equal(payableBuildRoadEdges(brickOnly, 0)[0], fenced, 'and it is the fence')

	equal(
		payableBuildRoadEdges(withHand(s, hand({ wood: 3 })), 0).length,
		0,
		'wood alone buys no road — the upgrade needs brick'
	)

	const smith: GameState = {
		...s,
		players: s.players.map((p, i) =>
			i === 0
				? { ...p, bonus: 'smith', resources: hand({ brick: 1 }) }
				: p
		),
	}
	equal(
		payableBuildRoadEdges(smith, 0).length,
		0,
		'a non-fencer gets no upgrade price'
	)
}

function testFenceCostAndGate() {
	const s = placeFence(fencerState(), adjacentEdges['3F'][0] as Edge, 0)
	const fenced = adjacentEdges['3F'][0] as Edge
	const other = adjacentEdges['3F'][1] as Edge

	assert(isOwnFence(s, fenced, 0), "the fence is the owner's")
	assert(!isOwnFence(s, other, 0), 'a bare edge is not a fence')
	assert(!isOwnFence(s, fenced, 1), "and it is not anyone else's")

	assert(
		canBuildFence(withHand(s, hand({ wood: 1 })), 0),
		'1 wood and a legal edge is enough'
	)
	assert(
		!canBuildFence(withHand(s, hand({ brick: 5 })), 0),
		'no wood, no fence'
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
	['fence validity', testFenceValidity],
	['fence shares the road supply', testFenceSupplyCap],
	['fencer payable road edges', testFencerPayableRoads],
	['fence cost + build gate', testFenceCostAndGate],
]

for (const [name, fn] of tests) {
	fn()
	console.log(`  ok  ${name}`)
}
console.log(`OK: ${tests.length} build tests passed.`)
