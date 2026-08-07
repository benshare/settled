// Pure derivations for the Stats tab. Read-only over the caller's already-loaded
// data — `game_results` rows (useStatsStore) plus the completed games list
// (useGamesStore) — with no I/O of its own. Checked by dev/check-stats.ts.

import { BONUS_POOL, CURSE_POOL, type BonusId } from './catan/bonuses'
import type { GameSize } from './catan/types'
import type { Game } from './stores/useGamesStore'
import type { CardStatRow, GameResult } from './stores/useStatsStore'

// A bonus or curse and how often it hit, alongside the sample it was measured
// over. `rate` is 0-1. Sample size is carried because there is no
// minimum-games filter — a 1-of-1 100% is legitimate, but only if the screen
// says so. `id` is resolved to a card by the screen, which knows which pool it
// asked about.
export type CardRate = {
	id: string
	rate: number
	hits: number
	total: number
}

export type Stats = {
	gamesPlayed: number
	// Games that were actually played to a finish. A game that ended because
	// everyone else forfeited counts toward `gamesPlayed` and the win rate and
	// nothing else — there is no meaningful score or placement in it — so every
	// average below is measured over this smaller sample. The screen says so
	// whenever the two differ.
	playedGames: number
	winRate: number
	wins: number
	avgPoints: number
	avgPlacement: number
	// Full go-arounds: `turns` is a monotonic turn counter, so a game's rounds
	// are its turns divided by its player count.
	avgRounds: number
	avgPlayers: number

	distinctOpponents: number
	// Sorted by games desc, then user id, capped by the caller's `topN`.
	topOpponents: { userId: string; games: number }[]

	// Games where the user actually drew a bonus. Everything below is 0/null
	// when this is 0.
	bonusGames: number
	bonusesPlayed: number
	bonusPoolSize: number
	cursesPlayed: number
	cursePoolSize: number
	// Null when no result carries a multi-card offer of that kind — pick rate
	// only accrues for games played after the offers started being logged, and
	// only where the player had something to choose between.
	topPickRate: CardRate | null
	topCursePickRate: CardRate | null
	topWinRate: CardRate | null
}

const TOP_OPPONENTS = 5

export function computeStats(
	results: GameResult[],
	completeGames: Game[],
	meId: string
): Stats {
	const gamesPlayed = results.length
	const wins = results.filter((r) => r.won).length
	// Everything except games played and win rate is measured over games that
	// were actually played out — see `Stats.playedGames`.
	const played = results.filter((r) => !r.forfeit)

	// A canceled game contributes nothing, and that includes who you sat down
	// with. It writes no `game_results` rows at all, so it can only leak in
	// through the games list, which shares History between both endings.
	// Forfeited games do count here: you played with those people.
	const counted = completeGames.filter((g) => g.status !== 'canceled')

	const opponentCounts = new Map<string, number>()
	for (const g of counted) {
		for (const p of g.participants) {
			if (p === meId) continue
			opponentCounts.set(p, (opponentCounts.get(p) ?? 0) + 1)
		}
	}
	const topOpponents = [...opponentCounts.entries()]
		.map(([userId, games]) => ({ userId, games }))
		.sort((a, b) => b.games - a.games || a.userId.localeCompare(b.userId))
		.slice(0, TOP_OPPONENTS)

	const bonusResults = played.filter((r) => r.bonus !== null)

	return {
		gamesPlayed,
		playedGames: played.length,
		wins,
		winRate: gamesPlayed === 0 ? 0 : wins / gamesPlayed,
		avgPoints: mean(played.map((r) => r.points)),
		avgPlacement: mean(played.map((r) => r.placement)),
		avgRounds: mean(
			played.map((r) =>
				r.player_count > 0 ? r.turns / r.player_count : 0
			)
		),
		avgPlayers: mean(played.map((r) => r.player_count)),

		distinctOpponents: opponentCounts.size,
		topOpponents,

		bonusGames: bonusResults.length,
		bonusesPlayed: distinct(bonusResults.map((r) => r.bonus)),
		bonusPoolSize: BONUS_POOL.length,
		cursesPlayed: distinct(played.map((r) => r.curse)),
		cursePoolSize: CURSE_POOL.length,
		topPickRate: pickRate(
			played,
			(r) => r.offered_bonuses,
			(r) => r.bonus
		),
		topCursePickRate: pickRate(
			played,
			(r) => r.offered_curses,
			(r) => r.curse
		),
		topWinRate: topWinRate(bonusResults),
	}
}

// One bonus or curse's global record over the table sizes the catalog's filter
// has checked. Rates are separated from their samples because there is no
// minimum-games filter — a card played three times is shown, and says so.
export type CardStat = {
	games: number
	// Null when the card has never been played at these sizes: the view records
	// cards that were offered and always declined, and a 0% win rate off zero
	// games is a number the data doesn't contain.
	winRate: number | null
	// Null when every recorded game of this card ended in a forfeit: there is
	// no meaningful score in one, so `pointsGames` is the smaller sample the
	// average is measured over.
	avgPoints: number | null
	pointsGames: number
	// Null when the card has never been part of a real choice — a hand holding
	// a single card isn't a pick, and the view doesn't count one.
	pickRate: number | null
	offers: number
}

export function cardStatKey(kind: 'bonus' | 'curse', id: string): string {
	return `${kind}:${id}`
}

// The view's rows folded down to the sizes the reader has checked, keyed for
// O(1) lookup per catalog cell. A miss means the card has never been played or
// offered at any of them, which the cell renders as its own empty state —
// deliberately distinct from a zeroed entry.
//
// Counts are summed before any division: three sizes' rates averaged together
// would weight a 2-game bucket like a 40-game one.
export function indexCardStats(
	rows: CardStatRow[],
	sizes: GameSize[]
): Map<string, CardStat> {
	const totals = new Map<string, CardStatRow>()
	for (const r of rows) {
		if (!sizes.includes(r.size)) continue
		const key = cardStatKey(r.kind, r.card_id)
		const at = totals.get(key)
		if (!at) {
			totals.set(key, { ...r })
			continue
		}
		at.games += r.games
		at.wins += r.wins
		at.played_games += r.played_games
		at.points_sum += r.points_sum
		at.offers += r.offers
		at.keeps += r.keeps
	}

	const out = new Map<string, CardStat>()
	for (const [key, t] of totals) {
		out.set(key, {
			games: t.games,
			winRate: t.games === 0 ? null : t.wins / t.games,
			avgPoints:
				t.played_games === 0 ? null : t.points_sum / t.played_games,
			pointsGames: t.played_games,
			pickRate: t.offers === 0 ? null : t.keeps / t.offers,
			offers: t.offers,
		})
	}
	return out
}

// Kept / offered, over the results that recorded what they were dealt. Hands
// holding a single card are skipped — a card the player couldn't decline would
// read as 100% picked. A card can't appear twice in one hand (the deal draws
// distinct cards), so each result contributes at most one hit.
function pickRate(
	results: GameResult[],
	offeredOf: (r: GameResult) => string[] | null,
	keptOf: (r: GameResult) => string | null
): CardRate | null {
	const offers = new Map<string, number>()
	const keeps = new Map<string, number>()
	let sampled = 0
	for (const r of results) {
		const offered = offeredOf(r)
		if (!offered || offered.length < 2) continue
		sampled++
		for (const id of offered) offers.set(id, (offers.get(id) ?? 0) + 1)
		const kept = keptOf(r)
		if (kept) keeps.set(kept, (keeps.get(kept) ?? 0) + 1)
	}
	if (sampled === 0) return null
	return best(
		[...offers.entries()].map(([id, total]) => ({
			id,
			total,
			hits: keeps.get(id) ?? 0,
			rate: (keeps.get(id) ?? 0) / total,
		}))
	)
}

// Wins / games, per bonus the user actually played.
function topWinRate(bonusResults: GameResult[]): CardRate | null {
	const games = new Map<BonusId, number>()
	const wins = new Map<BonusId, number>()
	for (const r of bonusResults) {
		const b = r.bonus!
		games.set(b, (games.get(b) ?? 0) + 1)
		if (r.won) wins.set(b, (wins.get(b) ?? 0) + 1)
	}
	return best(
		[...games.entries()].map(([id, total]) => ({
			id,
			total,
			hits: wins.get(id) ?? 0,
			rate: (wins.get(id) ?? 0) / total,
		}))
	)
}

// Highest rate wins; ties go to the bigger sample, then to the id so the
// result is stable across renders.
function best(rates: CardRate[]): CardRate | null {
	let out: CardRate | null = null
	for (const r of rates) {
		if (
			!out ||
			r.rate > out.rate ||
			(r.rate === out.rate &&
				(r.total > out.total ||
					(r.total === out.total && r.id < out.id)))
		) {
			out = r
		}
	}
	return out
}

function distinct(values: (string | null)[]): number {
	return new Set(values.filter((v): v is string => v !== null)).size
}

function mean(values: number[]): number {
	if (values.length === 0) return 0
	return values.reduce((a, b) => a + b, 0) / values.length
}
