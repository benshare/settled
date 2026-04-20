// Runtime checks for lib/catan/robber.ts. Run with
// `npx tsx dev/check-catan-robber.ts`. Exits 0 on success; throws with a
// specific message on the first failure.

import {
	HEXES,
	adjacentVertices,
	type Hex,
	type Vertex,
	type VertexBuilding,
} from '../lib/catan/board'
import { initialGameState } from '../lib/catan/generate'
import { distributeResources } from '../lib/catan/roll'
import {
	handSize,
	isValidDiscardSelection,
	requiredDiscards,
	stealCandidates,
	validRobberHexes,
} from '../lib/catan/robber'
import type { GameState, PlayerState, ResourceHand } from '../lib/catan/types'

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(`assert: ${msg}`)
}

function equal(a: unknown, b: unknown, msg: string) {
	if (a !== b) throw new Error(`${msg}: ${a} !== ${b}`)
}

function hand(partial: Partial<ResourceHand> = {}): ResourceHand {
	return {
		brick: 0,
		wood: 0,
		sheep: 0,
		wheat: 0,
		ore: 0,
		...partial,
	}
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

function firstResourceHex(s: GameState): Hex {
	for (const h of HEXES) {
		const hd = s.hexes[h]
		if (hd.resource !== null) return h
	}
	throw new Error('no resource hex on board')
}

// --- Tests -----------------------------------------------------------------

function testRequiredDiscards() {
	const players: PlayerState[] = [
		{ resources: hand({ wood: 7 }) }, // 7: no discard
		{ resources: hand({ wood: 8 }) }, // 8: discard 4
		{ resources: hand({ wood: 5, brick: 4 }) }, // 9: discard 4
		{ resources: hand({ wood: 15 }) }, // 15: discard 7
	]
	const req = requiredDiscards(players)
	equal(req[0], undefined, 'player 0 has 7 cards → no discard')
	equal(req[1], 4, 'player 1: 8 → 4')
	equal(req[2], 4, 'player 2: 9 → 4')
	equal(req[3], 7, 'player 3: 15 → 7')
}

function testIsValidDiscardSelection() {
	const h = hand({ wood: 3, brick: 2, sheep: 1 })
	assert(
		isValidDiscardSelection(h, hand({ wood: 2, brick: 1 }), 3),
		'sum matches, within hand'
	)
	assert(
		!isValidDiscardSelection(h, hand({ wood: 1, brick: 1 }), 3),
		'sum under required → invalid'
	)
	assert(
		!isValidDiscardSelection(h, hand({ wood: 3, brick: 2 }), 3),
		'sum over required → invalid'
	)
	assert(
		!isValidDiscardSelection(h, hand({ wood: 4 }), 4),
		'exceeds resource → invalid'
	)
}

function testValidRobberHexes() {
	const s = initialGameState('standard', 3)
	const valids = validRobberHexes(s)
	equal(valids.length, 18, 'exactly 18 valid hexes (all except current)')
	assert(!valids.includes(s.robber), 'current robber hex excluded')
}

function testStealCandidatesOpponentWithCards() {
	const s0 = initialGameState('standard', 3)
	const hex = firstResourceHex(s0)
	const v = adjacentVertices[hex][0] as Vertex
	let s = placeBuilding(s0, v, 1, 'settlement')
	s = {
		...s,
		players: s.players.map((p, i) =>
			i === 1 ? { ...p, resources: hand({ wood: 2 }) } : p
		),
	}
	const cands = stealCandidates(s, hex, 0)
	equal(cands.length, 1, 'one candidate')
	equal(cands[0], 1, 'opponent index 1')
}

function testStealCandidatesEmptyHand() {
	const s0 = initialGameState('standard', 3)
	const hex = firstResourceHex(s0)
	const v = adjacentVertices[hex][0] as Vertex
	const s = placeBuilding(s0, v, 1, 'settlement')
	// Opponent has no cards — not a candidate.
	const cands = stealCandidates(s, hex, 0)
	equal(cands.length, 0, 'empty-handed opponent excluded')
}

function testStealCandidatesExcludesSelf() {
	const s0 = initialGameState('standard', 3)
	const hex = firstResourceHex(s0)
	const v = adjacentVertices[hex][0] as Vertex
	let s = placeBuilding(s0, v, 0, 'settlement')
	s = {
		...s,
		players: s.players.map((p, i) =>
			i === 0 ? { ...p, resources: hand({ wood: 2 }) } : p
		),
	}
	const cands = stealCandidates(s, hex, 0)
	equal(cands.length, 0, 'own building never a candidate')
}

function testDistributeSkipsRobberHex() {
	const s0 = initialGameState('standard', 3)
	const hex = firstResourceHex(s0)
	const hd = s0.hexes[hex]
	if (hd.resource === null) throw new Error('unreachable')
	const v = adjacentVertices[hex][0] as Vertex
	let s = placeBuilding(s0, v, 0, 'settlement')
	s = { ...s, robber: hex }
	const gains = distributeResources(s, hd.number)
	assert(!gains[0], 'no gain when robber blocks the hex')
}

function testHandSize() {
	equal(handSize(hand({ wood: 2, brick: 3 })), 5, 'counts sum')
	equal(handSize(hand()), 0, 'empty is 0')
}

// --- Run ------------------------------------------------------------------

const tests: [string, () => void][] = [
	['requiredDiscards', testRequiredDiscards],
	['isValidDiscardSelection', testIsValidDiscardSelection],
	['validRobberHexes', testValidRobberHexes],
	[
		'stealCandidates: opponent with cards',
		testStealCandidatesOpponentWithCards,
	],
	['stealCandidates: empty hand', testStealCandidatesEmptyHand],
	['stealCandidates: excludes self', testStealCandidatesExcludesSelf],
	['distributeResources skips robber hex', testDistributeSkipsRobberHex],
	['handSize', testHandSize],
]

for (const [name, fn] of tests) {
	fn()
	console.log(`  ok  ${name}`)
}
console.log(`OK: ${tests.length} robber tests passed.`)
