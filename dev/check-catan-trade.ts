// Runtime checks for lib/catan/trade.ts. Run with
// `npx tsx dev/check-catan-trade.ts`. Exits 0 on success; throws on first
// failure.

import {
	addresseesOf,
	applyTradeToPlayers,
	canAfford,
	emptyHand,
	handIsEmpty,
	isOfferAddressedTo,
	isOfferRejectedByAll,
	isValidTradeShape,
	newTradeId,
	rejectedByOf,
} from '../lib/catan/trade'
import type { PlayerState, ResourceHand, TradeOffer } from '../lib/catan/types'

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(`assert: ${msg}`)
}
function equal(a: unknown, b: unknown, msg: string) {
	if (a !== b) throw new Error(`${msg}: ${a} !== ${b}`)
}

function hand(partial: Partial<ResourceHand>): ResourceHand {
	return { ...emptyHand(), ...partial }
}

function player(resources: Partial<ResourceHand>): PlayerState {
	return {
		resources: hand(resources),
		devCards: [],
		devCardsPlayed: {},
		playedDevThisTurn: false,
	}
}

function offer(partial: Partial<TradeOffer> = {}): TradeOffer {
	return {
		id: 'test',
		from: 0,
		to: [],
		give: hand({ wheat: 1 }),
		receive: hand({ ore: 1 }),
		createdAt: '2026-04-20T00:00:00Z',
		...partial,
	}
}

// --- Tests -----------------------------------------------------------------

function testHandIsEmpty() {
	assert(handIsEmpty(emptyHand()), 'empty hand')
	assert(!handIsEmpty(hand({ wood: 1 })), 'non-empty hand')
}

function testValidTradeShape() {
	// Both sides non-empty, no overlap: valid.
	assert(
		isValidTradeShape(hand({ wheat: 1 }), hand({ ore: 2 })),
		'1 wheat for 2 ore'
	)
	// Empty give: invalid.
	assert(
		!isValidTradeShape(emptyHand(), hand({ ore: 1 })),
		'empty give rejected'
	)
	// Empty receive: invalid.
	assert(
		!isValidTradeShape(hand({ wheat: 1 }), emptyHand()),
		'empty receive rejected'
	)
	// Same resource both sides: invalid.
	assert(
		!isValidTradeShape(hand({ wheat: 1 }), hand({ wheat: 1 })),
		'wheat-for-wheat rejected'
	)
	// Partial overlap: invalid.
	assert(
		!isValidTradeShape(
			hand({ wheat: 1, ore: 1 }),
			hand({ brick: 1, ore: 1 })
		),
		'overlapping ore rejected'
	)
	// Negative: invalid.
	assert(
		!isValidTradeShape(hand({ wheat: -1 }), hand({ ore: 1 })),
		'negative rejected'
	)
}

function testCanAfford() {
	assert(canAfford(hand({ wheat: 2 }), hand({ wheat: 1 })), '2>=1')
	assert(!canAfford(hand({ wheat: 0 }), hand({ wheat: 1 })), '0<1')
}

function testApplyTradeToPlayers() {
	const players: PlayerState[] = [
		player({ wheat: 3 }),
		player({ ore: 2 }),
		player({ brick: 5 }),
	]
	const next = applyTradeToPlayers(
		players,
		0,
		1,
		hand({ wheat: 1 }),
		hand({ ore: 1 })
	)
	equal(next[0].resources.wheat, 2, 'proposer wheat -1')
	equal(next[0].resources.ore, 1, 'proposer ore +1')
	equal(next[1].resources.wheat, 1, 'accepter wheat +1')
	equal(next[1].resources.ore, 1, 'accepter ore -1')
	equal(next[2].resources.brick, 5, 'bystander untouched')
}

function testIsOfferAddressedTo() {
	const all = offer({ from: 0, to: [] })
	assert(isOfferAddressedTo(all, 1), 'open-to-all: 1 can accept')
	assert(isOfferAddressedTo(all, 2), 'open-to-all: 2 can accept')
	assert(!isOfferAddressedTo(all, 0), 'proposer cannot accept own')

	const targeted = offer({ from: 0, to: [2] })
	assert(!isOfferAddressedTo(targeted, 1), 'not in list: rejected')
	assert(isOfferAddressedTo(targeted, 2), 'in list: accepted')
}

function testNewTradeId() {
	const ids = new Set<string>()
	for (let i = 0; i < 100; i++) ids.add(newTradeId())
	// Not strictly guaranteed unique, but collisions across 100 are vanishing.
	assert(ids.size > 90, 'ids are mostly unique')
}

function testAddresseesOf() {
	equal(
		JSON.stringify(addresseesOf(offer({ from: 0, to: [] }), 4)),
		JSON.stringify([1, 2, 3]),
		'empty to expands to all-but-proposer'
	)
	equal(
		JSON.stringify(addresseesOf(offer({ from: 1, to: [2, 3] }), 4)),
		JSON.stringify([2, 3]),
		'explicit to is preserved'
	)
}

function testRejectedHelpers() {
	equal(
		JSON.stringify(rejectedByOf(offer({ from: 0 }))),
		JSON.stringify([]),
		'missing rejectedBy defaults to empty'
	)
	equal(
		JSON.stringify(rejectedByOf(offer({ from: 0, rejectedBy: [1, 2] }))),
		JSON.stringify([1, 2]),
		'present rejectedBy passes through'
	)

	const all = offer({ from: 0, to: [], rejectedBy: [1, 2, 3] })
	assert(isOfferRejectedByAll(all, 4), 'all-but-proposer rejected => true')
	const some = offer({ from: 0, to: [], rejectedBy: [1, 2] })
	assert(!isOfferRejectedByAll(some, 4), 'partial reject => false')
	const targeted = offer({ from: 0, to: [2, 3], rejectedBy: [2] })
	assert(!isOfferRejectedByAll(targeted, 4), 'partial-targeted => false')
	const targetedAll = offer({ from: 0, to: [2, 3], rejectedBy: [2, 3] })
	assert(
		isOfferRejectedByAll(targetedAll, 4),
		'all-targeted rejected => true'
	)
}

// --- Run ------------------------------------------------------------------

const tests: [string, () => void][] = [
	['handIsEmpty', testHandIsEmpty],
	['isValidTradeShape', testValidTradeShape],
	['canAfford', testCanAfford],
	['applyTradeToPlayers', testApplyTradeToPlayers],
	['isOfferAddressedTo', testIsOfferAddressedTo],
	['newTradeId', testNewTradeId],
	['addresseesOf', testAddresseesOf],
	['rejectedByOf / isOfferRejectedByAll', testRejectedHelpers],
]

for (const [name, fn] of tests) {
	fn()
	console.log(`  ok  ${name}`)
}
console.log(`OK: ${tests.length} trade tests passed.`)
