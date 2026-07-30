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
	applyPlacementDraft,
	isDoublePlacementSeat,
	isValidRoadEdge,
	placementPairsExpected,
	isValidSettlementVertex,
	nextPlacementTurn,
	ownSettlementVertices,
	swapPlacementPairs,
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
			[v]: {
				occupied: true,
				player,
				building: 'settlement',
				placedTurn: 0,
			},
		},
	}
}

function placeRoad(s: GameState, e: Edge, player: number): GameState {
	return {
		...s,
		edges: { ...s.edges, [e]: { occupied: true, player, placedTurn: 0 } },
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
	const s = initialGameState('standard', 3, {
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
	const valid = validSettlementVertices(s)
	equal(valid.length, VERTICES.length, 'fresh game: all 54 vertices valid')
}

function testDistanceRule() {
	const s0 = initialGameState('standard', 3, {
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
	const s0 = initialGameState('standard', 3, {
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
	const s = placeSettlement(s0, '3F', 0)
	equal(targetSettlement(s, 0), '3F', 'round-1 target = only settlement')
	equal(targetSettlement(s, 1), null, 'other player has no target')
}

function testTargetSettlementRound2() {
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
	const s = initialGameState('standard', 3, {
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

// Only the seat that places both settlements back-to-back — the last of round
// 1, first of round 2 — gets the `pick_last` step.
function testDoublePlacementSeat() {
	for (const n of [2, 3, 4, 5, 6]) {
		for (let i = 0; i < n; i++) {
			equal(isDoublePlacementSeat(i, n), i === n - 1, `seat ${i} of ${n}`)
		}
		// It is exactly the seat that repeats across the round boundary.
		equal(
			placementTurnPlayer(1, n - 1, n),
			placementTurnPlayer(2, 0, n),
			`snake repeats seat ${n - 1} of ${n}`
		)
	}
}

function testOwnSettlementVertices() {
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
	const blocked = new Set<Vertex>([
		'3F',
		...(neighborVertices['3F'] as readonly Vertex[]),
	])
	const second = VERTICES.find((v) => !blocked.has(v))
	assert(second, 'need a non-adjacent vertex')
	const other = VERTICES.find(
		(v) =>
			!blocked.has(v) &&
			v !== second &&
			!(neighborVertices[second] as readonly Vertex[]).includes(v)
	)
	assert(other, 'need a third non-adjacent vertex')

	s = placeSettlement(s, '3F', 2)
	s = placeSettlement(s, second, 2)
	s = placeSettlement(s, other, 0)

	assertVerticesEqual(
		ownSettlementVertices(s, 2),
		['3F', second],
		'seat 2 owns both of its settlements'
	)
	assertVerticesEqual(
		ownSettlementVertices(s, 0),
		[other],
		'seat 0 owns only its own'
	)
	assertVerticesEqual(ownSettlementVertices(s, 1), [], 'seat 1 owns none')

	// Ghosts (haunt) sit on the board but are not the player's placements.
	s = {
		...s,
		vertices: {
			...s.vertices,
			[other]: {
				occupied: true,
				player: 0,
				building: 'ghost',
				placedTurn: 0,
			},
		},
	}
	assertVerticesEqual(
		ownSettlementVertices(s, 0),
		[],
		'ghosts are not own settlements'
	)
}

// The `pick_last` log rewrite: the two (settlement, road) pairs trade
// payloads, everything else — including other seats' events — stays put.
function testSwapPlacementPairs() {
	const log = [
		{
			kind: 'settlement_placed',
			player: 0,
			vertex: 'A0',
			round: 1,
			at: '1',
		},
		{ kind: 'road_placed', player: 0, edge: 'a0', round: 1, at: '2' },
		{
			kind: 'settlement_placed',
			player: 2,
			vertex: 'X',
			round: 1,
			at: '3',
		},
		{ kind: 'road_placed', player: 2, edge: 'x', round: 1, at: '4' },
		{
			kind: 'settlement_placed',
			player: 2,
			vertex: 'Y',
			round: 2,
			at: '5',
		},
		{ kind: 'road_placed', player: 2, edge: 'y', round: 2, at: '6' },
	]
	const out = swapPlacementPairs(log, 2) as typeof log

	equal(out.length, log.length, 'length unchanged')
	equal(out[0].vertex, 'A0', "another seat's settlement untouched")
	equal(out[1].edge, 'a0', "another seat's road untouched")
	equal(out[2].vertex, 'Y', 'round-1 slot now holds the round-2 settlement')
	equal(out[3].edge, 'y', 'its road came with it')
	equal(out[4].vertex, 'X', 'round-2 slot now holds the round-1 settlement')
	equal(out[5].edge, 'x', 'its road came with it')
	// Rounds and timestamps describe the slot, not the piece, so they stay.
	equal(out[2].round, 1, 'round stays with the slot')
	equal(out[4].round, 2, 'round stays with the slot')
	equal(out.map((e) => e.at).join(''), '123456', 'timestamps stay monotonic')
	// Input is not mutated.
	equal(log[2].vertex, 'X', 'input log untouched')

	// Swapping twice is the identity, so nominating the round-2 settlement
	// (which the caller skips) would have been a no-op either way.
	const back = swapPlacementPairs(out, 2) as typeof log
	equal(
		back.map((e) => e.vertex ?? e.edge).join(','),
		'A0,a0,X,x,Y,y',
		'swap is an involution'
	)

	// A log missing a pair is returned as-is rather than half-rewritten.
	const partial = [log[0], log[1], log[2], log[3]]
	const untouched = swapPlacementPairs(partial, 0) as typeof log
	equal(untouched[0].vertex, 'A0', 'incomplete pairs left alone')
}

function testValidSettlementExcludesAllNeighbors() {
	const s0 = initialGameState('standard', 3, {
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

// A whole turn is chosen locally before it's sent, so the second pair's valid
// spots have to be computed against the first pair applied.
function testApplyPlacementDraft() {
	const s0 = initialGameState('standard', 3, {
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

	// Settlement only: the road step's targets are that settlement's edges.
	const firstEdge = adjacentEdges['3F'][0] as Edge
	const afterSettlement = applyPlacementDraft(s0, 2, [{ vertex: '3F' }])
	assertVerticesEqual(
		validRoadEdges(afterSettlement, 2),
		adjacentEdges['3F'] as Vertex[] as Edge[],
		'road targets = the drafted settlement’s edges'
	)

	// Pair applied: the distance rule sees the drafted settlement.
	const afterPair = applyPlacementDraft(s0, 2, [
		{ vertex: '3F', edge: firstEdge },
	])
	assert(
		!isValidSettlementVertex(afterPair, '3F', 2),
		'drafted settlement occupies its vertex'
	)
	for (const n of neighborVertices['3F']) {
		assert(
			!isValidSettlementVertex(afterPair, n as Vertex, 2),
			`neighbor ${n} blocked by the drafted settlement`
		)
	}

	// Second pair: its road attaches to the second settlement, not the first.
	const blocked = new Set<Vertex>([
		'3F',
		...(neighborVertices['3F'] as readonly Vertex[]),
	])
	const second = VERTICES.find((v) => !blocked.has(v))
	assert(second, 'need a far vertex')
	const afterSecond = applyPlacementDraft(s0, 2, [
		{ vertex: '3F', edge: firstEdge },
		{ vertex: second },
	])
	assertVerticesEqual(
		validRoadEdges(afterSecond, 2),
		adjacentEdges[second] as Vertex[] as Edge[],
		'second road targets the second settlement'
	)

	// Nothing drafted leaves the state alone, so an untouched turn renders
	// exactly what the server sent.
	equal(applyPlacementDraft(s0, 2, []), s0, 'empty draft is identity')
}

// Only seat N-1 submits two pairs, and only on its round-1 turn — its round-2
// turn is the same submission.
function testPlacementPairsExpected() {
	for (const n of [2, 3, 4, 5, 6]) {
		for (let i = 0; i < n; i++) {
			equal(
				placementPairsExpected(1, i, n),
				i === n - 1 ? 2 : 1,
				`round 1, seat ${i} of ${n}`
			)
			equal(placementPairsExpected(2, i, n), 1, `round 2, seat ${i}`)
		}
	}
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
	['double-placement seat', testDoublePlacementSeat],
	['own settlement vertices', testOwnSettlementVertices],
	['pick_last log swap', testSwapPlacementPairs],
	['local draft simulation', testApplyPlacementDraft],
	['pairs expected per turn', testPlacementPairsExpected],
]

for (const [name, fn] of tests) {
	fn()
	console.log(`  ok  ${name}`)
}
console.log(`OK: ${tests.length} placement tests passed.`)
