// Runtime checks for lib/catan/dev.ts and lib/catan/devCards.ts. Run with
// `npx tsx dev/check-catan-dev.ts`. Exits 0 on success; throws on the first
// failure.

import {
	DEV_CARD_COST,
	buildInitialDevDeck,
	canBuyDevCard,
	knightsPlayed,
	playableCards,
	recomputeLargestArmy,
	totalVP,
} from '../lib/catan/dev'
import { DEV_DECK_COMPOSITION, type DevCardId } from '../lib/catan/devCards'
import { initialGameState } from '../lib/catan/generate'
import type {
	DevCardEntry,
	GameState,
	PlayerState,
	ResourceHand,
} from '../lib/catan/types'

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

function player(
	resources: ResourceHand,
	devCards: DevCardEntry[] = [],
	devCardsPlayed: Partial<Record<DevCardId, number>> = {}
): PlayerState {
	return { resources, devCards, devCardsPlayed, playedDevThisTurn: false }
}

// Deterministic RNG — linear congruential, seeded.
function makeRng(seed: number): () => number {
	let s = seed >>> 0
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0
		return s / 0x100000000
	}
}

// --- Tests -----------------------------------------------------------------

function testDeckComposition() {
	const deck = buildInitialDevDeck(makeRng(1))
	equal(deck.length, 25, '25-card deck')
	const counts: Record<string, number> = {}
	for (const c of deck) counts[c] = (counts[c] ?? 0) + 1
	for (const [id, expected] of Object.entries(DEV_DECK_COMPOSITION)) {
		equal(counts[id], expected, `count of ${id}`)
	}
}

function testDeckShuffleIsSeedStable() {
	const a = buildInitialDevDeck(makeRng(42))
	const b = buildInitialDevDeck(makeRng(42))
	const c = buildInitialDevDeck(makeRng(99))
	equal(a[0], b[0], 'same seed → same top card')
	assert(
		a[0] !== c[0] || a[5] !== c[5] || a[10] !== c[10],
		'different seeds differ somewhere'
	)
}

function testCanBuyDevCard() {
	const base = initialGameState('standard', 3, {
		bonuses: false,
		devCards: true,
	})
	// Forced into main phase + affordable hand.
	const s: GameState = {
		...base,
		phase: { kind: 'main', roll: { a: 3, b: 4 }, trade: null },
		players: base.players.map((p, i) =>
			i === 0
				? { ...p, resources: hand({ sheep: 1, wheat: 1, ore: 1 }) }
				: p
		),
	}
	assert(canBuyDevCard(s, 0, 0), 'affordable + my turn + main → true')
	assert(!canBuyDevCard(s, 1, 0), 'not my turn → false')
	// Unaffordable.
	const poor: GameState = {
		...s,
		players: s.players.map((p, i) =>
			i === 0 ? { ...p, resources: hand({ sheep: 1 }) } : p
		),
	}
	assert(!canBuyDevCard(poor, 0, 0), 'unaffordable → false')
	// Empty deck.
	const noDeck: GameState = { ...s, devDeck: [] }
	assert(!canBuyDevCard(noDeck, 0, 0), 'empty deck → false')
	// Config off.
	const noConfig: GameState = {
		...s,
		config: { bonuses: false, devCards: false },
	}
	assert(!canBuyDevCard(noConfig, 0, 0), 'config off → false')
}

function testPlayableCardsRespectsPurchaseTurn() {
	const freshEntry: DevCardEntry = { id: 'knight', purchasedTurn: 5 }
	const oldEntry: DevCardEntry = { id: 'knight', purchasedTurn: 3 }
	const p = player(hand({}), [freshEntry, oldEntry])
	equal(playableCards(p, 4).length, 1, 'only old entry playable when round=4')
	equal(playableCards(p, 6).length, 2, 'both playable once round passes both')
	// VP never playable.
	const pvp = player(hand({}), [{ id: 'victory_point', purchasedTurn: 0 }])
	equal(playableCards(pvp, 99).length, 0, 'VP cards never in playableCards')
}

function testPlayableCardsRespectsOncePerTurn() {
	const entry: DevCardEntry = { id: 'knight', purchasedTurn: 0 }
	const p: PlayerState = {
		resources: hand({}),
		devCards: [entry],
		devCardsPlayed: { knight: 1 },
		playedDevThisTurn: true,
	}
	equal(
		playableCards(p, 5).length,
		0,
		'already played this turn → nothing playable'
	)
}

function testLargestArmyStrictOvertake() {
	const mk = (knights: number[]): GameState => {
		const base = initialGameState('standard', 4, {
			bonuses: false,
			devCards: true,
		})
		return {
			...base,
			players: base.players.map((p, i) => ({
				...p,
				devCardsPlayed: { knight: knights[i] ?? 0 },
			})),
			largestArmy: null,
		}
	}

	// No one has 3 → nobody.
	equal(recomputeLargestArmy(mk([2, 2, 2, 0])), null, '<3 knights → null')

	// Clean majority.
	equal(recomputeLargestArmy(mk([3, 2, 2, 2])), 0, '3 vs 2 → player 0')

	// Strict overtake.
	const s1: GameState = { ...mk([3, 4, 2, 2]), largestArmy: 0 }
	equal(recomputeLargestArmy(s1), 1, 'new leader overtakes holder')

	// Tie at lead keeps current holder.
	const s2: GameState = { ...mk([3, 3, 2, 2]), largestArmy: 0 }
	equal(recomputeLargestArmy(s2), 0, 'tie keeps current holder')
}

function testTotalVP() {
	const base = initialGameState('standard', 2, {
		bonuses: false,
		devCards: true,
	})
	const state: GameState = {
		...base,
		vertices: {
			'1A': { occupied: true, player: 0, building: 'settlement' },
			'1B': { occupied: true, player: 0, building: 'city' },
			'1C': { occupied: true, player: 1, building: 'settlement' },
		},
		largestArmy: 0,
		players: base.players.map((p, i) =>
			i === 0
				? {
						...p,
						devCards: [
							{ id: 'victory_point', purchasedTurn: 0 },
							{ id: 'victory_point', purchasedTurn: 0 },
							{ id: 'knight', purchasedTurn: 0 },
						],
					}
				: p
		),
	}
	// Player 0: 1 settlement + 2 (city) + 2 (LA) + 2 (VP cards) = 7.
	equal(totalVP(state, 0, true), 7, 'self view: full VP including hidden')
	// Spectator view of player 0 hides VP cards → 5.
	equal(totalVP(state, 0, false), 5, 'spectator view hides VP cards')
	// Player 1: 1 settlement + 0 LA + 0 VP = 1.
	equal(totalVP(state, 1, true), 1, 'player 1: settlement only')
}

function testKnightsPlayedHelper() {
	const p = player(hand({}), [], { knight: 3 })
	equal(knightsPlayed(p), 3, 'knightsPlayed reads from devCardsPlayed')
	const empty = player(hand({}))
	equal(knightsPlayed(empty), 0, 'undefined → 0')
}

function testDevCardCost() {
	equal(DEV_CARD_COST.sheep, 1, 'costs 1 sheep')
	equal(DEV_CARD_COST.wheat, 1, 'costs 1 wheat')
	equal(DEV_CARD_COST.ore, 1, 'costs 1 ore')
	equal(DEV_CARD_COST.wood, 0, 'no wood cost')
	equal(DEV_CARD_COST.brick, 0, 'no brick cost')
}

function testInitialGameStateSeedsDevState() {
	const on = initialGameState('standard', 3, {
		bonuses: false,
		devCards: true,
	})
	equal(on.devDeck.length, 25, 'deck seeded when config on')
	equal(on.largestArmy, null, 'no one holds largest army at start')
	equal(on.round, 0, 'round starts at 0')
	for (const p of on.players) {
		equal(p.devCards.length, 0, 'empty dev hand')
		equal(p.playedDevThisTurn, false, 'no plays yet')
	}

	const off = initialGameState('standard', 3, {
		bonuses: false,
		devCards: false,
	})
	equal(off.devDeck.length, 0, 'empty deck when config off')
}

// --- Run -------------------------------------------------------------------

function run() {
	const tests: Array<[string, () => void]> = [
		['testDeckComposition', testDeckComposition],
		['testDeckShuffleIsSeedStable', testDeckShuffleIsSeedStable],
		['testCanBuyDevCard', testCanBuyDevCard],
		[
			'testPlayableCardsRespectsPurchaseTurn',
			testPlayableCardsRespectsPurchaseTurn,
		],
		[
			'testPlayableCardsRespectsOncePerTurn',
			testPlayableCardsRespectsOncePerTurn,
		],
		['testLargestArmyStrictOvertake', testLargestArmyStrictOvertake],
		['testTotalVP', testTotalVP],
		['testKnightsPlayedHelper', testKnightsPlayedHelper],
		['testDevCardCost', testDevCardCost],
		[
			'testInitialGameStateSeedsDevState',
			testInitialGameStateSeedsDevState,
		],
	]
	for (const [name, fn] of tests) {
		fn()
		console.log(`  ok ${name}`)
	}
	console.log(`\n${tests.length} tests passed`)
}

run()
