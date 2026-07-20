// Pure derivations for the end-of-game recap: the shared roll distribution and
// the highlight superlatives. Read-only over `games.events` — no I/O, and (unlike
// the rules in this directory) nothing here is mirrored in the edge function,
// because this is a client-only recap with no authority over game state.

import type { GameEvent } from '../stores/useGamesStore'

/**
 * Count of each dice total across every shared `rolled` event, indexed by total
 * (indices 0 and 1 are always 0). Bonus rolls (fortune teller / ritual) are
 * intentionally excluded — this is the table's shared production distribution,
 * not per-player bonus dice.
 */
export function rollDistribution(events: GameEvent[]): number[] {
	const counts = new Array(13).fill(0)
	for (const e of events) {
		if (e.kind === 'rolled') counts[e.total]++
	}
	return counts
}

export type Highlight = {
	key: string
	// The fun award name, e.g. "Friendliest".
	title: string
	// What it measures, e.g. "Most trades".
	subtitle: string
	// MaterialCommunityIcons glyph name.
	icon: string
	// Winning seats — all players tied for the extreme. Empty when there's no
	// standout: everybody tied (no contrast) or a "most" award where nobody did
	// the thing at all.
	winners: number[]
	value: number
	// Rendered unit for the value, e.g. "trades", "cards", "honks".
	unit: string
}

/**
 * Whichever seats hold the extreme (max or min) of `values`. Returns no winners
 * when every seat ties — an all-tie has no standout to celebrate, which also
 * folds in the "nobody did it" case for `max` (all zero → all tie).
 */
function extreme(
	values: number[],
	mode: 'max' | 'min'
): { winners: number[]; value: number } {
	const n = values.length
	if (n === 0) return { winners: [], value: 0 }
	let best = values[0]
	for (const v of values) {
		best = mode === 'max' ? Math.max(best, v) : Math.min(best, v)
	}
	const winners: number[] = []
	for (let i = 0; i < n; i++) if (values[i] === best) winners.push(i)
	if (winners.length === n) return { winners: [], value: best }
	return { winners, value: best }
}

/**
 * The six game highlights, derived entirely from the event log. Trades count
 * accepted player-to-player trades only (both parties credited); bank/port
 * trades don't count. See `extreme` for tie/zero handling.
 */
export function gameHighlights(
	events: GameEvent[],
	playerCount: number
): Highlight[] {
	const trades = new Array(playerCount).fill(0)
	const discards = new Array(playerCount).fill(0)
	const robbed = new Array(playerCount).fill(0)
	const honksMade = new Array(playerCount).fill(0)
	const honksReceived = new Array(playerCount).fill(0)

	const inRange = (i: number) => i >= 0 && i < playerCount

	for (const e of events) {
		switch (e.kind) {
			case 'trade_accepted':
				if (inRange(e.from)) trades[e.from]++
				if (inRange(e.to)) trades[e.to]++
				break
			case 'discarded':
				if (inRange(e.player)) discards[e.player] += e.count
				break
			case 'stolen':
				if (inRange(e.victim)) robbed[e.victim]++
				break
			case 'honked':
				if (inRange(e.from)) honksMade[e.from]++
				if (inRange(e.player)) honksReceived[e.player]++
				break
		}
	}

	return [
		{
			key: 'friendliest',
			title: 'Friendliest',
			subtitle: 'Most trades',
			icon: 'handshake',
			unit: 'trades',
			...extreme(trades, 'max'),
		},
		{
			key: 'antisocial',
			title: 'Antisocial',
			subtitle: 'Fewest trades',
			icon: 'account-off-outline',
			unit: 'trades',
			...extreme(trades, 'min'),
		},
		{
			key: 'klutziest',
			title: 'Klutziest',
			subtitle: 'Most cards lost to 7s',
			icon: 'cards-outline',
			unit: 'cards',
			...extreme(discards, 'max'),
		},
		{
			key: 'targeted',
			title: 'Most Targeted',
			subtitle: 'Robbed the most',
			icon: 'target-account',
			unit: 'times',
			...extreme(robbed, 'max'),
		},
		{
			key: 'honker',
			title: 'Biggest Honker',
			subtitle: 'Honked the most',
			icon: 'bullhorn',
			unit: 'honks',
			...extreme(honksMade, 'max'),
		},
		{
			key: 'honkee',
			title: 'Biggest Honk-ee',
			subtitle: 'Honked at the most',
			icon: 'bullhorn-outline',
			unit: 'honks',
			...extreme(honksReceived, 'max'),
		},
	]
}
