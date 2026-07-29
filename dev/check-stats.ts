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
	offered_curses: null,
	completed_at: '2026-07-01T00:00:00.000Z',
	forfeit: false,
	...over,
})

const game = (id: string, participants: string[], status = 'complete'): Game =>
	({ id, participants, status }) as Game

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
	bonuses.topWinRate?.id === 'merchant' &&
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
	picks.topPickRate?.id === 'gambler' &&
		picks.topPickRate.hits === 2 &&
		picks.topPickRate.total === 2,
	'pick rate: gambler kept both times offered'
)

// A single-card offer is not a pick — the player had nothing to decline.
const forced = computeStats(
	[
		b('gambler', { offered_bonuses: ['gambler'] }),
		b('scout', { offered_bonuses: ['scout'] }),
	],
	[],
	ME
)
assert(forced.topPickRate === null, 'pick rate: 1-card offers are not picks')

// Curses are measured the same way, off their own column.
const cursePicks = computeStats(
	[
		b('gambler', {
			curse: 'age' as CurseId,
			offered_curses: ['age', 'youth'] as CurseId[],
		}),
		b('scout', {
			curse: 'age' as CurseId,
			offered_curses: ['age', 'avarice'] as CurseId[],
		}),
		// Dealt, not chosen — excluded from the sample.
		b('merchant', {
			curse: 'youth' as CurseId,
			offered_curses: ['youth'] as CurseId[],
		}),
	],
	[],
	ME
)
assert(
	cursePicks.topCursePickRate?.id === 'age' &&
		cursePicks.topCursePickRate.hits === 2 &&
		cursePicks.topCursePickRate.total === 2,
	'curse pick rate: age kept both times offered'
)
assert(
	computeStats([b('gambler', { curse: 'age' as CurseId })], [], ME)
		.topCursePickRate === null,
	'curse pick rate: null without offer data'
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
	tie.topPickRate?.id === 'scout' && tie.topPickRate.total === 2,
	'pick rate: tie broken by sample size'
)

// --- Forfeited games -------------------------------------------------------
// A game that ended because everyone else forfeited counts toward games played
// and win rate, and nothing else. See lib/stats.ts.

const allForfeit = computeStats(
	[
		result({ forfeit: true, won: true, points: 4, placement: 1 }),
		result({ forfeit: true, won: false, points: 2, placement: 2 }),
	],
	[],
	ME
)
assert(allForfeit.gamesPlayed === 2, 'forfeit: counted in games played')
assert(allForfeit.playedGames === 0, 'forfeit: none played out')
close(allForfeit.winRate, 0.5, 'forfeit: win rate is real')
close(allForfeit.avgPoints, 0, 'forfeit: no points sample, not NaN')
close(allForfeit.avgPlacement, 0, 'forfeit: no placement sample')
close(allForfeit.avgRounds, 0, 'forfeit: no rounds sample')

const mixed = computeStats(
	[
		result({ points: 10, placement: 1, won: true, player_count: 4 }),
		result({ points: 6, placement: 3, won: false, player_count: 4 }),
		// Would drag every average down if it were counted.
		result({
			forfeit: true,
			points: 2,
			placement: 4,
			won: true,
			player_count: 4,
		}),
	],
	[],
	ME
)
assert(mixed.gamesPlayed === 3, 'mixed: win rate over all three')
assert(mixed.playedGames === 2, 'mixed: averages over two')
close(mixed.winRate, 2 / 3, 'mixed: forfeit win counts')
close(mixed.avgPoints, 8, 'mixed: avg points skips the forfeit')
close(mixed.avgPlacement, 2, 'mixed: avg placement skips the forfeit')

// Bonus stats follow the same rule — a bonus you never got to play shouldn't
// count against its win rate.
const forfeitBonus = computeStats(
	[b('gambler', { won: true }), b('scout', { forfeit: true, won: false })],
	[],
	ME
)
assert(forfeitBonus.bonusGames === 1, 'forfeit: bonus games skip forfeits')
assert(forfeitBonus.bonusesPlayed === 1, 'forfeit: distinct bonuses skip too')
assert(
	forfeitBonus.topWinRate?.id === 'gambler',
	'forfeit: scout never entered the win-rate sample'
)

// --- Canceled games --------------------------------------------------------
// They write no game_results rows at all, so they can only reach stats through
// the games list — which shares History between both endings.

const canceled = computeStats(
	[result()],
	[
		game('a', [ME, 'x']),
		game('b', [ME, 'y'], 'canceled'),
		game('c', [ME, 'x'], 'canceled'),
	],
	ME
)
assert(canceled.distinctOpponents === 1, 'canceled: y never played with')
assert(
	canceled.topOpponents[0]?.userId === 'x' &&
		canceled.topOpponents[0].games === 1,
	"canceled: x's second game does not count"
)

console.log('check-stats: all checks passed')
