// Finished-game numbers, in two slices that share a screen (the Stats tab):
//
//   results    — the signed-in user's own summaries, one row per game they
//                played, written by the game-service edge function when a game
//                completes (see .claude/specs/stats.md).
//   cardStats  — global per-bonus/curse counts across everybody's games, read
//                from the `card_stats` view (see
//                .claude/specs/card-global-stats.md).
//
// This store only reads; both are RLS-scoped server-side, the second by being
// an aggregate that exposes no individual row.

import { create } from 'zustand'
import type { BonusId, CurseId } from '../catan/bonuses'
import type { GameSize } from '../catan/types'
import type { Database } from '../database-types'
import { supabase } from '../supabase'
import type { AutoLoadedStore } from './index'

type GameResultRow = Database['public']['Tables']['game_results']['Row']

export type GameResult = Omit<
	GameResultRow,
	'bonus' | 'curse' | 'offered_bonuses' | 'offered_curses'
> & {
	bonus: BonusId | null
	curse: CurseId | null
	offered_bonuses: BonusId[] | null
	offered_curses: CurseId[] | null
}

// One row per (kind, card, table size) that has actually occurred. Every
// column of a view is nullable to Postgres even though none of these can be —
// they're `count(*)`/`coalesce`d aggregates — so the nulls are narrowed away
// here, once, rather than carried through the derivations and the UI.
export type CardStatRow = {
	kind: 'bonus' | 'curse'
	card_id: string
	size: GameSize
	games: number
	wins: number
	played_games: number
	points_sum: number
	offers: number
	keeps: number
}

type StatsStore = {
	// undefined while loading; a failed load settles to [] plus `error` so the
	// screen shows its empty state rather than spinning forever.
	results: GameResult[] | undefined
	cardStats: CardStatRow[] | undefined
	error: string | null
	loadForUser: (userId: string) => Promise<void>
	clear: () => void
}

export const useStatsStore = create<StatsStore>((set) => ({
	results: undefined,
	cardStats: undefined,
	error: null,

	async loadForUser(userId) {
		// Each slice settles its own failure: the user's own history must not
		// vanish because the global aggregate errored, or the reverse.
		const [own, cards] = await Promise.all([
			supabase
				.from('game_results')
				.select('*')
				.eq('user_id', userId)
				.order('completed_at', { ascending: false }),
			supabase.from('card_stats').select('*'),
		])
		set({
			results: (own.data ?? []) as GameResult[],
			cardStats: (cards.data ?? []) as CardStatRow[],
			error: own.error?.message ?? cards.error?.message ?? null,
		})
	},

	clear() {
		set({ results: undefined, cardStats: undefined, error: null })
	},
}))

// No realtime channel: rows only appear when a game completes, and
// `loadAllUserStores` already re-runs on every foreground transition (and on
// the navigation back to the games list that follows a game ending).
export const statsStoreRegistration: AutoLoadedStore = {
	name: 'stats',
	loadForUser: (userId) => useStatsStore.getState().loadForUser(userId),
	clear: () => useStatsStore.getState().clear(),
}
