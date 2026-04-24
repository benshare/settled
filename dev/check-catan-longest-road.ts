// Runtime checks for lib/catan/longestRoad.ts. Run with
// `npx tsx dev/check-catan-longest-road.ts`. Exits 0 on success; throws on
// the first failure.

import type { Edge, Vertex } from '../lib/catan/board'
import { initialGameState } from '../lib/catan/generate'
import {
	LONGEST_ROAD_THRESHOLD,
	longestRoadFor,
	recomputeLongestRoad,
} from '../lib/catan/longestRoad'
import type { GameState, VertexState } from '../lib/catan/types'

function equal(a: unknown, b: unknown, msg: string) {
	if (a !== b) throw new Error(`${msg}: ${a} !== ${b}`)
}

function fresh(players = 3): GameState {
	return initialGameState('standard', players, {
		bonuses: false,
		bonusSets: ['1'],
		devCards: true,
	})
}

function withRoads(state: GameState, roads: Array<[Edge, number]>): GameState {
	const edges = { ...state.edges }
	for (const [edge, player] of roads) {
		edges[edge] = { occupied: true, player, placedTurn: 0 }
	}
	return { ...state, edges }
}

function withSettlement(
	state: GameState,
	vertex: Vertex,
	player: number,
	building: 'settlement' | 'city' = 'settlement'
): GameState {
	const next: VertexState = {
		occupied: true,
		player,
		building,
		placedTurn: 0,
	}
	return { ...state, vertices: { ...state.vertices, [vertex]: next } }
}

// --- Tests -----------------------------------------------------------------

function testEmptyBoard() {
	const s = fresh()
	equal(longestRoadFor(s, 0), 0, 'no roads → 0')
	equal(recomputeLongestRoad(s), null, 'no holder on empty board')
}

function testBelowThreshold() {
	// 4 straight edges along row 6, no holder.
	const s = withRoads(fresh(), [
		['6A - 6B', 0],
		['6B - 6C', 0],
		['6C - 6D', 0],
		['6D - 6E', 0],
	])
	equal(longestRoadFor(s, 0), 4, 'straight 4 → 4')
	equal(recomputeLongestRoad(s), null, '4 roads < threshold → null')
}

function testStraightFiveAcquires() {
	// 5 edges → first qualifier.
	const s = withRoads(fresh(), [
		['6A - 6B', 0],
		['6B - 6C', 0],
		['6C - 6D', 0],
		['6D - 6E', 0],
		['6E - 6F', 0],
	])
	equal(longestRoadFor(s, 0), 5, 'straight 5 → 5')
	equal(recomputeLongestRoad(s), 0, 'player 0 takes bonus at 5')
}

function testEndBranchExtendsTrail() {
	// 5-edge straight chain + 1 branch off one endpoint → trail of 6 via the
	// branch. (Branches off interior vertices don't extend the trail in this
	// geometry because of odd-degree vertices.)
	const s = withRoads(fresh(), [
		['6A - 6B', 0],
		['6B - 6C', 0],
		['6C - 6D', 0],
		['6D - 6E', 0],
		['6E - 6F', 0],
		['5B - 6A', 0], // branch off 6A
	])
	equal(longestRoadFor(s, 0), 6, 'end branch extends to 6')
}

function testOwnBuildingDoesNotBlock() {
	// Own settlement on interior vertex of the chain — trail unaffected.
	let s = withRoads(fresh(), [
		['6A - 6B', 0],
		['6B - 6C', 0],
		['6C - 6D', 0],
		['6D - 6E', 0],
		['6E - 6F', 0],
	])
	s = withSettlement(s, '6C', 0)
	equal(longestRoadFor(s, 0), 5, 'own settlement mid-chain → still 5')
}

function testOpponentSettlementSplitsTrail() {
	// Chain of 5. Opponent settlement at 6C blocks pass-through, leaving
	// sub-chains of 2 (6A-6B-6C) and 3 (6C-6D-6E-6F).
	let s = withRoads(fresh(), [
		['6A - 6B', 0],
		['6B - 6C', 0],
		['6C - 6D', 0],
		['6D - 6E', 0],
		['6E - 6F', 0],
	])
	s = withSettlement(s, '6C', 1)
	equal(longestRoadFor(s, 0), 3, 'opponent split → max sub-chain')
}

function testOpponentSettlementOnEndpointTerminatesTrail() {
	// Opponent settlement at the far endpoint — trail still traverses the
	// full chain (the settlement blocks continuation beyond, but there's
	// nothing beyond anyway).
	let s = withRoads(fresh(), [
		['6A - 6B', 0],
		['6B - 6C', 0],
		['6C - 6D', 0],
		['6D - 6E', 0],
		['6E - 6F', 0],
	])
	s = withSettlement(s, '6F', 1)
	equal(longestRoadFor(s, 0), 5, 'opponent at endpoint → full 5')
}

function testRecomputeStrictOvertake() {
	// Player 0 holds at 5; player 1 reaches 6. Player 1 takes.
	let s = withRoads(fresh(), [
		['6A - 6B', 0],
		['6B - 6C', 0],
		['6C - 6D', 0],
		['6D - 6E', 0],
		['6E - 6F', 0],
		// player 1 chain of 6 along row 1
		['1A - 1B', 1],
		['1B - 1C', 1],
		['1C - 1D', 1],
		['1D - 1E', 1],
		['1E - 1F', 1],
		['1F - 1G', 1],
	])
	s = { ...s, longestRoad: 0 }
	equal(recomputeLongestRoad(s), 1, 'player 1 overtakes at 6 > 5')
}

function testRecomputeTieKeepsHolder() {
	// Both at 5; player 0 is the holder. Ties keep holder.
	let s = withRoads(fresh(), [
		['6A - 6B', 0],
		['6B - 6C', 0],
		['6C - 6D', 0],
		['6D - 6E', 0],
		['6E - 6F', 0],
		['1A - 1B', 1],
		['1B - 1C', 1],
		['1C - 1D', 1],
		['1D - 1E', 1],
		['1E - 1F', 1],
	])
	s = { ...s, longestRoad: 0 }
	equal(recomputeLongestRoad(s), 0, 'tie at lead → holder keeps')
}

function testRecomputeTieNoIncumbentReturnsNull() {
	// Brand-new tie with no incumbent — nobody qualifies.
	const s = withRoads(fresh(), [
		['6A - 6B', 0],
		['6B - 6C', 0],
		['6C - 6D', 0],
		['6D - 6E', 0],
		['6E - 6F', 0],
		['1A - 1B', 1],
		['1B - 1C', 1],
		['1C - 1D', 1],
		['1D - 1E', 1],
		['1E - 1F', 1],
	])
	equal(
		recomputeLongestRoad(s),
		null,
		'tie at 5 with no holder → null (nobody has strict majority)'
	)
}

function testHolderDropsBelowThreshold() {
	// Holder had 5; split to 2+3. Nobody else qualifies.
	let s = withRoads(fresh(), [
		['6A - 6B', 0],
		['6B - 6C', 0],
		['6C - 6D', 0],
		['6D - 6E', 0],
		['6E - 6F', 0],
	])
	s = withSettlement(s, '6C', 1)
	s = { ...s, longestRoad: 0 }
	equal(
		recomputeLongestRoad(s),
		null,
		'holder drops below threshold → bonus released'
	)
}

function testThresholdConstant() {
	equal(LONGEST_ROAD_THRESHOLD, 5, 'classic Catan threshold is 5')
}

function testIsolatedSegmentsNotCounted() {
	// Two disconnected 3-chains — each is its own component. Max trail is 3.
	const s = withRoads(fresh(), [
		// Component A: bottom-right
		['6D - 6E', 0],
		['6E - 6F', 0],
		['6F - 6G', 0],
		// Component B: top-left, disconnected from A
		['1A - 1B', 0],
		['1B - 1C', 0],
		['1C - 1D', 0],
	])
	equal(longestRoadFor(s, 0), 3, 'disjoint components do not combine')
}

// --- Runner ----------------------------------------------------------------

function run() {
	const tests: Array<[string, () => void]> = [
		['testEmptyBoard', testEmptyBoard],
		['testBelowThreshold', testBelowThreshold],
		['testStraightFiveAcquires', testStraightFiveAcquires],
		['testEndBranchExtendsTrail', testEndBranchExtendsTrail],
		['testOwnBuildingDoesNotBlock', testOwnBuildingDoesNotBlock],
		[
			'testOpponentSettlementSplitsTrail',
			testOpponentSettlementSplitsTrail,
		],
		[
			'testOpponentSettlementOnEndpointTerminatesTrail',
			testOpponentSettlementOnEndpointTerminatesTrail,
		],
		['testRecomputeStrictOvertake', testRecomputeStrictOvertake],
		['testRecomputeTieKeepsHolder', testRecomputeTieKeepsHolder],
		[
			'testRecomputeTieNoIncumbentReturnsNull',
			testRecomputeTieNoIncumbentReturnsNull,
		],
		['testHolderDropsBelowThreshold', testHolderDropsBelowThreshold],
		['testThresholdConstant', testThresholdConstant],
		['testIsolatedSegmentsNotCounted', testIsolatedSegmentsNotCounted],
	]
	for (const [name, fn] of tests) {
		fn()
		console.log(`  ok ${name}`)
	}
	console.log(`\n${tests.length} tests passed`)
}

run()
