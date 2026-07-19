// Pure rules for the Honk nudge. No I/O — usable from client UI (button
// gating) or tests. The edge function re-implements the same logic and is the
// authority; the client copy only decides whether to show the button.

import type { GameEvent } from '../stores/useGamesStore'
import type { Phase } from './types'

// How long the table must sit idle before the stalled player can be honked.
export const HONK_IDLE_MS = 60 * 1000

/**
 * Timestamp of the newest real game activity, or null when nothing has
 * happened yet. Honks are excluded on purpose: a honk isn't activity, and
 * counting it would let the first honker's ping restart the idle window and
 * lock every other player out for another full idle window.
 */
export function lastActivityAt(events: GameEvent[]): number | null {
	let newest: number | null = null
	for (const e of events) {
		if (e.kind === 'honked') continue
		const t = Date.parse(e.at)
		if (Number.isNaN(t)) continue
		if (newest === null || t > newest) newest = t
	}
	return newest
}

/**
 * Seats that have already honked during the current turn. The turn's window is
 * everything after the most recent `turn_ended` — so the per-turn allowance
 * resets on every turn advance with no stored state to reset. Before the first
 * `turn_ended` (the opening turn out of placement) the whole log is the window.
 */
export function honkersThisTurn(events: GameEvent[]): Set<number> {
	let start = 0
	for (let i = events.length - 1; i >= 0; i--) {
		if (events[i].kind === 'turn_ended') {
			start = i + 1
			break
		}
	}
	const honkers = new Set<number>()
	for (let i = start; i < events.length; i++) {
		const e = events[i]
		if (e.kind === 'honked') honkers.add(e.from)
	}
	return honkers
}

/**
 * Whether `meIdx` may honk the player at `currentTurn` right now. Gates the
 * button client-side and authorizes the write server-side, so the two can't
 * disagree. `now` is a parameter rather than a `Date.now()` call to keep this
 * pure and testable.
 */
export function canHonk(args: {
	events: GameEvent[]
	phase: Phase
	meIdx: number
	currentTurn: number
	now: number
}): boolean {
	const { events, phase, meIdx, currentTurn, now } = args
	// Both halves of a normal turn are honkable: sitting on the roll prompt, and
	// stalling mid-turn over builds/trades. Sub-phases (discard, robber, the
	// bonus picks) are excluded — those are already blocking prompts.
	if (phase.kind !== 'roll' && phase.kind !== 'main') return false
	if (meIdx < 0 || meIdx === currentTurn) return false
	if (honkersThisTurn(events).has(meIdx)) return false
	const last = lastActivityAt(events)
	return last !== null && now - last >= HONK_IDLE_MS
}
