import { create } from 'zustand'
import type { ColorId } from '../catan/colors'
import { isTimeoutOption, type TimeoutOption } from '../catan/timeout'
import {
	clampCardCount,
	DEFAULT_CONFIG,
	parseExtraBuild,
	type ExtraBuildConfig,
	type NumberLayout,
	type TradeMode,
} from '../catan/types'
import type { Database } from '../database-types'
import { callGameService } from '../gameService'
import type { NotificationPrefs } from '../notifications'
import { supabase } from '../supabase'
import type { AutoLoadedStore } from './index'

// `deleted` is never present on a row that came from the database — it marks the
// placeholder below, so a renderer can tell a real profile from a gone one
// without matching on the display string.
export type Profile = Database['public']['Tables']['profiles']['Row'] & {
	deleted?: true
}

// A deleted account's profile row is gone, but its uuid survives in
// `games.participants` / `player_order` / `events`, where rewriting it would
// corrupt the seat indices every finished game is scored against. So the stores
// answer a dangling id with this: an ordinary-looking `Profile` that every
// existing `profilesById[uid]?.username ?? 'Player'` site renders correctly.
//
// The display string is unforgeable — `profiles_username_format` (see
// .claude/specs/account-deletion.md) rejects the space and brackets — so nobody
// can register an account that impersonates a deleted one.
export const DELETED_USERNAME = '[deleted user]'

const EPOCH = '1970-01-01T00:00:00.000Z'

export function deletedProfile(id: string): Profile {
	return {
		id,
		username: DELETED_USERNAME,
		avatar_path: null,
		created_at: EPOCH,
		updated_at: EPOCH,
		dev: false,
		game_defaults: null,
		notification_prefs: null,
		spectating: [],
		color_prefs: null,
		deleted: true,
	}
}

// Per-user defaults for the create-game screen. Mirrors the form's visual
// grouping so both sides can compare values directly.
export type GameDefaults = {
	settings: {
		devCards: boolean
		numberLayout: NumberLayout
		honk: boolean
		friendlyRobber: boolean
		limitMonopoly: boolean
		tradeMode: TradeMode
		spectators: boolean
		extraBuild: ExtraBuildConfig
		timeout: TimeoutOption | null
	}
	extras: {
		bonuses: boolean
		bonusSets: string[]
		bannedCombos: boolean
		bonusCount: number
		curseCount: number
	}
}

// Default used before a profile loads, and as a fallback when a row is
// missing the column (shouldn't happen post-migration, but the store stays
// resilient). Dev cards on, bonuses off, spiral numbers — matches the SQL
// default.
export const DEFAULT_GAME_DEFAULTS: GameDefaults = {
	settings: {
		devCards: true,
		numberLayout: 'spiral',
		honk: true,
		friendlyRobber: false,
		limitMonopoly: false,
		tradeMode: 'automatic',
		spectators: true,
		extraBuild: {
			enabled: true,
			buildPhases: 'every',
			moreThanSeven: false,
		},
		timeout: '2d',
	},
	extras: {
		bonuses: false,
		bonusSets: ['1'],
		bannedCombos: true,
		bonusCount: DEFAULT_CONFIG.bonusCount,
		curseCount: DEFAULT_CONFIG.curseCount,
	},
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
			honk:
				typeof settings?.honk === 'boolean'
					? settings.honk
					: DEFAULT_GAME_DEFAULTS.settings.honk,
			friendlyRobber:
				typeof settings?.friendlyRobber === 'boolean'
					? settings.friendlyRobber
					: DEFAULT_GAME_DEFAULTS.settings.friendlyRobber,
			limitMonopoly:
				typeof settings?.limitMonopoly === 'boolean'
					? settings.limitMonopoly
					: DEFAULT_GAME_DEFAULTS.settings.limitMonopoly,
			tradeMode:
				settings?.tradeMode === 'confirm' ||
				settings?.tradeMode === 'automatic'
					? settings.tradeMode
					: DEFAULT_GAME_DEFAULTS.settings.tradeMode,
			spectators:
				typeof settings?.spectators === 'boolean'
					? settings.spectators
					: DEFAULT_GAME_DEFAULTS.settings.spectators,
			extraBuild: parseExtraBuild(
				settings?.extraBuild,
				DEFAULT_GAME_DEFAULTS.settings.extraBuild
			),
			// An explicit null is a saved "no timeout" and is kept; only a
			// missing key falls back, so profiles saved before timeouts
			// shipped pick up the two-day default rather than being pinned
			// to the old one.
			timeout:
				settings?.timeout === null
					? null
					: isTimeoutOption(settings?.timeout)
						? settings.timeout
						: DEFAULT_GAME_DEFAULTS.settings.timeout,
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
			bannedCombos:
				typeof extras?.bannedCombos === 'boolean'
					? extras.bannedCombos
					: DEFAULT_GAME_DEFAULTS.extras.bannedCombos,
			bonusCount: clampCardCount(
				extras?.bonusCount,
				DEFAULT_GAME_DEFAULTS.extras.bonusCount
			),
			curseCount: clampCardCount(
				extras?.curseCount,
				DEFAULT_GAME_DEFAULTS.extras.curseCount
			),
		},
	}
}

const PROFILE_COLS =
	'id, username, avatar_path, created_at, updated_at, dev, game_defaults, notification_prefs, spectating, color_prefs'

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
	// The player's color ranking, best first. `[]` means no preference, which
	// the resolver answers with a random color — it is not shorthand for the
	// default order. Optimistic, like `setSpectating`: the screen is direct
	// manipulation with no Save button, so the write reverts on failure.
	updateColorPrefs: (order: ColorId[]) => Promise<UpdateResult>
	// Games the viewer is actively spectating — the subset of watchable games
	// that get a header tab. Optimistic: the tab appears/disappears at once and
	// the write reverts the array on failure. See `.claude/specs/spectating.md`.
	startSpectating: (gameId: string) => void
	stopSpectating: (gameId: string) => void
	// Drop any recorded id no longer in the watchable set (a game that ended
	// while the app was closed, an unfriended host). Writes only on a change.
	pruneSpectating: (validIds: string[]) => void
	// Permanent, irreversible: cancels every unfinished game the user sits at,
	// deletes the invitations they're a party to, and deletes the auth user
	// (cascading the profile row and everything keyed to it). Touches no local
	// state — the caller tears the whole session down on success. See
	// `.claude/specs/account-deletion.md`.
	deleteAccount: () => Promise<UpdateResult>
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

	async updateColorPrefs(order) {
		const current = get().profile
		if (!current) return { error: 'No profile loaded' }

		const previous = current.color_prefs
		set({ profile: { ...current, color_prefs: order } })

		const { data, error } = await supabase
			.from('profiles')
			.update({ color_prefs: order })
			.eq('id', current.id)
			.select(PROFILE_COLS)
			.single()

		if (error) {
			const latest = get().profile
			// Only roll back if nothing newer has landed in the meantime.
			if (latest && latest.color_prefs === order)
				set({ profile: { ...latest, color_prefs: previous } })
			return { error: error.message || 'Something went wrong' }
		}

		set({ profile: data as Profile })
		return { error: null }
	},

	startSpectating(gameId) {
		const current = get().profile
		if (!current || current.spectating.includes(gameId)) return
		setSpectating(get, set, [...current.spectating, gameId])
	},

	stopSpectating(gameId) {
		const current = get().profile
		if (!current || !current.spectating.includes(gameId)) return
		setSpectating(
			get,
			set,
			current.spectating.filter((id) => id !== gameId)
		)
	},

	pruneSpectating(validIds) {
		const current = get().profile
		if (!current) return
		const valid = new Set(validIds)
		const next = current.spectating.filter((id) => valid.has(id))
		if (next.length === current.spectating.length) return
		setSpectating(get, set, next)
	},

	async deleteAccount() {
		const { error } = await callGameService(
			{ action: 'delete_account' },
			"Couldn't delete your account"
		)
		return { error }
	},
}))

// Optimistically swap in the new `spectating` array, persist it, and roll back
// to the previous value if the write fails. No UI surfaces this, so a revert is
// the only way a failure stays honest.
function setSpectating(
	get: () => ProfileStore,
	set: (partial: Partial<ProfileStore>) => void,
	next: string[]
) {
	const current = get().profile
	if (!current) return
	const previous = current.spectating
	set({ profile: { ...current, spectating: next } })
	void supabase
		.from('profiles')
		.update({ spectating: next })
		.eq('id', current.id)
		.then(({ error }) => {
			if (!error) return
			const latest = get().profile
			// Only roll back if nothing newer has landed in the meantime.
			if (latest && latest.spectating === next)
				set({ profile: { ...latest, spectating: previous } })
		})
}

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
