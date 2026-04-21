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
} from '../lib/catan/board'
import { generatePorts, initialGameState } from '../lib/catan/generate'
import {
	applyBankTradeToPlayer,
	availableBankOptions,
	isValidBankTradeShape,
	lockedGiveResource,
	playerPortKinds,
	ratioOf,
} from '../lib/catan/ports'
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
	// initialGameState also seeds ports.
	const gs = initialGameState('standard', 3)
	assert(gs.ports && gs.ports.length === 9, 'initialGameState seeds ports')
}

function stateWithSettlement(vertex: string, portKind: string): GameState {
	const base = initialGameState('standard', 2)
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
		[vertex]: { occupied: true, player: 0, building: 'settlement' },
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
	const noPort = initialGameState('standard', 2)
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

function checkApply() {
	const players = [{ resources: hand({ wheat: 4 }) }, { resources: hand({}) }]
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
	checkApply()
	console.log('check-catan-ports: ok')
}

main()
