// Runtime checks for lib/catan/curses.ts. Run with
// `npx tsx dev/check-catan-curses.ts`. Exits 0 on success; throws on the
// first failure. One `test*` function per curse.

import { HEXES, adjacentVertices } from '../lib/catan/board'
import type { CurseId } from '../lib/catan/bonuses'
import {
	canBuildMoreCities,
	canBuildMoreRoads,
	canBuildMoreSettlements,
	isValidBuildCityVertex,
	isValidBuildRoadEdge,
} from '../lib/catan/build'
import {
	AGE_CARD_LIMIT,
	BUILD_COST_SIZES,
	POWER_HEX_LIMIT,
	POWER_MAX_HEXES,
	canPlaceUnderPower,
	canSpendUnderAge,
	countHexesAtMaxPower,
	curseOf,
	effectiveKnightsPlayed,
	effectiveLongestRoadLength,
	hexPowerForPlayer,
	maxCitiesFor,
	maxRoadsFor,
	maxSettlementsFor,
	settlementKeepsYouthOK,
	touchedResources,
	winRoadsRequiredFor,
} from '../lib/catan/curses'
import { winVPThresholdFor } from '../lib/catan/bonus'
import { findWinner, recomputeLargestArmy } from '../lib/catan/dev'
import { initialGameState } from '../lib/catan/generate'
import { availableBankOptions, ratioOf } from '../lib/catan/ports'
import { requiredDiscards } from '../lib/catan/robber'
import type { GameState, PlayerState, ResourceHand } from '../lib/catan/types'

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(`assert: ${msg}`)
}
function equal(a: unknown, b: unknown, msg: string) {
	if (a !== b) throw new Error(`${msg}: ${a} !== ${b}`)
}

function emptyHand(): ResourceHand {
	return { brick: 0, wood: 0, sheep: 0, wheat: 0, ore: 0 }
}

function baseState(): GameState {
	return initialGameState('standard', 3, {
		bonuses: true,
		bonusSets: ['1'],
		devCards: true,
	})
}

function setCurse(state: GameState, idx: number, curse: CurseId): GameState {
	return {
		...state,
		players: state.players.map((p, i) => (i === idx ? { ...p, curse } : p)),
	}
}

// --- age --------------------------------------------------------------------

function testAgeSpendGate() {
	const p: PlayerState = {
		resources: emptyHand(),
		curse: 'age',
		devCards: [],
		devCardsPlayed: {},
		playedDevThisTurn: false,
	}
	assert(
		canSpendUnderAge(p, BUILD_COST_SIZES.settlement),
		'fresh: 4-card build OK'
	)
	const afterCity: PlayerState = { ...p, cardsSpentThisTurn: 5 }
	assert(
		!canSpendUnderAge(afterCity, BUILD_COST_SIZES.road),
		'spent 5 + road (2) exceeds 6'
	)
	assert(canSpendUnderAge(afterCity, 1), 'spent 5 + 1-card build still OK')
	const noCurse: PlayerState = { ...p, curse: undefined }
	assert(canSpendUnderAge(noCurse, 100), 'no curse → any amount OK')
	equal(AGE_CARD_LIMIT, 6, 'age limit constant')
}

// --- compaction -------------------------------------------------------------

function testCompactionRoadCap() {
	const s = setCurse(baseState(), 0, 'compaction')
	equal(maxRoadsFor('compaction'), 7, 'compaction cap is 7')
	equal(maxRoadsFor(undefined), 15, 'baseline is 15')
	// Pre-place 7 roads for player 0 so canBuildMoreRoads returns false.
	const edges = { ...s.edges }
	const edgeIds = [
		'1A - 2B',
		'1B - 2C',
		'1C - 1D',
		'1D - 2E',
		'1E - 1F',
		'1F - 2G',
		'1G - 2H',
	]
	for (const eid of edgeIds) {
		edges[eid as keyof typeof edges] = { occupied: true, player: 0 }
	}
	const capped: GameState = { ...s, edges }
	assert(!canBuildMoreRoads(capped, 0), 'cursed + 7 roads → no more')
	assert(
		!isValidBuildRoadEdge(capped, 0, '1A - 1B'),
		'road validity blocks when capped'
	)
	// Non-cursed player in same state still unblocked.
	const uncursed: GameState = {
		...capped,
		players: capped.players.map((p, i) =>
			i === 0 ? { ...p, curse: undefined } : p
		),
	}
	assert(canBuildMoreRoads(uncursed, 0), 'baseline cap 15 unaffected')
}

// --- decadence --------------------------------------------------------------

function testDecadenceCityCap() {
	const s = setCurse(baseState(), 0, 'decadence')
	equal(maxCitiesFor('decadence'), 2, 'decadence cap is 2')
	const vertices = { ...s.vertices }
	vertices['1B' as keyof typeof vertices] = {
		occupied: true,
		player: 0,
		building: 'city',
	}
	vertices['1D' as keyof typeof vertices] = {
		occupied: true,
		player: 0,
		building: 'city',
	}
	vertices['1F' as keyof typeof vertices] = {
		occupied: true,
		player: 0,
		building: 'settlement',
	}
	const capped: GameState = { ...s, vertices }
	assert(!canBuildMoreCities(capped, 0), 'two cities → blocked')
	assert(
		!isValidBuildCityVertex(capped, 0, '1F'),
		'city build of settlement blocked when at cap'
	)
}

// --- ambition ---------------------------------------------------------------

function testAmbitionVPThreshold() {
	equal(winVPThresholdFor(undefined, 'ambition'), 11, 'ambition threshold')
	equal(winVPThresholdFor(undefined, undefined), 10, 'baseline')
	// Build a state where player 0 (cursed) has exactly 10 VP — not enough.
	const s = setCurse(baseState(), 0, 'ambition')
	// 10 = 5 settlements (5) + Longest Road (+2) + Largest Army (+2) + 1 VP card
	// Easier: hand player 0 ten VP cards to bypass graph setup.
	const players = s.players.map((p, i) =>
		i === 0
			? {
					...p,
					devCards: Array.from({ length: 10 }).map(() => ({
						id: 'victory_point' as const,
						purchasedTurn: -1,
					})),
				}
			: p
	)
	const tied: GameState = { ...s, players }
	equal(findWinner(tied), null, '10 VP under ambition is not enough')
	// Give player 1 (no curse) 10 VP — they win.
	const winnerPlayers = tied.players.map((p, i) =>
		i === 1
			? {
					...p,
					devCards: Array.from({ length: 10 }).map(() => ({
						id: 'victory_point' as const,
						purchasedTurn: -1,
					})),
				}
			: p
	)
	equal(
		findWinner({ ...tied, players: winnerPlayers }),
		1,
		'uncursed 10 VP wins'
	)
}

// --- elitism ----------------------------------------------------------------

function testElitismSettlementCap() {
	equal(maxSettlementsFor('elitism', 0), 3, 'elitism: 3 before first city')
	equal(maxSettlementsFor('elitism', 1), 2, 'elitism: 2 after first city')
	equal(maxSettlementsFor(undefined, 3), 5, 'baseline')
	const s = setCurse(baseState(), 0, 'elitism')
	// 2 settlements + 1 city → max is 2, current is 2, blocked.
	const vertices = { ...s.vertices }
	vertices['1A' as keyof typeof vertices] = {
		occupied: true,
		player: 0,
		building: 'settlement',
	}
	vertices['1C' as keyof typeof vertices] = {
		occupied: true,
		player: 0,
		building: 'settlement',
	}
	vertices['1E' as keyof typeof vertices] = {
		occupied: true,
		player: 0,
		building: 'city',
	}
	const capped: GameState = { ...s, vertices }
	assert(
		!canBuildMoreSettlements(capped, 0),
		'2 settlements + 1 city → cap 2 hit'
	)
}

// --- asceticism -------------------------------------------------------------

function testAsceticismEffectiveCounts() {
	const s = setCurse(baseState(), 0, 'asceticism')
	equal(
		effectiveLongestRoadLength(s, 0, 6),
		4,
		'raw 6 → effective 4 under asceticism'
	)
	equal(effectiveLongestRoadLength(s, 1, 6), 6, 'uncursed player unaffected')
	equal(effectiveLongestRoadLength(s, 0, 1), 0, 'clamps at 0')
	equal(effectiveKnightsPlayed('asceticism', 3), 2, 'knights −1')
	equal(effectiveKnightsPlayed(undefined, 3), 3, 'uncursed unchanged')
	// Largest Army: cursed player with 3 knights (effective 2) doesn't qualify.
	const withKnights: GameState = {
		...s,
		players: s.players.map((p, i) =>
			i === 0 ? { ...p, devCardsPlayed: { knight: 3 } } : p
		),
	}
	equal(
		recomputeLargestArmy(withKnights),
		null,
		'effective 2 knights under threshold'
	)
	// With 4 played: effective 3 → qualifies.
	const ok: GameState = {
		...s,
		players: s.players.map((p, i) =>
			i === 0 ? { ...p, devCardsPlayed: { knight: 4 } } : p
		),
	}
	equal(recomputeLargestArmy(ok), 0, 'effective 3 knights qualifies')
}

// --- nomadism ---------------------------------------------------------------

function testNomadismRoadRequirement() {
	equal(winRoadsRequiredFor('nomadism'), 11, 'nomadism needs 11 roads')
	equal(winRoadsRequiredFor(undefined), 0, 'baseline no requirement')
	const s = setCurse(baseState(), 0, 'nomadism')
	// 10 VP (via VP cards) but 0 roads → not enough.
	const players = s.players.map((p, i) =>
		i === 0
			? {
					...p,
					devCards: Array.from({ length: 10 }).map(() => ({
						id: 'victory_point' as const,
						purchasedTurn: -1,
					})),
				}
			: p
	)
	equal(findWinner({ ...s, players }), null, 'no roads → no win')
	// Add 11 roads → wins.
	const edges = { ...s.edges }
	const edgeIds = [
		'1A - 2B',
		'1B - 2C',
		'1C - 1D',
		'1D - 2E',
		'1E - 1F',
		'1F - 2G',
		'1G - 2H',
		'2A - 3A',
		'2B - 3B',
		'2C - 3C',
		'2D - 3D',
	]
	for (const eid of edgeIds) {
		edges[eid as keyof typeof edges] = { occupied: true, player: 0 }
	}
	equal(findWinner({ ...s, players, edges }), 0, '10 VP + 11 roads → wins')
}

// --- avarice ----------------------------------------------------------------

function testAvariceFullHandDiscard() {
	const s = setCurse(baseState(), 0, 'avarice')
	const players = s.players.map((p, i) =>
		i === 0
			? {
					...p,
					resources: {
						brick: 4,
						wood: 4,
						sheep: 2,
						wheat: 0,
						ore: 0,
					},
				}
			: {
					...p,
					resources: {
						brick: 5,
						wood: 5,
						sheep: 0,
						wheat: 0,
						ore: 0,
					},
				}
	)
	const req = requiredDiscards(players)
	equal(req[0], 10, 'avarice discards entire 10-card hand')
	equal(req[1], 5, 'baseline discards floor(10/2)=5')
}

// --- power ------------------------------------------------------------------

function testPowerCaps() {
	equal(POWER_HEX_LIMIT, 3, 'power cap per hex')
	equal(POWER_MAX_HEXES, 2, 'at-max hex count')
	const s = setCurse(baseState(), 0, 'power')
	equal(hexPowerForPlayer(s, 0, HEXES[0]), 0, 'empty hex 0 power')
	// Place a city + settlement on non-adjacent corners of hex '1A' = 3 power.
	// adjacentVertices['1A'] goes clockwise; pick indices 0 and 2 so they're
	// not neighbors (Catan distance rule allowed).
	const adj = adjacentVertices['1A']
	const vertices = { ...s.vertices }
	vertices[adj[0] as keyof typeof vertices] = {
		occupied: true,
		player: 0,
		building: 'city',
	}
	vertices[adj[2] as keyof typeof vertices] = {
		occupied: true,
		player: 0,
		building: 'settlement',
	}
	const loaded: GameState = { ...s, vertices }
	equal(hexPowerForPlayer(loaded, 0, '1A'), 3, 'city(2) + settlement(1) = 3')
	equal(countHexesAtMaxPower(loaded, 0), 1, 'exactly one hex at 3 power')
	// A new settlement adjacent to '1A' would push it over 3.
	assert(
		!canPlaceUnderPower(loaded, 0, adj[4]),
		'placing on a 3rd corner of 1A exceeds 3 pips'
	)
}

// --- youth ------------------------------------------------------------------

function testYouthTouchedSet() {
	const s = setCurse(baseState(), 0, 'youth')
	equal(touchedResources(s, 0).size, 0, 'empty board, no touched resources')
	// Place a settlement adjacent to a producing hex.
	const firstProducing = HEXES.find((h) => s.hexes[h].resource !== null)!
	const firstVertex = adjacentVertices[firstProducing][0]
	const vertices = { ...s.vertices }
	vertices[firstVertex as keyof typeof vertices] = {
		occupied: true,
		player: 0,
		building: 'settlement',
	}
	const loaded: GameState = { ...s, vertices }
	assert(
		touchedResources(loaded, 0).size >= 1,
		'at least one resource touched after settlement'
	)
	// settlementKeepsYouthOK short-circuits for non-cursed players.
	const uncursed: GameState = {
		...loaded,
		players: loaded.players.map((p, i) =>
			i === 0 ? { ...p, curse: undefined } : p
		),
	}
	assert(
		settlementKeepsYouthOK(uncursed, 0, firstVertex),
		'uncursed player never youth-blocked'
	)
}

// --- provinciality ----------------------------------------------------------

function testProvincialityBankOption() {
	const s = setCurse(baseState(), 0, 'provinciality')
	const opts = availableBankOptions(s, 0)
	equal(opts.length, 1, 'provinciality gives one option')
	equal(opts[0], '5:1', 'that option is 5:1')
	equal(ratioOf('5:1'), 5, '5:1 ratio')
}

// --- curseOf helper ---------------------------------------------------------

function testCurseOfSparse() {
	const s = baseState()
	equal(curseOf(s, 0), undefined, 'no curse on base player')
	equal(
		curseOf(setCurse(s, 0, 'avarice'), 0),
		'avarice',
		'assigned curse returned'
	)
}

// --- runner -----------------------------------------------------------------

const tests: [string, () => void][] = [
	['age spend gate', testAgeSpendGate],
	['compaction road cap', testCompactionRoadCap],
	['decadence city cap', testDecadenceCityCap],
	['ambition vp threshold', testAmbitionVPThreshold],
	['elitism settlement cap', testElitismSettlementCap],
	['asceticism effective counts', testAsceticismEffectiveCounts],
	['nomadism road requirement', testNomadismRoadRequirement],
	['avarice full hand discard', testAvariceFullHandDiscard],
	['power pip caps', testPowerCaps],
	['youth touched set', testYouthTouchedSet],
	['provinciality 5:1', testProvincialityBankOption],
	['curseOf sparse', testCurseOfSparse],
]
for (const [name, fn] of tests) {
	fn()
	console.log(`  ok  ${name}`)
}
console.log(`OK: ${tests.length} curse tests passed.`)
