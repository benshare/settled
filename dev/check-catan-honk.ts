// Runtime checks for lib/catan/honk.ts. Run with
// `npx tsx dev/check-catan-honk.ts`. Exits 0 on success; throws with a
// specific message on the first failure.

import { HONK_IDLE_MS, canHonk, honkersThisTurn } from '../lib/catan/honk'
import type { GameEvent } from '../lib/stores/useGamesStore'
import type { Phase } from '../lib/catan/types'

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(`assert: ${msg}`)
}

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0)
const ROLL: Phase = { kind: 'roll' }
const MAIN: Phase = { kind: 'main', roll: { a: 3, b: 4 }, trade: null }

// `ago` ms before NOW.
const at = (ago: number) => new Date(NOW - ago).toISOString()

const rolled = (player: number, ago: number): GameEvent => ({
	kind: 'rolled',
	player,
	dice: [3, 4],
	total: 7,
	at: at(ago),
})
const turnEnded = (player: number, ago: number): GameEvent => ({
	kind: 'turn_ended',
	player,
	at: at(ago),
})
const honked = (from: number, player: number, ago: number): GameEvent => ({
	kind: 'honked',
	player,
	from,
	at: at(ago),
})

// Seat 1 waiting on seat 0, who last acted `idleFor` ms ago.
const can = (events: GameEvent[], meIdx = 1, phase: Phase = ROLL) =>
	canHonk({ events, phase, meIdx, currentTurn: 0, now: NOW, enabled: true })

function testIdleThreshold() {
	const justUnder = [turnEnded(3, HONK_IDLE_MS - 1000)]
	assert(!can(justUnder), 'not honkable one second under the threshold')

	const exactly = [turnEnded(3, HONK_IDLE_MS)]
	assert(can(exactly), 'honkable exactly at the threshold')

	const over = [turnEnded(3, HONK_IDLE_MS + 60_000)]
	assert(can(over), 'honkable past the threshold')
}

function testNoEventsIsNotHonkable() {
	assert(!can([]), 'an empty log has no idle clock to read')
}

function testHonkablePhases() {
	const idle = [turnEnded(3, HONK_IDLE_MS * 2)]
	assert(can(idle, 1, MAIN), 'main phase is honkable')
	assert(
		!can(idle, 1, {
			kind: 'discard',
			pending: {},
			resume: { kind: 'main', roll: { a: 3, b: 4 }, trade: null },
		}),
		'discard is a blocking prompt, not honkable'
	)
}

// During the special build phase the stalled player is the queue head, not
// `current_turn` (which has already advanced to the next roller).
function testSpecialBuildTargetsTheQueueHead() {
	const idle = [turnEnded(3, HONK_IDLE_MS * 2)]
	const sb: Phase = { kind: 'special_build', queue: [2, 3] }
	assert(can(idle, 1, sb), 'a waiting seat can honk the special builder')
	assert(!can(idle, 2, sb), 'the special builder cannot honk themselves')
	assert(can(idle, 0, sb), 'the seat at current_turn is not the target here')
	assert(
		!can(idle, 1, { kind: 'special_build', queue: [] }),
		'an empty queue has nobody to honk'
	)
}

// One turn window can hold several stalled players — each special builder in
// turn, then the roller — so the allowance is per-target, not per-window.
function testAllowanceIsPerTarget() {
	const events = [turnEnded(3, HONK_IDLE_MS * 2), honked(1, 2, 1000)]
	const sb = (head: number): Phase => ({
		kind: 'special_build',
		queue: [head],
	})
	assert(!can(events, 1, sb(2)), 'seat 1 already honked seat 2')
	assert(can(events, 1, sb(3)), 'seat 1 still has a honk for seat 3')
	assert(can(events, 1, ROLL), 'seat 1 still has a honk for the roller')
}

function testCannotHonkSelf() {
	const idle = [turnEnded(3, HONK_IDLE_MS * 2)]
	assert(!can(idle, 0), 'the current player cannot honk themselves')
}

function testSpectatorCannotHonk() {
	const idle = [turnEnded(3, HONK_IDLE_MS * 2)]
	assert(!can(idle, -1), 'a non-participant cannot honk')
}

// The core of the "one per sender" rule: a honk must not restart the idle
// clock, or the first honker would lock everyone else out for another full idle window.
function testHonkDoesNotResetTheClock() {
	const events = [turnEnded(3, HONK_IDLE_MS * 2), honked(2, 0, 1000)]
	assert(can(events), 'seat 1 can still honk right after seat 2 honked')
}

function testOneHonkPerSenderPerTurn() {
	const events = [turnEnded(3, HONK_IDLE_MS * 2), honked(1, 0, 1000)]
	assert(!can(events, 1), 'seat 1 already honked this turn')
	assert(can(events, 2), 'seat 2 has its own allowance')
}

function testAllowanceResetsOnTurnEnd() {
	const events = [
		turnEnded(4, HONK_IDLE_MS * 3),
		honked(1, 0, HONK_IDLE_MS * 3),
		// New turn starts here — seat 1's spent honk is now out of the window.
		turnEnded(0, HONK_IDLE_MS * 2),
	]
	assert(honkersThisTurn(events, 0).size === 0, 'window resets at turn_ended')
	assert(can(events, 1), 'seat 1 may honk again on the next turn')
}

// Before the first turn_ended (the opening turn out of placement) the whole
// log is the window.
function testFirstTurnWindow() {
	const events: GameEvent[] = [
		{ kind: 'placement_complete', at: at(HONK_IDLE_MS * 2) },
		honked(1, 0, 1000),
	]
	assert(
		honkersThisTurn(events, 0).has(1),
		'seat 1 counted with no turn_ended'
	)
	assert(!can(events, 1), 'seat 1 already honked the opening turn')
	assert(can(events, 2), 'seat 2 may still honk the opening turn')
}

// Only the newest non-honk event matters, regardless of array order.
function testUsesNewestActivity() {
	const events = [rolled(3, HONK_IDLE_MS * 5), turnEnded(3, 1000)]
	assert(!can(events), 'a recent turn_ended keeps the table active')
}

// A game with honking disabled is never honkable, however idle the table is.
function testDisabledGameIsNeverHonkable() {
	const idle = [turnEnded(3, HONK_IDLE_MS * 2)]
	assert(
		!canHonk({
			events: idle,
			phase: ROLL,
			meIdx: 1,
			currentTurn: 0,
			now: NOW,
			enabled: false,
		}),
		'honking disabled overrides an idle table'
	)
}

const tests: [string, () => void][] = [
	['idle threshold boundary', testIdleThreshold],
	['no events is not honkable', testNoEventsIsNotHonkable],
	['honkable phases', testHonkablePhases],
	[
		'special build targets the queue head',
		testSpecialBuildTargetsTheQueueHead,
	],
	['allowance is per target', testAllowanceIsPerTarget],
	['cannot honk self', testCannotHonkSelf],
	['spectator cannot honk', testSpectatorCannotHonk],
	['honk does not reset the clock', testHonkDoesNotResetTheClock],
	['one honk per sender per turn', testOneHonkPerSenderPerTurn],
	['allowance resets on turn end', testAllowanceResetsOnTurnEnd],
	['first turn window', testFirstTurnWindow],
	['uses newest activity', testUsesNewestActivity],
	['disabled game is never honkable', testDisabledGameIsNeverHonkable],
]

for (const [name, fn] of tests) {
	fn()
	console.log(`  ok  ${name}`)
}
console.log(`OK: ${tests.length} honk tests passed.`)
