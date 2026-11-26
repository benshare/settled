// Runtime checks for lib/catan/apply.ts — the reducers the client folds to
// project its local queue and the edge function folds to commit it. Run with
// `npx tsx dev/check-catan-apply.ts`. Exits 0 on success; throws with a
// specific message on the first failure.
//
// The property that matters most here is the last one: folding a queue and
// then truncating it has to equal folding the truncated queue. Undo is
// `slice(0, -1)` and a re-fold, so if that ever stops holding, undo stops
// landing where the player left off.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
	adjacentEdges,
	edgeEndpoints,
	VERTICES,
	type Edge,
	type Vertex,
} from '../lib/catan/board'
import {
	applyLocalAction,
	applyLocalActions,
	isApplyError,
	projectQueue,
} from '../lib/catan/apply'
import type { DevCardId } from '../lib/catan/devCards'
import { initialGameState } from '../lib/catan/generate'
import {
	DEFAULT_CONFIG,
	type GameState,
	type LocalAction,
	type ResourceHand,
} from '../lib/catan/types'

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(`assert: ${msg}`)
}

function equal(a: unknown, b: unknown, msg: string) {
	if (a !== b) throw new Error(`${msg}: ${a} !== ${b}`)
}

const AT = '2026-09-24T00:00:00.000Z'

function hand(over: Partial<ResourceHand> = {}): ResourceHand {
	return { brick: 0, wood: 0, sheep: 0, wheat: 0, ore: 0, ...over }
}

// A 3-player main-phase board with seat 0 holding the turn, one settlement and
// a full hand — enough to build several things in a row.
function baseState(): GameState {
	const s = initialGameState('standard', 3, DEFAULT_CONFIG)
	const home = VERTICES[20]
	return {
		...s,
		phase: { kind: 'main', roll: { a: 3, b: 4 }, trade: null },
		currentTurn: 0,
		round: 5,
		vertices: {
			[home]: {
				occupied: true,
				player: 0,
				building: 'settlement',
				placedTurn: 0,
			},
		},
		players: s.players.map((p, i) =>
			i === 0
				? {
						...p,
						resources: hand({
							brick: 8,
							wood: 8,
							sheep: 8,
							wheat: 8,
							ore: 8,
						}),
					}
				: p
		),
	}
}

function ok(r: ReturnType<typeof applyLocalAction>): GameState {
	if (isApplyError(r)) throw new Error(`unexpected error: ${r.error}`)
	return r.state
}

function homeEdges(): Edge[] {
	return [...adjacentEdges[VERTICES[20] as Vertex]]
}

// --- Individual reducers ----------------------------------------------------

function testBuildRoadChargesAndPlaces() {
	const s = baseState()
	const edge = homeEdges()[0]
	const next = ok(applyLocalAction(s, 0, { action: 'build_road', edge }, AT))
	assert(next.edges[edge]?.occupied, 'road is on the board')
	equal(next.edges[edge]?.player, 0, 'road belongs to the builder')
	equal(next.players[0].resources.brick, 7, 'brick charged')
	equal(next.players[0].resources.wood, 7, 'wood charged')
	// Untouched seats keep their identity, which is what makes the edge
	// function's changed-column diff safe.
	equal(next.players[1], s.players[1], 'other seats untouched by reference')
}

function testUnaffordableIsRejected() {
	const s = baseState()
	const broke: GameState = {
		...s,
		players: s.players.map((p, i) =>
			i === 0 ? { ...p, resources: hand() } : p
		),
	}
	const r = applyLocalAction(
		broke,
		0,
		{ action: 'build_road', edge: homeEdges()[0] },
		AT
	)
	assert(isApplyError(r), 'an empty hand cannot build')
	equal(r.error, 'insufficient resources', 'says why')
}

function testWrongTurnIsRejected() {
	const s = baseState()
	const r = applyLocalAction(
		s,
		1,
		{ action: 'build_road', edge: homeEdges()[0] },
		AT
	)
	assert(isApplyError(r), 'a seat without the turn cannot build')
	equal(r.error, 'not your turn', 'says why')
}

function testRejectionLeavesStateUntouched() {
	const s = baseState()
	const before = JSON.stringify(s)
	applyLocalAction(s, 1, { action: 'build_road', edge: homeEdges()[0] }, AT)
	equal(JSON.stringify(s), before, 'a rejected action mutates nothing')
}

function testSecondRoadChainsOffTheFirst() {
	const s = baseState()
	const first = homeEdges()[0]
	const afterFirst = ok(
		applyLocalAction(s, 0, { action: 'build_road', edge: first }, AT)
	)
	// The far end of the first road now has legal continuations that were not
	// legal against the server row — which is the whole reason the projection
	// exists.
	const wasLegalBefore = applyLocalAction(
		s,
		0,
		{ action: 'build_road', edge: continuationOf(afterFirst, first) },
		AT
	)
	assert(
		isApplyError(wasLegalBefore),
		'the continuation is illegal before the first road'
	)
	const chained = applyLocalAction(
		afterFirst,
		0,
		{ action: 'build_road', edge: continuationOf(afterFirst, first) },
		AT
	)
	assert(!isApplyError(chained), 'and legal after it')
}

// An edge touching `from`'s far endpoint that isn't `from` itself.
function continuationOf(state: GameState, from: Edge): Edge {
	const [a, b] = edgeEndpoints(from)
	const home = VERTICES[20] as Vertex
	const far = a === home ? b : a
	const next = adjacentEdges[far].find(
		(e) => e !== from && !state.edges[e]?.occupied
	)
	assert(next, 'board has a continuation edge')
	return next
}

function testCarpenterVPAndWin() {
	const s = baseState()
	const carp: GameState = {
		...s,
		players: s.players.map((p, i) =>
			i === 0
				? {
						...p,
						bonus: 'carpenter',
						carpenterVP: 8,
						resources: hand({ wood: 8 }),
					}
				: p
		),
	}
	const next = ok(
		applyLocalAction(carp, 0, { action: 'buy_carpenter_vp' }, AT)
	)
	equal(next.players[0].carpenterVP, 9, 'VP incremented')
	equal(next.players[0].resources.wood, 4, 'wood charged')
	// Once per turn.
	const again = applyLocalAction(next, 0, { action: 'buy_carpenter_vp' }, AT)
	assert(isApplyError(again), 'only once a turn')
}

function testWinMovesPhaseToGameOver() {
	const s = baseState()
	// 9 carpenter VP + 1 settlement already on the board = 10 with one more.
	const carp: GameState = {
		...s,
		players: s.players.map((p, i) =>
			i === 0
				? {
						...p,
						bonus: 'carpenter',
						carpenterVP: 9,
						resources: hand({ wood: 8 }),
					}
				: p
		),
	}
	const next = ok(
		applyLocalAction(carp, 0, { action: 'buy_carpenter_vp' }, AT)
	)
	equal(next.phase.kind, 'game_over', 'the projection reaches game over')
	// Which is what the pending-win cue reads, and what stops a later action.
	const after = applyLocalAction(next, 0, { action: 'buy_carpenter_vp' }, AT)
	assert(isApplyError(after), 'nothing follows a win')
}

function testEventsAreProduced() {
	const s = baseState()
	const r = applyLocalAction(
		s,
		0,
		{ action: 'build_road', edge: homeEdges()[0] },
		AT
	)
	assert(!isApplyError(r), 'road applies')
	equal(r.events.length, 1, 'one event')
	equal(
		(r.events[0] as { kind: string }).kind,
		'road_built',
		'named for the action'
	)
}

// --- Folding ----------------------------------------------------------------

type RoadAction = Extract<LocalAction, { action: 'build_road' }>

function threeRoads(state: GameState): RoadAction[] {
	const first = homeEdges()[0]
	const afterFirst = ok(
		applyLocalAction(state, 0, { action: 'build_road', edge: first }, AT)
	)
	const second = continuationOf(afterFirst, first)
	const afterSecond = ok(
		applyLocalAction(
			afterFirst,
			0,
			{ action: 'build_road', edge: second },
			AT
		)
	)
	return [
		{ action: 'build_road', edge: first },
		{ action: 'build_road', edge: second },
		{ action: 'build_road', edge: continuationOf(afterSecond, second) },
	]
}

function testFoldAppliesInOrder() {
	const s = baseState()
	const queue = threeRoads(s)
	const folded = applyLocalActions(s, 0, queue, AT)
	assert(!('error' in folded), 'three chained roads fold')
	equal(folded.events.length, 3, 'one event per action')
	equal(folded.state.players[0].resources.brick, 5, 'all three charged')
}

function testFoldReportsTheFailingIndex() {
	const s = baseState()
	const queue = threeRoads(s)
	// Swap the middle one for something that can't apply: a road on an edge
	// nothing of the player's reaches.
	const orphan = adjacentEdges[VERTICES[0] as Vertex][0]
	const broken = [queue[0], { action: 'build_road' as const, edge: orphan }]
	const folded = applyLocalActions(s, 0, broken, AT)
	assert('error' in folded, 'the orphan road fails')
	equal(folded.index, 1, 'and names its position')
}

// The property undo rests on: truncating a folded queue equals folding the
// truncated one. Checked at every prefix length, not just one.
function testTruncationEqualsPrefixFold() {
	const s = baseState()
	const queue = threeRoads(s)
	for (let n = 0; n <= queue.length; n++) {
		const prefix = queue.slice(0, n)
		const viaFold = applyLocalActions(s, 0, prefix, AT)
		assert(!('error' in viaFold), `prefix of ${n} folds`)
		const viaProject = projectQueue(s, 0, prefix)
		equal(viaProject.valid, n, `projection accepts all ${n}`)
		equal(
			JSON.stringify(viaProject.state),
			JSON.stringify(viaFold.state),
			`prefix of ${n} projects to the same state`
		)
	}
}

// A queue rebased onto a row it no longer fits is cut at the first bad action
// rather than thrown away.
function testProjectionTruncatesOnRebase() {
	const s = baseState()
	const queue = threeRoads(s)
	// Someone else took the second road's edge while the queue sat unsent.
	const stolen: GameState = {
		...s,
		edges: {
			...s.edges,
			[queue[1].edge as Edge]: {
				occupied: true,
				player: 1,
				placedTurn: 4,
			},
		},
	}
	const projected = projectQueue(stolen, 0, queue)
	equal(projected.valid, 1, 'keeps what still applies')
	assert(
		projected.state.edges[queue[0].edge as Edge]?.occupied,
		'the first road survives'
	)
}

function testEmptyQueueIsIdentity() {
	const s = baseState()
	const projected = projectQueue(s, 0, [])
	equal(projected.state, s, 'no queue, no copy')
	equal(projected.valid, 0, 'nothing applied')
}

// --- Dev-card plays ---------------------------------------------------------

// Seat 0 holds `cards` (bought last round, so playable) and `knights` played.
function withCards(s: GameState, cards: DevCardId[], knights = 0): GameState {
	return {
		...s,
		players: s.players.map((p, i) =>
			i === 0
				? {
						...p,
						devCards: cards.map((id) => ({ id, purchasedTurn: 4 })),
						devCardsPlayed: knights ? { knight: knights } : {},
					}
				: p
		),
	}
}

const play = (id: 'knight' | 'road_building'): LocalAction => ({
	action: 'play_dev_card',
	id,
})

function testRoadBuildingFoldsAndUndoes() {
	const s = withCards(baseState(), ['road_building'])
	const played = ok(applyLocalAction(s, 0, play('road_building'), AT))
	equal(played.phase.kind, 'road_building', 'enters free-road placement')
	equal(played.players[0].devCards.length, 0, 'card leaves the hand')
	assert(played.players[0].playedDevThisTurn, 'one card per turn')

	const [e1] = homeEdges()
	const afterOne = ok(
		applyLocalAction(played, 0, { action: 'build_road', edge: e1 }, AT)
	)
	const e2 = continuationOf(afterOne, e1)
	const queue: LocalAction[] = [
		play('road_building'),
		{ action: 'build_road', edge: e1 },
		{ action: 'build_road', edge: e2 },
	]
	const full = projectQueue(s, 0, queue)
	equal(full.valid, 3, 'whole queue applies')
	equal(full.state.phase.kind, 'main', 'resumes after two roads')
	equal(full.state.players[0].resources.wood, 8, 'free roads cost nothing')
	equal(projectQueue(s, 0, []).state, s, 'undoing everything is the row')
}

function testRoadBuildingWithNoRoomResumes() {
	// No settlement anywhere: no edge connects, so there's nowhere to build.
	const s = withCards({ ...baseState(), vertices: {} }, ['road_building'])
	const played = ok(applyLocalAction(s, 0, play('road_building'), AT))
	equal(played.phase.kind, 'main', 'card spent, phase unchanged')
}

function testKnightStopsAtTheRobber() {
	const s = withCards(baseState(), ['knight'], 2)
	const played = ok(applyLocalAction(s, 0, play('knight'), AT))
	equal(played.phase.kind, 'move_robber', 'robber is next')
	assert(
		played.phase.kind === 'move_robber' &&
			played.phase.resume.kind === 'main',
		'resumes into main'
	)
	equal(played.largestArmy, 0, 'third knight takes Largest Army')
}

function testKnightCanWinThroughLargestArmy() {
	// 1 settlement + 7 hidden VP + Largest Army's 2 = 10.
	const s = withCards(
		baseState(),
		['knight', ...Array<DevCardId>(7).fill('victory_point')],
		2
	)
	const played = ok(applyLocalAction(s, 0, play('knight'), AT))
	equal(played.phase.kind, 'game_over', 'the knight wins on the spot')
}

function testYearOfPlentyTakesTwo() {
	const s = withCards(baseState(), ['year_of_plenty'])
	const played = ok(
		applyLocalAction(
			s,
			0,
			{
				action: 'play_dev_card',
				id: 'year_of_plenty',
				payload: { r1: 'ore', r2: 'ore' },
			},
			AT
		)
	)
	equal(played.players[0].resources.ore, 10, 'a repeated pick adds twice')
	equal(played.phase.kind, 'main', 'no sub-phase')
}

function testDevPlayRejections() {
	const s = withCards(baseState(), ['knight', 'monopoly'])
	const monopoly = applyLocalAction(
		s,
		0,
		{ action: 'play_dev_card', id: 'monopoly' } as unknown as LocalAction,
		AT
	)
	assert(isApplyError(monopoly), 'monopoly never queues')

	const fresh: GameState = {
		...s,
		players: s.players.map((p, i) =>
			i === 0
				? { ...p, devCards: [{ id: 'knight', purchasedTurn: 5 }] }
				: p
		),
	}
	assert(
		isApplyError(applyLocalAction(fresh, 0, play('knight'), AT)),
		'a card bought this turn waits'
	)

	const twice = applyLocalActions(
		withCards(baseState(), ['knight', 'road_building']),
		0,
		[play('road_building'), play('knight')],
		AT
	)
	assert('index' in twice && twice.index === 1, 'one card per turn')

	const pending: GameState = {
		...s,
		phase: { kind: 'roll', pending: { dice: { a: 2, b: 3 } } },
	}
	assert(
		isApplyError(applyLocalAction(pending, 0, play('knight'), AT)),
		"a gambler's unconfirmed dice can't be dropped by a play"
	)
	const preRoll = ok(
		applyLocalAction(
			{ ...s, phase: { kind: 'roll' } },
			0,
			play('knight'),
			AT
		)
	)
	assert(
		preRoll.phase.kind === 'move_robber' &&
			preRoll.phase.resume.kind === 'roll',
		'pre-roll knight resumes into the roll'
	)
}

// --- The mirror -------------------------------------------------------------

// The edge function re-declares these reducers (the Deno bundler can't import
// up-tree from `supabase/functions/`). That copy is what real games run, so a
// silent divergence means the client shows a build the server will refuse —
// the exact failure the shared fold exists to prevent. Compare the bodies
// character for character.
function testEdgeMirrorIsInSync() {
	const lib = readFileSync(join(__dirname, '../lib/catan/apply.ts'), 'utf8')
	const edge = readFileSync(
		join(__dirname, '../supabase/functions/game-service/index.ts'),
		'utf8'
	)
	const names = [...lib.matchAll(/\nfunction (apply[A-Za-z]+)\(/g)].map(
		(m) => m[1]
	)
	equal(names.length, 15, 'one reducer per undoable action')
	names.push('startDevPlay')
	for (const name of names) {
		// The carpenter's cost is the one deliberate divergence: the edge names
		// it as a scalar (`CARPENTER_WOOD_COST`) where lib has a ResourceHand.
		if (name === 'applyBuyCarpenterVP') continue
		const body = (src: string) => {
			const fn = src.indexOf(`\nfunction ${name}(`)
			const i = fn >= 0 ? fn : src.indexOf(`\nexport function ${name}(`)
			assert(i >= 0, `${name} exists in both files`)
			const j = src.indexOf('\n}\n', i)
			return src.slice(i, j + 3)
		}
		equal(
			body(edge),
			body(lib),
			`${name} has drifted from lib/catan/apply.ts`
		)
	}
}

const tests: [string, () => void][] = [
	['build road charges and places', testBuildRoadChargesAndPlaces],
	['unaffordable build rejected', testUnaffordableIsRejected],
	['wrong turn rejected', testWrongTurnIsRejected],
	['rejection leaves state untouched', testRejectionLeavesStateUntouched],
	['second road chains off the first', testSecondRoadChainsOffTheFirst],
	['carpenter VP, once a turn', testCarpenterVPAndWin],
	['a win moves the phase to game over', testWinMovesPhaseToGameOver],
	['events are produced', testEventsAreProduced],
	['fold applies in order', testFoldAppliesInOrder],
	['fold reports the failing index', testFoldReportsTheFailingIndex],
	['truncation equals prefix fold', testTruncationEqualsPrefixFold],
	['projection truncates on rebase', testProjectionTruncatesOnRebase],
	['empty queue is identity', testEmptyQueueIsIdentity],
	['road building folds and undoes', testRoadBuildingFoldsAndUndoes],
	['road building with no room resumes', testRoadBuildingWithNoRoomResumes],
	['knight stops at the robber', testKnightStopsAtTheRobber],
	['knight can win via Largest Army', testKnightCanWinThroughLargestArmy],
	['year of plenty takes two', testYearOfPlentyTakesTwo],
	['dev play rejections', testDevPlayRejections],
	['edge mirror is in sync', testEdgeMirrorIsInSync],
]

for (const [name, fn] of tests) {
	fn()
	console.log(`  ok  ${name}`)
}
console.log(`OK: ${tests.length} apply tests passed.`)
