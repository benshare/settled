// The signed-in user's finished-game summaries, one row per game they played.
// Written by the game-service edge function when a game completes (see
// .claude/specs/stats.md) — this store only reads them.

import { create } from 'zustand'
import type { BonusId, CurseId } from '../catan/bonuses'
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

type StatsStore = {
	// undefined while loading; a failed load settles to [] plus `error` so the
	// screen shows its empty state rather than spinning forever.
	results: GameResult[] | undefined
	error: string | null
	loadForUser: (userId: string) => Promise<void>
	clear: () => void
}

export const useStatsStore = create<StatsStore>((set) => ({
	results: undefined,
	error: null,

	async loadForUser(userId) {
		const { data, error } = await supabase
			.from('game_results')
			.select('*')
			.eq('user_id', userId)
			.order('completed_at', { ascending: false })
		if (error) {
			set({ results: [], error: error.message })
			return
		}
		set({ results: (data ?? []) as GameResult[], error: null })
	},

	clear() {
		set({ results: undefined, error: null })
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
