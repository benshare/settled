// Pure derivations for the Stats tab. Read-only over the caller's already-loaded
// data — `game_results` rows (useStatsStore) plus the completed games list
// (useGamesStore) — with no I/O of its own. Checked by dev/check-stats.ts.

import { BONUS_POOL, CURSE_POOL, type BonusId } from './catan/bonuses'
import type { Game } from './stores/useGamesStore'
import type { GameResult } from './stores/useStatsStore'

// A bonus and how often it hit, alongside the sample it was measured over.
// `rate` is 0-1. Sample size is carried because there is no minimum-games
// filter — a 1-of-1 100% is legitimate, but only if the screen says so.
export type BonusRate = {
	bonus: BonusId
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
	// Null when no result carries `offered_bonuses` — pick rate only accrues
	// for games played after the offers started being logged.
	topPickRate: BonusRate | null
	topWinRate: BonusRate | null
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
		topPickRate: topPickRate(played),
		topWinRate: topWinRate(bonusResults),
	}
}

// Kept / offered, over the results that recorded their offered pair. A bonus
// offered twice in one hand can't happen (the pool draws distinct pairs), so
// each result contributes at most one hit.
function topPickRate(results: GameResult[]): BonusRate | null {
	const offers = new Map<BonusId, number>()
	const keeps = new Map<BonusId, number>()
	let sampled = 0
	for (const r of results) {
		if (!r.offered_bonuses || r.offered_bonuses.length === 0) continue
		sampled++
		for (const b of r.offered_bonuses) {
			offers.set(b, (offers.get(b) ?? 0) + 1)
		}
		if (r.bonus) keeps.set(r.bonus, (keeps.get(r.bonus) ?? 0) + 1)
	}
	if (sampled === 0) return null
	return best(
		[...offers.entries()].map(([bonus, total]) => ({
			bonus,
			total,
			hits: keeps.get(bonus) ?? 0,
			rate: (keeps.get(bonus) ?? 0) / total,
		}))
	)
}

// Wins / games, per bonus the user actually played.
function topWinRate(bonusResults: GameResult[]): BonusRate | null {
	const games = new Map<BonusId, number>()
	const wins = new Map<BonusId, number>()
	for (const r of bonusResults) {
		const b = r.bonus!
		games.set(b, (games.get(b) ?? 0) + 1)
		if (r.won) wins.set(b, (wins.get(b) ?? 0) + 1)
	}
	return best(
		[...games.entries()].map(([bonus, total]) => ({
			bonus,
			total,
			hits: wins.get(bonus) ?? 0,
			rate: (wins.get(bonus) ?? 0) / total,
		}))
	)
}

// Highest rate wins; ties go to the bigger sample, then to the id so the
// result is stable across renders.
function best(rates: BonusRate[]): BonusRate | null {
	let out: BonusRate | null = null
	for (const r of rates) {
		if (
			!out ||
			r.rate > out.rate ||
			(r.rate === out.rate &&
				(r.total > out.total ||
					(r.total === out.total && r.bonus < out.bonus)))
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
