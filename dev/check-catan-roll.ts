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
	distributeResources,
	nextMainTurn,
	rollDice,
	totalDice,
} from '../lib/catan/roll'
import type { GameState } from '../lib/catan/types'

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
			[v]: { occupied: true, player, building },
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
		devCards: false,
	})
	const gains = distributeResources(s, 7)
	equal(Object.keys(gains).length, 0, 'rolling 7 returns empty gains')
}

function testSettlementGetsOne() {
	const s0 = initialGameState('standard', 3, {
		bonuses: false,
		devCards: false,
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
		devCards: false,
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
		devCards: false,
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

// --- Run ------------------------------------------------------------------

const tests: [string, () => void][] = [
	['rolling 7 yields no gains', testRolledSevenYieldsNothing],
	['settlement gets 1', testSettlementGetsOne],
	['city gets 2', testCityGetsTwo],
	['mismatched roll pays nothing', testMismatchedRollPaysNothing],
	['nextMainTurn wraps', testNextMainTurnWraps],
	['rollDice bounds', testRollDiceBounds],
]

for (const [name, fn] of tests) {
	fn()
	console.log(`  ok  ${name}`)
}
console.log(`OK: ${tests.length} roll tests passed.`)
