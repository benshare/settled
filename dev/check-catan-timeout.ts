// Runtime checks for lib/catan/timeout.ts. Run with
// `npx tsx dev/check-catan-timeout.ts`. Exits 0 on success; throws with a
// specific message on the first failure.

import {
	TIMEOUT_OPTIONS,
	TIMEOUT_PENALTY_MS,
	deadlineFor,
	formatRemaining,
	isTimeoutOption,
	pendingSeats,
	pendingUserIds,
	timeoutLabel,
	timeoutMs,
	warningStageDue,
} from '../lib/catan/timeout'
import type { Phase, SelectBonusHand } from '../lib/catan/types'

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(`assert: ${msg}`)
}
function equal<T>(a: T, b: T, msg: string) {
	if (a !== b) throw new Error(`assert: ${msg} (${a} !== ${b})`)
}

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0)
const HOUR = 60 * 60 * 1000
const ORDER = ['u0', 'u1', 'u2']

const hand = (chosen: string | null): SelectBonusHand => ({
	offered: ['bricklayer', 'carpenter'],
	curses: ['age'],
	chosen: chosen as SelectBonusHand['chosen'],
	chosenCurse: chosen === null ? null : 'age',
})

function testLabels() {
	equal(timeoutLabel('1h'), '1 hour', 'singular hour')
	equal(timeoutLabel('3h'), '3 hours', 'plural hours')
	equal(timeoutLabel('1d'), '1 day', 'singular day')
	equal(timeoutLabel('7d'), '7 days', 'plural days')
	// Every option must resolve to a positive, strictly increasing window —
	// the Select renders them in this order.
	let prev = 0
	for (const o of TIMEOUT_OPTIONS) {
		assert(timeoutMs(o) > prev, `${o} is longer than the option before it`)
		prev = timeoutMs(o)
	}
}

function testParsing() {
	assert(isTimeoutOption('12h'), 'a real option parses')
	assert(!isTimeoutOption('30m'), 'an unknown option does not')
	assert(!isTimeoutOption(null), 'null is not an option')
	assert(!isTimeoutOption(undefined), 'a missing value is not an option')
}

// The seats the game is waiting on drive who is warned, who is skipped, and
// whose countdown shows — the parallel phases return several at once, and two
// phases deliberately ignore `current_turn`.
function testPendingSeats() {
	equal(
		pendingSeats(
			{ kind: 'main', roll: { a: 3, b: 4 }, trade: null },
			1
		).join(),
		'1',
		'main waits on the turn holder'
	)
	equal(
		pendingSeats({ kind: 'roll' }, 2).join(),
		'2',
		'roll waits on the turn holder'
	)
	// current_turn has already advanced past the acting builder here.
	equal(
		pendingSeats({ kind: 'special_build', queue: [2, 0] }, 1).join(),
		'2',
		'special build waits on the queue head, not current_turn'
	)
	equal(
		pendingSeats(
			{
				kind: 'select_bonus',
				hands: { 0: hand('bricklayer'), 1: hand(null), 2: hand(null) },
			},
			null
		).join(),
		'1,2',
		'bonus selection waits on everyone who has not picked'
	)
	equal(
		pendingSeats(
			{
				kind: 'discard',
				resume: { kind: 'roll' },
				pending: { 0: 4, 2: 3 },
			},
			1
		).join(),
		'0,2',
		'discard waits on everyone who owes cards'
	)
	equal(
		pendingSeats(
			{
				kind: 'post_placement',
				pending: {
					specialist: [0],
					explorer: { 1: 2 },
					fencer: { 2: 0 },
					haunt: [2],
				},
			},
			0
		).join(),
		'0,1,2',
		'post placement merges every outstanding bonus, ignoring drained ones'
	)
	equal(
		pendingSeats({ kind: 'game_over' }, 0).length,
		0,
		'a finished game waits on nobody'
	)
	equal(
		pendingSeats({ kind: 'roll' }, null).length,
		0,
		'a null turn holder waits on nobody'
	)
}

// The same rule in user ids, which is what the Games list dot, the header tab
// badge and the app-icon badge all read.
function testPendingUserIds() {
	// The whole reported bug: nobody holds the turn during bonus selection, so
	// the ids have to come from the hands.
	equal(
		pendingUserIds(
			ORDER,
			{
				kind: 'select_bonus',
				hands: { 0: hand(null), 1: hand('bricklayer'), 2: hand(null) },
			},
			null
		).join(),
		'u0,u2',
		'bonus selection waits on everyone who has not locked in'
	)
	equal(
		pendingUserIds(
			ORDER,
			{
				kind: 'select_bonus',
				hands: {
					0: hand('bricklayer'),
					1: hand('bricklayer'),
					2: hand('bricklayer'),
				},
			},
			null
		).length,
		0,
		'and on nobody once every hand is in'
	)
	equal(
		pendingUserIds(ORDER, { kind: 'special_build', queue: [2] }, 0).join(),
		'u2',
		'special build waits on the queue head, not the advanced turn holder'
	)
	// A game whose board hasn't loaded gets no answer, not a guess: the turn
	// pointer lives on that same row, so there is nothing to fall back to.
	// Callers that must not act on a non-answer say so themselves — see
	// `useAppBadge`, which leaves the icon alone rather than writing a zero.
	equal(
		pendingUserIds(ORDER, undefined, 1).length,
		0,
		'an unloaded phase names nobody, even with a turn holder passed in'
	)
	equal(
		pendingUserIds(ORDER, { kind: 'roll' }, 7).length,
		0,
		'a seat past the end of the order names nobody'
	)
}

function testDeadline() {
	const base = {
		phase: { kind: 'main', roll: { a: 1, b: 2 }, trade: null } as Phase,
		currentTurn: 1,
		playerOrder: ORDER,
		now: NOW,
	}
	equal(
		deadlineFor({ ...base, timeout: null, timedOut: [] }),
		null,
		'no configured timeout means no deadline'
	)
	equal(
		deadlineFor({ ...base, timeout: '12h', timedOut: [] }),
		new Date(NOW + 12 * HOUR).toISOString(),
		'the full window when nobody has been skipped'
	)
	// The one-minute penalty is what stops an absent player stalling the table
	// for another full window every go-around.
	equal(
		deadlineFor({ ...base, timeout: '7d', timedOut: ['u1'] }),
		new Date(NOW + TIMEOUT_PENALTY_MS).toISOString(),
		'a flagged seat on the clock shortens the window to a minute'
	)
	equal(
		deadlineFor({ ...base, timeout: '7d', timedOut: ['u2'] }),
		new Date(NOW + 7 * 24 * HOUR).toISOString(),
		'a flagged seat NOT on the clock leaves the window alone'
	)
	equal(
		deadlineFor({
			...base,
			phase: { kind: 'game_over' },
			timeout: '1h',
			timedOut: [],
		}),
		null,
		'a phase waiting on nobody has no deadline'
	)
}

function testWarningStages() {
	const due = (
		timeout: '1h' | '3h' | '12h' | '7d',
		out: number,
		warned = 0
	) =>
		warningStageDue({
			timeout,
			deadlineAt: NOW + out,
			warned,
			now: NOW,
		})

	equal(due('7d', 2 * HOUR), null, 'nothing due two hours out')
	equal(due('7d', HOUR), 1, 'the hour warning is due at an hour out')
	equal(due('7d', HOUR, 1), null, 'a sent stage never repeats')
	equal(due('7d', 9 * 60 * 1000, 1), 2, 'the ten-minute warning follows it')
	equal(due('7d', 9 * 60 * 1000, 2), null, 'and it does not repeat either')
	// Short games skip the hour stage: 1h and 3h get the ten-minute warning
	// only, since an hour's notice on a one-hour clock is the whole game.
	equal(due('1h', 30 * 60 * 1000), null, 'no hour warning on a 1h timeout')
	equal(due('3h', HOUR), null, 'no hour warning on a 3h timeout')
	equal(due('3h', 5 * 60 * 1000), 2, 'but the ten-minute warning still fires')
	// A game first seen inside its final ten minutes gets stage 2, not both.
	equal(due('7d', 60 * 1000), 2, 'late arrival skips straight to stage 2')
}

function testFormatting() {
	equal(formatRemaining(45 * 1000), '45s', 'seconds in the final minute')
	equal(formatRemaining(0), '0s', 'zero reads as seconds')
	equal(formatRemaining(9 * 60 * 1000), '9m', 'whole minutes')
	equal(formatRemaining(HOUR), '1h', 'an exact hour has no minute part')
	equal(formatRemaining(HOUR + 30 * 60 * 1000), '1h 30m', 'hours + minutes')
}

const tests: [string, () => void][] = [
	['labels and windows', testLabels],
	['defensive parsing', testParsing],
	['pending seats per phase', testPendingSeats],
	['pending user ids', testPendingUserIds],
	['deadline and the penalty window', testDeadline],
	['warning stages', testWarningStages],
	['remaining-time formatting', testFormatting],
]

for (const [name, fn] of tests) {
	fn()
	console.log(`  ok  ${name}`)
}
console.log(`OK: ${tests.length} timeout tests passed.`)
