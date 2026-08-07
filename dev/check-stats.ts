// Runtime checks for lib/stats.ts. Run with `npx tsx dev/check-stats.ts`.
// Exits 0 on success; throws with a specific message on the first failure.

import type { BonusId, CurseId } from '../lib/catan/bonuses'
import type { GameSize } from '../lib/catan/types'
import { cardStatKey, computeStats, indexCardStats } from '../lib/stats'
import type { Game } from '../lib/stores/useGamesStore'
import type { CardStatRow, GameResult } from '../lib/stores/useStatsStore'

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

// --- Global card stats -----------------------------------------------------
// The counting happens in SQL (the `card_stats` view); what's checked here is
// the arithmetic on top of it, and that a missing combination stays missing
// rather than reading as a zeroed one.

const cardRow = (over: Partial<CardStatRow> = {}): CardStatRow => ({
	kind: 'bonus',
	card_id: 'gambler',
	size: 'standard',
	games: 10,
	wins: 4,
	played_games: 8,
	points_sum: 72,
	offers: 20,
	keeps: 5,
	...over,
})

const ALL: GameSize[] = ['small', 'standard', 'expanded']

assert(indexCardStats([], ALL).size === 0, 'cards: empty in, empty out')

const ROWS: CardStatRow[] = [
	cardRow(),
	// Same card at another size: folded into the same entry when both sizes
	// are checked, dropped entirely when neither is.
	cardRow({
		size: 'small',
		games: 2,
		wins: 2,
		played_games: 2,
		points_sum: 18,
		offers: 4,
		keeps: 1,
	}),
	// Played, never offered a choice — every hand held a single card.
	cardRow({ card_id: 'scout', offers: 0, keeps: 0 }),
	// Offered plenty, never kept.
	cardRow({ card_id: 'haunt', offers: 12, keeps: 0 }),
	// Offered and always declined: the view's full join emits this, and there
	// is no win rate in zero games.
	cardRow({
		card_id: 'forger',
		games: 0,
		wins: 0,
		played_games: 0,
		points_sum: 0,
		offers: 4,
		keeps: 0,
	}),
	// Every game of it ended in a forfeit: no score to average.
	cardRow({
		card_id: 'ritualist',
		games: 3,
		wins: 1,
		played_games: 0,
		points_sum: 0,
	}),
	// Curses share the shape and the key namespace.
	cardRow({ kind: 'curse', card_id: 'avarice', games: 6, wins: 1 }),
]

const cards = indexCardStats(ROWS, ALL)

const gambler = cards.get(cardStatKey('bonus', 'gambler'))
assert(gambler, 'cards: gambler indexed')
// 4+2 wins over 10+2 games, 72+18 points over 8+2 played: counts are summed
// before the division. Averaging the two sizes' rates would read 0.7 instead.
close(gambler.winRate!, 0.5, 'cards: sizes summed before dividing')
close(gambler.avgPoints!, 9, 'cards: avg points over played games only')
close(gambler.pickRate!, 0.25, 'cards: pick rate is keeps / offers')
assert(gambler.games === 12 && gambler.offers === 24, 'cards: samples summed')

// One size checked reads exactly as its own row.
const only = indexCardStats(ROWS, ['standard'])
close(
	only.get(cardStatKey('bonus', 'gambler'))!.winRate!,
	0.4,
	'cards: a single checked size is that size alone'
)
const smallOnly = indexCardStats(ROWS, ['small'])
close(
	smallOnly.get(cardStatKey('bonus', 'gambler'))!.winRate!,
	1,
	'cards: the other size, on its own'
)
assert(
	smallOnly.get(cardStatKey('bonus', 'scout')) === undefined,
	'cards: a card absent from every checked size is a miss, not a zero'
)
assert(
	indexCardStats(ROWS, ['expanded']).size === 0,
	'cards: a size nothing was played at indexes nothing'
)

assert(
	cards.get(cardStatKey('curse', 'gambler')) === undefined,
	'cards: kind is part of the key'
)
assert(
	cards.get(cardStatKey('bonus', 'scout'))!.pickRate === null,
	'cards: no offers means no pick rate'
)
close(
	cards.get(cardStatKey('bonus', 'haunt'))!.pickRate!,
	0,
	'cards: offered but never kept is 0%, not null'
)
assert(
	cards.get(cardStatKey('bonus', 'forger'))!.winRate === null,
	'cards: offered but never played has no win rate, not 0%'
)
close(
	cards.get(cardStatKey('bonus', 'forger'))!.pickRate!,
	0,
	'cards: an offer-only card still has a pick rate'
)
assert(
	cards.get(cardStatKey('bonus', 'ritualist'))!.avgPoints === null,
	'cards: an all-forfeit card has no average'
)
close(
	cards.get(cardStatKey('bonus', 'ritualist'))!.winRate!,
	1 / 3,
	'cards: a forfeit still counts toward the win rate'
)
close(
	cards.get(cardStatKey('curse', 'avarice'))!.winRate!,
	1 / 6,
	'cards: curses are indexed the same way'
)

console.log('check-stats: all checks passed')
