import { create } from 'zustand'
import type { Database } from '../database-types'
import { supabase } from '../supabase'
import type { AutoLoadedStore } from './index'

export type Profile = Database['public']['Tables']['profiles']['Row']

// Per-user defaults for the create-game screen. Mirrors the form's visual
// grouping so both sides can compare values directly.
export type GameDefaults = {
	settings: { devCards: boolean }
	extras: { bonuses: boolean }
}

// Default used before a profile loads, and as a fallback when a row is
// missing the column (shouldn't happen post-migration, but the store stays
// resilient). Dev cards on, bonuses off — matches the SQL default.
export const DEFAULT_GAME_DEFAULTS: GameDefaults = {
	settings: { devCards: true },
	extras: { bonuses: false },
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
		},
		extras: {
			bonuses:
				typeof extras?.bonuses === 'boolean'
					? extras.bonuses
					: DEFAULT_GAME_DEFAULTS.extras.bonuses,
		},
	}
}

const PROFILE_COLS =
	'id, username, avatar_path, created_at, updated_at, dev, game_defaults'

type UpdateResult = { error: string | null }

type ProfileStore = {
	profile: Profile | null
	loading: boolean
	loadProfile: (userId: string) => Promise<Profile | null>
	clearProfile: () => void
	updateUsername: (username: string) => Promise<UpdateResult>
	updateAvatarPath: (path: string | null) => Promise<UpdateResult>
	updateGameDefaults: (defaults: GameDefaults) => Promise<UpdateResult>
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
			return { error: 'Something went wrong' }
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
