import { create } from 'zustand'
import {
	EXTRA_BUILD_TIMES,
	type ExtraBuildTimes,
	type NumberLayout,
} from '../catan/types'
import type { Database } from '../database-types'
import type { NotificationPrefs } from '../notifications'
import { supabase } from '../supabase'
import type { AutoLoadedStore } from './index'

export type Profile = Database['public']['Tables']['profiles']['Row']

// Per-user defaults for the create-game screen. Mirrors the form's visual
// grouping so both sides can compare values directly.
export type GameDefaults = {
	settings: {
		devCards: boolean
		numberLayout: NumberLayout
		extraBuildTimes: ExtraBuildTimes
	}
	extras: { bonuses: boolean; bonusSets: string[] }
}

// Default used before a profile loads, and as a fallback when a row is
// missing the column (shouldn't happen post-migration, but the store stays
// resilient). Dev cards on, bonuses off, spiral numbers — matches the SQL
// default.
export const DEFAULT_GAME_DEFAULTS: GameDefaults = {
	settings: {
		devCards: true,
		numberLayout: 'spiral',
		extraBuildTimes: 'every-turn',
	},
	extras: { bonuses: false, bonusSets: ['1'] },
}

// Narrow the JSONB blob to GameDefaults. Silently falls back on shape drift.
export function parseGameDefaults(raw: unknown): GameDefaults {
	if (!raw || typeof raw !== 'object') return DEFAULT_GAME_DEFAULTS
	const src = raw as Record<string, unknown>
	const settings = src.settings as Record<string, unknown> | undefined
	const extras = src.extras as Record<string, unknown> | undefined
	return {
		settings: {
			devCards:
				typeof settings?.devCards === 'boolean'
					? settings.devCards
					: DEFAULT_GAME_DEFAULTS.settings.devCards,
			numberLayout:
				settings?.numberLayout === 'spiral' ||
				settings?.numberLayout === 'random'
					? settings.numberLayout
					: DEFAULT_GAME_DEFAULTS.settings.numberLayout,
			extraBuildTimes: EXTRA_BUILD_TIMES.includes(
				settings?.extraBuildTimes as ExtraBuildTimes
			)
				? (settings!.extraBuildTimes as ExtraBuildTimes)
				: DEFAULT_GAME_DEFAULTS.settings.extraBuildTimes,
		},
		extras: {
			bonuses:
				typeof extras?.bonuses === 'boolean'
					? extras.bonuses
					: DEFAULT_GAME_DEFAULTS.extras.bonuses,
			bonusSets:
				Array.isArray(extras?.bonusSets) &&
				extras.bonusSets.every((s) => typeof s === 'string')
					? (extras.bonusSets as string[])
					: DEFAULT_GAME_DEFAULTS.extras.bonusSets,
		},
	}
}

const PROFILE_COLS =
	'id, username, avatar_path, created_at, updated_at, dev, game_defaults, notification_prefs'

type UpdateResult = { error: string | null }

type ProfileStore = {
	profile: Profile | null
	loading: boolean
	loadProfile: (userId: string) => Promise<Profile | null>
	clearProfile: () => void
	updateUsername: (username: string) => Promise<UpdateResult>
	updateAvatarPath: (path: string | null) => Promise<UpdateResult>
	updateGameDefaults: (defaults: GameDefaults) => Promise<UpdateResult>
	updateNotificationPrefs: (prefs: NotificationPrefs) => Promise<UpdateResult>
}

export const useProfileStore = create<ProfileStore>((set, get) => ({
	profile: null,
	loading: false,

	async loadProfile(userId) {
		set({ loading: true })
		const { data, error } = await supabase
			.from('profiles')
			.select(PROFILE_COLS)
			.eq('id', userId)
			.maybeSingle()
		set({ loading: false })

		if (error || !data) {
			set({ profile: null })
			return null
		}

		const profile = data as Profile
		set({ profile })
		return profile
	},

	clearProfile() {
		set({ profile: null })
	},

	async updateUsername(username) {
		const current = get().profile
		if (!current) return { error: 'No profile loaded' }

		const { data, error } = await supabase
			.from('profiles')
			.update({ username })
			.eq('id', current.id)
			.select(PROFILE_COLS)
			.single()

		if (error) {
			if (error.code === '23505') {
				return { error: 'Username already taken' }
			}
			return { error: 'Something went wrong' }
		}

		set({ profile: data as Profile })
		return { error: null }
	},

	async updateAvatarPath(path) {
		const current = get().profile
		if (!current) return { error: 'No profile loaded' }

		const { data, error } = await supabase
			.from('profiles')
			.update({ avatar_path: path })
			.eq('id', current.id)
			.select(PROFILE_COLS)
			.single()

		if (error) {
			return { error: 'Something went wrong' }
		}

		set({ profile: data as Profile })
		return { error: null }
	},

	async updateGameDefaults(defaults) {
		const current = get().profile
		if (!current) return { error: 'No profile loaded' }

		const { data, error } = await supabase
			.from('profiles')
			.update({ game_defaults: defaults })
			.eq('id', current.id)
			.select(PROFILE_COLS)
			.single()

		if (error) {
			return { error: error.message || 'Something went wrong' }
		}

		set({ profile: data as Profile })
		return { error: null }
	},

	async updateNotificationPrefs(prefs) {
		const current = get().profile
		if (!current) return { error: 'No profile loaded' }

		const { data, error } = await supabase
			.from('profiles')
			.update({ notification_prefs: prefs })
			.eq('id', current.id)
			.select(PROFILE_COLS)
			.single()

		if (error) {
			return { error: error.message || 'Something went wrong' }
		}

		set({ profile: data as Profile })
		return { error: null }
	},
}))

// Auto-load registration. Inside `(app)` the profile is loaded on mount and
// cleared on sign-out. Pre-(app) routes (login/verify/set-username) still
// call `loadProfile` directly because they need to await completion.
export const profileStoreRegistration: AutoLoadedStore = {
	name: 'profile',
	loadForUser: async (userId) => {
		await useProfileStore.getState().loadProfile(userId)
	},
	clear: () => useProfileStore.getState().clearProfile(),
}
