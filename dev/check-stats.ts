// Runtime checks for lib/stats.ts. Run with `npx tsx dev/check-stats.ts`.
// Exits 0 on success; throws with a specific message on the first failure.

import type { BonusId, CurseId } from '../lib/catan/bonuses'
import { computeStats } from '../lib/stats'
import type { Game } from '../lib/stores/useGamesStore'
import type { GameResult } from '../lib/stores/useStatsStore'

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(`assert: ${msg}`)
}

function close(a: number, b: number, msg: string) {
	assert(Math.abs(a - b) < 1e-9, `${msg} (got ${a}, want ${b})`)
}

const ME = 'me'

let seq = 0
const result = (over: Partial<GameResult> = {}): GameResult => ({
	game_id: `g${seq++}`,
	user_id: ME,
	player_index: 0,
	points: 10,
	placement: 1,
	won: true,
	turns: 40,
	player_count: 4,
	bonus: null,
	curse: null,
	offered_bonuses: null,
	completed_at: '2026-07-01T00:00:00.000Z',
	...over,
})

const game = (id: string, participants: string[]): Game =>
	({ id, participants }) as Game

// --- Empty input -----------------------------------------------------------

const empty = computeStats([], [], ME)
assert(empty.gamesPlayed === 0, 'empty: no games')
assert(empty.winRate === 0, 'empty: win rate 0, not NaN')
assert(empty.avgPoints === 0, 'empty: avg points 0, not NaN')
assert(empty.topPickRate === null, 'empty: no pick rate')
assert(empty.topWinRate === null, 'empty: no win rate')
assert(empty.distinctOpponents === 0, 'empty: no opponents')

// --- Game averages ---------------------------------------------------------

const games = computeStats(
	[
		result({
			points: 10,
			placement: 1,
			won: true,
			turns: 40,
			player_count: 4,
		}),
		result({
			points: 6,
			placement: 3,
			won: false,
			turns: 30,
			player_count: 3,
		}),
	],
	[],
	ME
)
assert(games.gamesPlayed === 2, 'averages: two games')
close(games.winRate, 0.5, 'averages: win rate')
close(games.avgPoints, 8, 'averages: avg points')
close(games.avgPlacement, 2, 'averages: avg placement')
close(games.avgPlayers, 3.5, 'averages: avg players')
// Rounds are per-game turns/players (10 and 10), not total turns / total
// players — a long 3-player game shouldn't read as short next to a 4-player one.
close(games.avgRounds, 10, 'averages: avg rounds')

// A malformed row (player_count 0) must not divide by zero.
const zeroPlayers = computeStats(
	[result({ player_count: 0, turns: 5 })],
	[],
	ME
)
close(zeroPlayers.avgRounds, 0, 'zero player_count: rounds 0, not Infinity')

// --- Opponents -------------------------------------------------------------

const friends = computeStats(
	[result(), result(), result()],
	[
		game('a', [ME, 'x', 'y']),
		game('b', [ME, 'x']),
		game('c', [ME, 'x', 'z']),
		game('d', [ME, 'y']),
	],
	ME
)
assert(friends.distinctOpponents === 3, 'opponents: x, y, z')
assert(
	friends.topOpponents[0]?.userId === 'x' &&
		friends.topOpponents[0].games === 3,
	'opponents: x played most'
)
assert(
	friends.topOpponents[1]?.userId === 'y' &&
		friends.topOpponents[1].games === 2,
	'opponents: y second'
)
assert(friends.topOpponents.length === 3, 'opponents: self excluded')

const many = computeStats(
	[result()],
	[game('a', [ME, 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'])],
	ME
)
assert(many.topOpponents.length === 5, 'opponents: capped at five')

// --- Bonuses / curses ------------------------------------------------------

const b = (id: BonusId, over: Partial<GameResult> = {}) =>
	result({ bonus: id, ...over })

const noBonuses = computeStats([result(), result()], [], ME)
assert(noBonuses.bonusGames === 0, 'no-bonus games: bonusGames 0')
assert(noBonuses.topWinRate === null, 'no-bonus games: no win rate')

const bonuses = computeStats(
	[
		b('gambler', { won: true, curse: 'age' as CurseId }),
		b('gambler', { won: false, curse: 'age' as CurseId }),
		b('merchant', { won: true, curse: 'youth' as CurseId }),
		result({ won: false }),
	],
	[],
	ME
)
assert(bonuses.bonusGames === 3, 'bonuses: three bonus games')
assert(bonuses.bonusesPlayed === 2, 'bonuses: two distinct')
assert(bonuses.cursesPlayed === 2, 'bonuses: two distinct curses')
assert(bonuses.bonusPoolSize > 20, 'bonuses: pool size looks real')
assert(
	bonuses.topWinRate?.bonus === 'merchant' &&
		bonuses.topWinRate.hits === 1 &&
		bonuses.topWinRate.total === 1,
	'bonuses: 1-of-1 merchant beats 1-of-2 gambler (no minimum sample)'
)

// --- Pick rate -------------------------------------------------------------

assert(
	computeStats([b('gambler'), b('merchant')], [], ME).topPickRate === null,
	'pick rate: null without offer data'
)

const picks = computeStats(
	[
		b('gambler', { offered_bonuses: ['gambler', 'merchant'] }),
		b('gambler', { offered_bonuses: ['gambler', 'scout'] }),
		b('scout', { offered_bonuses: ['scout', 'merchant'] }),
		// No offer data — must not count against anyone's denominator.
		b('merchant'),
	],
	[],
	ME
)
assert(
	picks.topPickRate?.bonus === 'gambler' &&
		picks.topPickRate.hits === 2 &&
		picks.topPickRate.total === 2,
	'pick rate: gambler kept both times offered'
)

// Ties break toward the larger sample: both are 100%, scout was offered twice.
const tie = computeStats(
	[
		b('scout', { offered_bonuses: ['scout', 'gambler'] }),
		b('scout', { offered_bonuses: ['scout', 'veteran'] }),
		b('merchant', { offered_bonuses: ['merchant', 'haunt'] }),
	],
	[],
	ME
)
assert(
	tie.topPickRate?.bonus === 'scout' && tie.topPickRate.total === 2,
	'pick rate: tie broken by sample size'
)

console.log('check-stats: all checks passed')
