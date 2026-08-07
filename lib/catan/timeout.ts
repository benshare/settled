// Pure rules for move timeouts. No I/O — usable from client UI (the countdown)
// or tests. The edge function re-implements the same logic and is the
// authority; it owns both writing `games.deadline_at` and acting on it.
//
// See `.claude/specs/move-timeouts.md`.

import type { Phase } from './types'

// How long a game may sit idle before whoever is holding it up is skipped.
// `2d` is the default; `null` (a deliberate choice, and every game created
// before this shipped that the backfill missed) means no clock at all.
export const TIMEOUT_OPTIONS = [
	'1h',
	'3h',
	'12h',
	'1d',
	'2d',
	'3d',
	'4d',
	'5d',
	'6d',
	'7d',
] as const

export type TimeoutOption = (typeof TIMEOUT_OPTIONS)[number]

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const TIMEOUT_MS: Record<TimeoutOption, number> = {
	'1h': HOUR,
	'3h': 3 * HOUR,
	'12h': 12 * HOUR,
	'1d': DAY,
	'2d': 2 * DAY,
	'3d': 3 * DAY,
	'4d': 4 * DAY,
	'5d': 5 * DAY,
	'6d': 6 * DAY,
	'7d': 7 * DAY,
}

export function timeoutMs(option: TimeoutOption): number {
	return TIMEOUT_MS[option]
}

// One home for the copy — the Select, the config summary and the warning push
// all read it, so a game can't describe its own timeout two different ways.
export function timeoutLabel(option: TimeoutOption): string {
	const n = Number(option.slice(0, -1))
	const unit = option.endsWith('h') ? 'hour' : 'day'
	return `${n} ${unit}${n === 1 ? '' : 's'}`
}

export function isTimeoutOption(v: unknown): v is TimeoutOption {
	return TIMEOUT_OPTIONS.includes(v as TimeoutOption)
}

// The window a seat gets once it has already been skipped by a timeout, until
// it acts again. An absent player is then skipped about once a minute instead
// of stalling the table for another full window every go-around.
export const TIMEOUT_PENALTY_MS = 60 * 1000

// Only warn about a deadline this far out or nearer. The 1h stage is skipped
// entirely for games whose whole window is an hour or three — see
// `warningStageDue`.
export const WARN_HOUR_MS = HOUR
export const WARN_TEN_MIN_MS = 10 * 60 * 1000

// Timeouts at or above this get the extra one-hour warning; 1h and 3h games
// get only the ten-minute one.
const HOUR_WARNING_MIN_TIMEOUT_MS = 12 * HOUR

/**
 * Every seat the game is waiting on right now — the one derivation behind who
 * gets warned, who gets skipped, and whose countdown the UI shows, so the three
 * can't disagree.
 *
 * Deliberately NOT `current_turn`: that names the wrong seat during
 * `special_build` (it has already advanced to the next roller) and is null for
 * the whole simultaneous bonus-selection phase. The parallel phases return
 * several seats at once.
 *
 * Exhaustive over `Phase['kind']` on purpose — a new phase must fail to compile
 * rather than silently never timing out.
 */
export function pendingSeats(
	phase: Phase,
	currentTurn: number | null
): number[] {
	const turn = currentTurn === null ? [] : [currentTurn]
	switch (phase.kind) {
		case 'select_bonus':
			return Object.entries(phase.hands)
				.filter(([, hand]) => hand.chosen === null)
				.map(([idx]) => Number(idx))
		case 'initial_placement':
			return turn
		case 'post_placement': {
			const p = phase.pending
			const seats = new Set<number>(p.specialist)
			for (const idx of p.haunt ?? []) seats.add(idx)
			for (const [idx, owed] of Object.entries(p.explorer ?? {})) {
				if ((owed ?? 0) > 0) seats.add(Number(idx))
			}
			return [...seats].sort((a, b) => a - b)
		}
		case 'roll':
		case 'main':
		case 'move_robber':
		case 'steal':
		case 'road_building':
			return turn
		case 'discard':
			return Object.keys(phase.pending).map(Number)
		case 'scout_pick':
			return [phase.owner]
		case 'curio_pick':
			return [...phase.pending]
		case 'forger_pick':
			return phase.queue.length > 0 ? [phase.queue[0].idx] : []
		case 'magician_pick':
			return [phase.roller]
		case 'special_build':
			return phase.queue.length > 0 ? [phase.queue[0]] : []
		case 'game_over':
			return []
	}
}

/**
 * `pendingSeats` in user ids — the "waiting on you" signal behind the Games
 * list dot, the header tab badge and the app-icon badge count.
 *
 * An undefined `phase` means the game's board hasn't loaded, and the answer is
 * "nobody" rather than a guess: the turn pointer lives on the same row, so
 * there is nothing left to fall back to. Callers that must not act on a
 * non-answer distinguish it themselves — `useAppBadge` leaves the icon alone
 * rather than writing a zero it can't stand behind.
 *
 * Mirrored in `_notify`'s badge query (`supabase/functions/_shared/phase.ts`).
 */
export function pendingUserIds(
	playerOrder: string[],
	phase: Phase | undefined,
	currentTurn: number | null
): string[] {
	if (!phase) return []
	return pendingSeats(phase, currentTurn)
		.map((idx) => playerOrder[idx])
		.filter((id): id is string => id !== undefined)
}

/**
 * The deadline to stamp on a game after an action, or null when it has no
 * clock. `timedOut` holds the user ids that have been skipped and not acted
 * since: any of them being on the clock shortens the window to a minute.
 *
 * `now` is a parameter rather than a `Date.now()` call, to keep this pure.
 */
export function deadlineFor(args: {
	timeout: TimeoutOption | null
	phase: Phase
	currentTurn: number | null
	playerOrder: string[]
	timedOut: string[]
	now: number
}): string | null {
	const { timeout, phase, currentTurn, playerOrder, timedOut, now } = args
	if (timeout === null) return null
	const pending = pendingSeats(phase, currentTurn)
	if (pending.length === 0) return null
	const penalized = pending.some((idx) => {
		const userId = playerOrder[idx]
		return userId !== undefined && timedOut.includes(userId)
	})
	const window = penalized ? TIMEOUT_PENALTY_MS : timeoutMs(timeout)
	return new Date(now + window).toISOString()
}

/**
 * The warning stage a game is due, or null when it owes none. Stage 1 is the
 * one-hour heads-up (long games only), stage 2 the ten-minute one. `warned` is
 * the highest stage already sent for this deadline — stages never repeat and
 * never go backwards, so a game that was quiet through its 1h mark and is first
 * seen inside ten minutes just gets stage 2.
 *
 * A seat inside its penalty window is never warned: there is no room for a
 * ten-minute warning in a one-minute window, and the caller filters those seats
 * out before asking.
 */
export function warningStageDue(args: {
	timeout: TimeoutOption
	deadlineAt: number
	warned: number
	now: number
}): 1 | 2 | null {
	const { timeout, deadlineAt, warned, now } = args
	const remaining = deadlineAt - now
	if (warned < 2 && remaining <= WARN_TEN_MIN_MS) return 2
	if (
		warned < 1 &&
		timeoutMs(timeout) >= HOUR_WARNING_MIN_TIMEOUT_MS &&
		remaining <= WARN_HOUR_MS
	)
		return 1
	return null
}

// How long is left, in ms, clamped at zero. `null` deadline → null.
export function remainingMs(
	deadlineAt: string | null | undefined,
	now: number
): number | null {
	if (!deadlineAt) return null
	const t = Date.parse(deadlineAt)
	if (Number.isNaN(t)) return null
	return Math.max(0, t - now)
}

// Below this, the countdown is worth showing. A 1-hour game therefore shows one
// from the start; a 7-day game only in its final hour.
export const COUNTDOWN_VISIBLE_MS = 60 * 60 * 1000

/**
 * Compact remaining time for the countdown chip. Minutes down to the last one,
 * then seconds — the penalty window lives entirely inside that final minute, so
 * it needs the finer grain.
 */
export function formatRemaining(ms: number): string {
	if (ms >= 60 * 60 * 1000) {
		const h = Math.floor(ms / (60 * 60 * 1000))
		const m = Math.round((ms % (60 * 60 * 1000)) / 60000)
		return m > 0 ? `${h}h ${m}m` : `${h}h`
	}
	if (ms >= 60000) return `${Math.floor(ms / 60000)}m`
	return `${Math.floor(ms / 1000)}s`
}
