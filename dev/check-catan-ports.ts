// Runtime checks for lib/catan/ports.ts + generate.ts port seeding. Run with
// `npx tsx dev/check-catan-ports.ts`. Exits 0 on success; throws on first
// failure.

import {
	COASTAL_EDGES,
	EDGES,
	PORT_SLOTS,
	RESOURCES,
	STANDARD_PORT_KINDS,
	adjacentHexes,
	edgeEndpoints,
	type Edge,
	type Hex,
	type Resource,
} from '../lib/catan/board'
import { generatePorts, initialGameState } from '../lib/catan/generate'
import {
	applyBankTradeToPlayer,
	availableBankOptions,
	bankPartitionFor,
	effectiveBankRatioFor,
	isValidBankTradeShape,
	lockedGiveResource,
	playerPortKinds,
	ratioOf,
	uniformRatioOf,
} from '../lib/catan/ports'
import type { BonusId, CurseId } from '../lib/catan/bonuses'
import { emptyHand } from '../lib/catan/trade'
import type { GameState, ResourceHand } from '../lib/catan/types'

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(`assert: ${msg}`)
}

function hand(partial: Partial<ResourceHand>): ResourceHand {
	return { ...emptyHand(), ...partial }
}

function checkCoastalData() {
	assert(COASTAL_EDGES.length === 30, 'expected 30 coastal edges')
	const edgeSet = new Set<string>(EDGES)
	for (const e of COASTAL_EDGES) {
		assert(edgeSet.has(e), `coastal edge ${e} not in EDGES`)
		assert(countLandHexes(e) === 1, `coastal edge ${e} should touch 1 hex`)
	}
	assert(PORT_SLOTS.length === 9, 'expected 9 port slots')
	const coastalSet = new Set<string>(COASTAL_EDGES)
	for (const e of PORT_SLOTS) {
		assert(coastalSet.has(e), `port slot ${e} not in COASTAL_EDGES`)
	}
	// No two port slots share an endpoint vertex (adjacency spacing).
	const used = new Set<string>()
	for (const e of PORT_SLOTS) {
		const [a, b] = edgeEndpoints(e)
		assert(!used.has(a), `port slots share vertex ${a}`)
		assert(!used.has(b), `port slots share vertex ${b}`)
		used.add(a)
		used.add(b)
	}
	assert(STANDARD_PORT_KINDS.length === 9, 'expected 9 port kinds')
	const counts = { '3:1': 0, brick: 0, wood: 0, sheep: 0, wheat: 0, ore: 0 }
	for (const k of STANDARD_PORT_KINDS) counts[k]++
	assert(counts['3:1'] === 4, 'expected 4 generic ports')
	for (const r of RESOURCES) assert(counts[r] === 1, `expected 1 ${r} port`)
}

function countLandHexes(e: Edge): number {
	const [a, b] = edgeEndpoints(e)
	const aSet = new Set<Hex>(adjacentHexes[a])
	let count = 0
	for (const h of adjacentHexes[b]) if (aSet.has(h)) count++
	return count
}

function checkGenerate() {
	const ports = generatePorts('standard')
	assert(ports.length === 9, 'generatePorts returns 9')
	const seenEdges = new Set<string>()
	for (const p of ports) {
		assert(PORT_SLOTS.includes(p.edge), `port on non-slot edge ${p.edge}`)
		assert(!seenEdges.has(p.edge), `duplicate port edge ${p.edge}`)
		seenEdges.add(p.edge)
	}
	// Port-kind distribution matches STANDARD_PORT_KINDS exactly.
	const kinds = ports.map((p) => p.kind).sort()
	const expected = [...STANDARD_PORT_KINDS].sort()
	for (let i = 0; i < kinds.length; i++) {
		assert(kinds[i] === expected[i], 'port kind distribution mismatch')
	}
	// Alternation: even indices are 2:1 (resource-kinded), odd are 3:1.
	for (let i = 0; i < ports.length; i++) {
		if (i % 2 === 0) {
			assert(
				ports[i].kind !== '3:1',
				`expected 2:1 at even index ${i}, got ${ports[i].kind}`
			)
		} else {
			assert(
				ports[i].kind === '3:1',
				`expected 3:1 at odd index ${i}, got ${ports[i].kind}`
			)
		}
	}
	// initialGameState also seeds ports.
	const gs = initialGameState('standard', 3, {
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
	assert(gs.ports && gs.ports.length === 9, 'initialGameState seeds ports')
}

function stateWithSettlement(vertex: string, portKind: string): GameState {
	const base = initialGameState('standard', 2, {
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
	// Force a port of the given kind onto the adjacent edge.
	// Find an edge in PORT_SLOTS that has `vertex` as an endpoint.
	const edge = PORT_SLOTS.find((e) =>
		edgeEndpoints(e as Edge).includes(
			vertex as ReturnType<typeof edgeEndpoints>[0]
		)
	)
	assert(!!edge, `no PORT_SLOT adjacent to ${vertex}`)
	base.ports = [
		{
			edge: edge as Edge,
			kind: portKind as (typeof STANDARD_PORT_KINDS)[number],
		},
	]
	base.vertices = {
		[vertex]: {
			occupied: true,
			player: 0,
			building: 'settlement',
			placedTurn: 0,
		},
	}
	return base
}

function checkPlayerPortKinds() {
	// Pick the first PORT_SLOT's "a" vertex for the test.
	const firstSlot = PORT_SLOTS[0]
	const [va] = edgeEndpoints(firstSlot)
	const state = stateWithSettlement(va, 'wood')
	const me = playerPortKinds(state, 0)
	assert(me.has('wood'), 'player at port should have kind')
	const other = playerPortKinds(state, 1)
	assert(other.size === 0, 'other player has no ports')
}

function checkAvailableOptions() {
	const firstSlot = PORT_SLOTS[0]
	const [va] = edgeEndpoints(firstSlot)
	const state = stateWithSettlement(va, 'wheat')
	const opts = availableBankOptions(state, 0)
	assert(opts.includes('2:1-wheat'), 'should include 2:1-wheat')
	assert(opts.includes('4:1'), 'always includes 4:1')
	assert(!opts.includes('3:1'), 'no 3:1 when no generic port')

	// Player with no ports → only 4:1.
	const noPort = initialGameState('standard', 2, {
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
	const only = availableBankOptions(noPort, 0)
	assert(only.length === 1 && only[0] === '4:1', 'only 4:1 when no ports')
}

function checkRatioOf() {
	assert(ratioOf('4:1') === 4, '4:1 → 4')
	assert(ratioOf('3:1') === 3, '3:1 → 3')
	assert(ratioOf('2:1-wheat') === 2, '2:1-* → 2')
	assert(lockedGiveResource('2:1-wheat') === 'wheat', 'locked wheat')
	assert(lockedGiveResource('4:1') === null, 'no lock on 4:1')
}

function checkValidShape() {
	// 4:1 classic single trade.
	assert(
		isValidBankTradeShape(hand({ wheat: 4 }), hand({ brick: 1 }), '4:1'),
		'4 wheat → 1 brick at 4:1'
	)
	// Multi-unit 4:1 trade.
	assert(
		isValidBankTradeShape(hand({ wheat: 8 }), hand({ brick: 2 }), '4:1'),
		'8 wheat → 2 brick at 4:1'
	)
	// Multi-resource give at 4:1.
	assert(
		isValidBankTradeShape(
			hand({ wheat: 4, ore: 4 }),
			hand({ brick: 1, wood: 1 }),
			'4:1'
		),
		'4 wheat + 4 ore → 1 brick + 1 wood at 4:1'
	)
	// Non-multiple of ratio → invalid.
	assert(
		!isValidBankTradeShape(hand({ wheat: 3 }), hand({ brick: 1 }), '4:1'),
		'3 wheat → 1 brick at 4:1 should be invalid'
	)
	// 2:1-wood requires give = wood only.
	assert(
		isValidBankTradeShape(hand({ wood: 2 }), hand({ ore: 1 }), '2:1-wood'),
		'2 wood → 1 ore at 2:1-wood'
	)
	assert(
		!isValidBankTradeShape(
			hand({ wheat: 2 }),
			hand({ ore: 1 }),
			'2:1-wood'
		),
		'wheat is not allowed for 2:1-wood'
	)
	// Cannot trade same resource for same resource.
	assert(
		!isValidBankTradeShape(hand({ wheat: 4 }), hand({ wheat: 1 }), '4:1'),
		'same-resource swap invalid'
	)
	// Totals must match ratio × receive.
	assert(
		!isValidBankTradeShape(hand({ wheat: 4 }), hand({ brick: 2 }), '4:1'),
		'4 wheat → 2 brick at 4:1 invalid'
	)
}

function checkSpecialist() {
	// Discount only when the give is a single stack of the declared resource.
	assert(
		effectiveBankRatioFor('4:1', hand({ wheat: 3 }), 'wheat') === 3,
		'4:1 → 3 for specialty'
	)
	assert(
		effectiveBankRatioFor('3:1', hand({ wheat: 2 }), 'wheat') === 2,
		'3:1 → 2 for specialty'
	)
	// The reported bug: a 2:1 specialty port pays one fewer → 1:1 (floor is 1).
	assert(
		effectiveBankRatioFor('2:1-wheat', hand({ wheat: 1 }), 'wheat') === 1,
		'2:1 specialty port → 1:1'
	)
	// Non-matching give keeps the base ratio.
	assert(
		effectiveBankRatioFor('2:1-ore', hand({ ore: 2 }), 'wheat') === 2,
		'2:1-ore keeps 2 when specialty is wheat'
	)
	assert(
		effectiveBankRatioFor('4:1', hand({ wheat: 4, ore: 4 }), 'wheat') === 4,
		'multi-resource give ignores specialty'
	)
	// 1:1 shape validates: give 1 specialty → receive 1.
	assert(
		isValidBankTradeShape(
			hand({ wheat: 1 }),
			hand({ ore: 1 }),
			'2:1-wheat',
			'wheat'
		),
		'1 wheat → 1 ore at specialist 2:1-wheat'
	)
	assert(
		isValidBankTradeShape(
			hand({ wheat: 2 }),
			hand({ ore: 2 }),
			'2:1-wheat',
			'wheat'
		),
		'2 wheat → 2 ore at specialist 2:1-wheat'
	)
	// A non-specialist (or non-matching specialty) still needs 2 per unit.
	assert(
		!isValidBankTradeShape(
			hand({ wheat: 1 }),
			hand({ ore: 1 }),
			'2:1-wheat'
		),
		'1 wheat → 1 ore invalid without specialist'
	)
}

// A state where player 0 holds a settlement on each named port, with optional
// bonus / curse / specialty. `playerCount` matters only for the provinciality
// curse, whose version varies with table size.
function bankState(opts: {
	ports?: string[]
	bonus?: BonusId
	curse?: CurseId
	specialist?: Resource
	playerCount?: number
}): GameState {
	const state = initialGameState('standard', opts.playerCount ?? 2, {
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
	const kinds = opts.ports ?? []
	state.ports = kinds.map((kind, i) => ({
		edge: PORT_SLOTS[i] as Edge,
		kind: kind as (typeof STANDARD_PORT_KINDS)[number],
	}))
	state.vertices = {}
	kinds.forEach((_, i) => {
		const [va] = edgeEndpoints(PORT_SLOTS[i] as Edge)
		state.vertices[va] = {
			occupied: true,
			player: 0,
			building: 'settlement',
			placedTurn: 0,
		}
	})
	const p = state.players[0]
	if (opts.bonus) p.bonus = opts.bonus
	if (opts.curse) p.curse = opts.curse
	if (opts.specialist) p.specialistResource = opts.specialist
	return state
}

// The combination rule: the give is cut into groups at whatever rates the
// player has access to, and the group count is what they receive. These are
// the cases the old one-ratio-per-trade rule got wrong.
function checkCombination() {
	const plain = bankState({})
	assert(
		!!bankPartitionFor(plain, 0, hand({ wood: 4 }), hand({ ore: 1 })),
		'4 wood → 1 ore at the plain 4:1 bank'
	)
	assert(
		!bankPartitionFor(plain, 0, hand({ wood: 3 }), hand({ ore: 1 })),
		'3 wood buys nothing at 4:1'
	)

	// The headline case: a 2:1 port and the 4:1 bank in one trade. Invalid
	// under the old single-kind rule, valid now.
	const wheatPort = bankState({ ports: ['wheat'] })
	const mixed = bankPartitionFor(
		wheatPort,
		0,
		hand({ wheat: 2, wood: 4 }),
		hand({ ore: 2 })
	)
	assert(!!mixed, '2 wheat + 4 wood → 2 ore combining a 2:1 port with 4:1')
	assert(
		mixed!.some((r) => r.resource === 'wheat' && r.ratio === 2),
		'wheat charged at the port rate'
	)
	assert(
		mixed!.some((r) => r.resource === 'wood' && r.ratio === 4),
		'wood charged at the bank rate'
	)
	assert(
		uniformRatioOf(mixed!) === null,
		'a mixed-rate trade has no single ratio'
	)
	assert(
		!bankPartitionFor(
			wheatPort,
			0,
			hand({ wheat: 2, wood: 4 }),
			hand({ ore: 3 })
		),
		'the same give cannot buy a third card'
	)

	// A rate set with a hole: {3, 4} can't consume 5, which a min/max range
	// check would wave through.
	const generic = bankState({ ports: ['3:1'] })
	assert(
		!!bankPartitionFor(generic, 0, hand({ wood: 6 }), hand({ ore: 2 })),
		'6 wood → 2 ore at 3:1'
	)
	assert(
		!bankPartitionFor(generic, 0, hand({ wood: 5 }), hand({ ore: 1 })),
		'5 wood is unpayable from {3, 4}'
	)
	assert(
		!!bankPartitionFor(
			generic,
			0,
			hand({ wood: 3, brick: 3 }),
			hand({ ore: 2 })
		),
		'3 wood + 3 brick → 2 ore, both at 3:1'
	)
	assert(
		uniformRatioOf(
			bankPartitionFor(
				generic,
				0,
				hand({ wood: 3, brick: 3 }),
				hand({ ore: 2 })
			)!
		) === 3,
		'a single-rate trade reports 3:1'
	)

	// Overlap and empty sides stay invalid, as they were.
	assert(
		!bankPartitionFor(plain, 0, hand({ wood: 4 }), hand({ wood: 1 })),
		'cannot receive what you are giving'
	)
	assert(
		!bankPartitionFor(plain, 0, hand({ wood: 4 }), hand({})),
		'receive side must be non-empty'
	)
	assert(
		!bankPartitionFor(plain, 0, hand({}), hand({ ore: 1 })),
		'give side must be non-empty'
	)
}

function checkCombinationBonuses() {
	// Specialist: the discount still needs the whole give to be one stack of
	// the declared resource — mixing loses it.
	const spec = bankState({ specialist: 'wheat' })
	assert(
		!!bankPartitionFor(spec, 0, hand({ wheat: 3 }), hand({ ore: 1 })),
		'specialist pays 3 for 1 of their own resource'
	)
	assert(
		!bankPartitionFor(
			spec,
			0,
			hand({ wheat: 3, wood: 4 }),
			hand({ ore: 2 })
		),
		'a mixed give loses the specialist discount, so 3 wheat is unpayable'
	)
	assert(
		!!bankPartitionFor(
			spec,
			0,
			hand({ wheat: 4, wood: 4 }),
			hand({ ore: 2 })
		),
		'the same mixed give works at the undiscounted rate'
	)

	// Smith: brick and ore are fungible at a specific port.
	const smith = bankState({ ports: ['brick'], bonus: 'smith' })
	assert(
		!!bankPartitionFor(smith, 0, hand({ ore: 2 }), hand({ wood: 1 })),
		'smith satisfies a brick port with ore'
	)
	const nonSmith = bankState({ ports: ['brick'] })
	assert(
		!bankPartitionFor(nonSmith, 0, hand({ ore: 2 }), hand({ wood: 1 })),
		'without the smith bonus a brick port takes only brick'
	)

	// Merchant: extras of the give resource go 1:1, but only riding a real
	// group — a card for a card is not a trade.
	const merchant = bankState({ bonus: 'merchant' })
	const rode = bankPartitionFor(
		merchant,
		0,
		hand({ wood: 6 }),
		hand({ ore: 3 })
	)
	assert(!!rode, 'merchant turns 6 wood into 3 cards (one group + 2 at 1:1)')
	assert(
		rode!.some((r) => r.ratio === 1 && r.groups === 2),
		'the two extras are recorded as 1:1 groups'
	)
	assert(
		!bankPartitionFor(merchant, 0, hand({ wood: 2 }), hand({ ore: 2 })),
		'merchant cannot trade 1:1 without a full-price group'
	)
	assert(
		!bankPartitionFor(
			merchant,
			0,
			hand({ wood: 4, brick: 4 }),
			hand({ ore: 3 })
		),
		'the merchant rate needs a single-resource give'
	)
}

function checkCombinationProvinciality() {
	// Small table: +1 on every rate.
	const surcharged = bankState({ curse: 'provinciality', playerCount: 2 })
	assert(
		!!bankPartitionFor(surcharged, 0, hand({ wood: 5 }), hand({ ore: 1 })),
		'surcharged bank charges 5 for 1'
	)
	assert(
		!bankPartitionFor(surcharged, 0, hand({ wood: 4 }), hand({ ore: 1 })),
		'the base 4:1 is gone under the surcharge'
	)
	// Standard table: flat 5:1, ports ignored.
	const flat = bankState({
		ports: ['wheat'],
		curse: 'provinciality',
		playerCount: 4,
	})
	assert(
		!!bankPartitionFor(flat, 0, hand({ wheat: 5 }), hand({ ore: 1 })),
		'flat_5 charges 5 even at a 2:1 port'
	)
	assert(
		!bankPartitionFor(flat, 0, hand({ wheat: 2 }), hand({ ore: 1 })),
		'flat_5 ignores the port'
	)
	// Expanded table: no bank at all.
	const closed = bankState({ curse: 'provinciality', playerCount: 5 })
	assert(
		availableBankOptions(closed, 0).length === 0,
		'expanded provinciality closes the bank'
	)
	assert(
		!bankPartitionFor(closed, 0, hand({ wood: 8 }), hand({ ore: 1 })),
		'a closed bank takes nothing'
	)
}

function checkApply() {
	const emptyP = {
		devCards: [],
		devCardsPlayed: {},
		playedDevThisTurn: false,
	}
	const players = [
		{ resources: hand({ wheat: 4 }), ...emptyP },
		{ resources: hand({}), ...emptyP },
	]
	const next = applyBankTradeToPlayer(
		players,
		0,
		hand({ wheat: 4 }),
		hand({ brick: 1 })
	)
	assert(next[0].resources.wheat === 0, 'wheat deducted')
	assert(next[0].resources.brick === 1, 'brick credited')
	assert(next[1].resources.wheat === 0, 'other player untouched')
}

function main() {
	checkCoastalData()
	checkGenerate()
	checkPlayerPortKinds()
	checkAvailableOptions()
	checkRatioOf()
	checkValidShape()
	checkSpecialist()
	checkCombination()
	checkCombinationBonuses()
	checkCombinationProvinciality()
	checkApply()
	console.log('check-catan-ports: ok')
}

main()
