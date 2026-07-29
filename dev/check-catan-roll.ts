// Runtime checks for lib/catan/roll.ts. Run with
// `npx tsx dev/check-catan-roll.ts`. Exits 0 on success; throws with a
// specific message on the first failure.

import {
	HEXES,
	adjacentVertices,
	type Hex,
	type Vertex,
	type VertexBuilding,
} from '../lib/catan/board'
import { initialGameState } from '../lib/catan/generate'
import {
	acrossSeat,
	distributeResources,
	nextMainTurn,
	rollDice,
	specialBuildQueue,
	totalDice,
} from '../lib/catan/roll'
import type { ExtraBuildConfig, GameState } from '../lib/catan/types'

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(`assert: ${msg}`)
}

function equal(a: unknown, b: unknown, msg: string) {
	if (a !== b) throw new Error(`${msg}: ${a} !== ${b}`)
}

function placeBuilding(
	s: GameState,
	v: Vertex,
	player: number,
	building: VertexBuilding
): GameState {
	return {
		...s,
		vertices: {
			...s.vertices,
			[v]: { occupied: true, player, building, placedTurn: 0 },
		},
	}
}

// Find a non-desert hex whose resource+number we can trigger in tests.
function firstResourceHex(s: GameState): { hex: Hex; number: number } {
	for (const h of HEXES) {
		const hd = s.hexes[h]
		if (hd.resource !== null) return { hex: h, number: hd.number }
	}
	throw new Error('no resource hex on board')
}

// --- Tests -----------------------------------------------------------------

function testRolledSevenYieldsNothing() {
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
		extraBuild: {
			enabled: false,
			buildPhases: 'every',
			moreThanSeven: false,
		},
	})
	const gains = distributeResources(s, 7)
	equal(Object.keys(gains).length, 0, 'rolling 7 returns empty gains')
}

function testSettlementGetsOne() {
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
		extraBuild: {
			enabled: false,
			buildPhases: 'every',
			moreThanSeven: false,
		},
	})
	const { hex, number } = firstResourceHex(s0)
	const v = adjacentVertices[hex][0] as Vertex
	const s = placeBuilding(s0, v, 0, 'settlement')
	const gains = distributeResources(s, number)
	assert(gains[0], 'player 0 should receive gains')
	const hd = s.hexes[hex]
	if (hd.resource === null) throw new Error('unreachable: hex is desert')
	equal(gains[0][hd.resource], 1, 'settlement pays 1')
}

function testCityGetsTwo() {
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
		extraBuild: {
			enabled: false,
			buildPhases: 'every',
			moreThanSeven: false,
		},
	})
	const { hex, number } = firstResourceHex(s0)
	const v = adjacentVertices[hex][0] as Vertex
	const s = placeBuilding(s0, v, 0, 'city')
	const gains = distributeResources(s, number)
	const hd = s.hexes[hex]
	if (hd.resource === null) throw new Error('unreachable: hex is desert')
	equal(gains[0][hd.resource], 2, 'city pays 2')
}

function testMismatchedRollPaysNothing() {
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
		extraBuild: {
			enabled: false,
			buildPhases: 'every',
			moreThanSeven: false,
		},
	})
	const { hex, number } = firstResourceHex(s0)
	const v = adjacentVertices[hex][0] as Vertex
	const s = placeBuilding(s0, v, 0, 'settlement')
	// Pick a total that's neither 7 nor the hex's number.
	const other = number === 6 ? 8 : 6
	const gains = distributeResources(s, other)
	assert(
		!gains[0],
		'no gain when roll does not match any hex the player touches'
	)
}

function testNextMainTurnWraps() {
	equal(nextMainTurn(0, 3), 1, '0 -> 1')
	equal(nextMainTurn(1, 3), 2, '1 -> 2')
	equal(nextMainTurn(2, 3), 0, '2 -> 0 (wrap)')
	equal(nextMainTurn(0, 1), 0, '1-player wraps to self')
}

function testRollDiceBounds() {
	for (let i = 0; i < 1000; i++) {
		const r = rollDice()
		assert(r.a >= 1 && r.a <= 6, `die a in range: got ${r.a}`)
		assert(r.b >= 1 && r.b <= 6, `die b in range: got ${r.b}`)
		const t = totalDice(r)
		assert(t >= 2 && t <= 12, `total in range: got ${t}`)
	}
}

function ebq(
	enabled: boolean,
	buildPhases: 'every' | 'across'
): ExtraBuildConfig {
	return { enabled, buildPhases, moreThanSeven: false }
}

function arrEqual(a: number[], b: number[], msg: string) {
	equal(a.join(','), b.join(','), msg)
}

function testAcrossSeat() {
	equal(acrossSeat(0, 6), 3, '6p: 0 across 3')
	equal(acrossSeat(3, 6), 0, '6p: 3 across 0')
	equal(acrossSeat(5, 6), 2, '6p: 5 across 2')
	equal(acrossSeat(0, 5), 2, '5p: 0 across 2 (floor)')
	equal(acrossSeat(4, 5), 1, '5p: 4 across 1')
}

function testSpecialBuildQueue() {
	arrEqual(specialBuildQueue(ebq(false, 'every'), 0, 6), [], 'disabled -> []')
	arrEqual(specialBuildQueue(ebq(true, 'every'), 0, 4), [], '4 players -> []')
	// every: all others, clockwise from the next seat (next roller included)
	arrEqual(
		specialBuildQueue(ebq(true, 'every'), 0, 6),
		[1, 2, 3, 4, 5],
		'6p every from 0'
	)
	arrEqual(
		specialBuildQueue(ebq(true, 'every'), 2, 5),
		[3, 4, 0, 1],
		'5p every from 2'
	)
	// across: exactly one builder
	arrEqual(specialBuildQueue(ebq(true, 'across'), 0, 6), [3], '6p across 0')
	arrEqual(specialBuildQueue(ebq(true, 'across'), 3, 6), [0], '6p across 3')
	// across over a full 5-player round is a permutation (each player once)
	const builders = [0, 1, 2, 3, 4].map(
		(x) => specialBuildQueue(ebq(true, 'across'), x, 5)[0]
	)
	arrEqual(builders, [2, 3, 4, 0, 1], '5p across full round')
	equal(new Set(builders).size, 5, '5p across -> each player once')
}

// --- Run ------------------------------------------------------------------

const tests: [string, () => void][] = [
	['rolling 7 yields no gains', testRolledSevenYieldsNothing],
	['settlement gets 1', testSettlementGetsOne],
	['city gets 2', testCityGetsTwo],
	['mismatched roll pays nothing', testMismatchedRollPaysNothing],
	['nextMainTurn wraps', testNextMainTurnWraps],
	['rollDice bounds', testRollDiceBounds],
	['acrossSeat mapping', testAcrossSeat],
	['specialBuildQueue', testSpecialBuildQueue],
]

for (const [name, fn] of tests) {
	fn()
	console.log(`  ok  ${name}`)
}
console.log(`OK: ${tests.length} roll tests passed.`)
