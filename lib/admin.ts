// Admin impersonation — "act as" any player from the user search, then hand the
// session back. Local development only: both switches below come from `.env` via
// `app.config.js` extra, and `.env` is never loaded by an EAS build or by
// `eas update --environment production`, so a shipped bundle has neither.
//
// The session is minted by the `dev-login` edge function through a magic link
// (see its header), so impersonating a player never touches their password and
// never signs them out on their own devices. The real account's tokens are
// stashed on the way in and restored on the way out; they're persisted rather
// than held in memory so a reload mid-impersonation can still get back.

import Constants from 'expo-constants'
import { router } from 'expo-router'
import { create } from 'zustand'
import { clearAllUserStores } from './stores'
import { authStorage, supabase } from './supabase'

const DEV_LOGIN_KEY = Constants.expoConfig?.extra?.devLoginKey as
	string | undefined

// Both halves are required: the flag is the intent, the key is what actually
// lets the endpoint answer. Without either, none of this UI renders.
export const IS_ADMIN =
	Constants.expoConfig?.extra?.admin === true && !!DEV_LOGIN_KEY

const STORAGE_KEY = 'admin.impersonation'

type StoredImpersonation = {
	userId: string
	username: string
	// The admin's own session, captured at the moment of the first switch.
	original: { access_token: string; refresh_token: string }
}

type AdminStore = {
	// Non-null while impersonating. Drives the banner in the root layout, and
	// gates side effects that must keep belonging to the real account (push
	// registration in `app/(app)/_layout.tsx`).
	actingAs: { userId: string; username: string } | null
	busy: boolean
	error: string | null
	// False until `restore` has answered. Anything that must not run under a
	// borrowed session has to wait for it, since `actingAs` is null until the
	// persisted record has been read back.
	restored: boolean
	actAs: (player: { id: string; username: string }) => Promise<void>
	stopActing: () => Promise<void>
	// Re-reads the persisted record on boot so a reload doesn't lose the way
	// back. Drops it if the stored id no longer matches the live session.
	restore: () => Promise<void>
}

export const useAdminStore = create<AdminStore>((set, get) => ({
	actingAs: null,
	busy: false,
	error: null,
	restored: false,

	async actAs(player) {
		if (!IS_ADMIN || get().busy) return
		set({ busy: true, error: null })

		const stored = await readStored()
		// Acting as B while already acting as A keeps A's tokens out of it —
		// the way back is always to the real account.
		let original = stored?.original
		if (!original) {
			const { data } = await supabase.auth.getSession()
			if (!data.session) {
				set({ busy: false, error: 'Not signed in.' })
				return
			}
			original = {
				access_token: data.session.access_token,
				refresh_token: data.session.refresh_token,
			}
		}

		const { data, error } = await supabase.functions.invoke('dev-login', {
			headers: { 'x-dev-key': DEV_LOGIN_KEY ?? '' },
			body: { player: player.id },
		})
		if (error || !data?.token_hash) {
			set({
				busy: false,
				error:
					(await readFunctionError(error)) ??
					error?.message ??
					'act-as failed',
			})
			return
		}

		// Persist before switching: a crash between the two would otherwise
		// leave a session with no recorded way back.
		await writeStored({
			userId: player.id,
			username: player.username,
			original,
		})

		const { error: switchError } = await applyTokenHash(data.token_hash)
		if (switchError) {
			await clearStored()
			set({ busy: false, error: switchError })
			return
		}

		set({
			busy: false,
			actingAs: { userId: player.id, username: player.username },
		})
		router.replace('/(app)/games')
	},

	async stopActing() {
		if (get().busy) return
		set({ busy: true, error: null })

		const stored = await readStored()
		if (!stored) {
			set({ busy: false, actingAs: null })
			return
		}

		const { error } = await applySession(
			stored.original.access_token,
			stored.original.refresh_token
		)
		if (error) {
			// The stored tokens are the only way back, so a failure here is
			// terminal for this session — say so rather than silently stranding
			// the app on the impersonated account.
			set({
				busy: false,
				error: `${error} — sign out and back in to recover.`,
			})
			return
		}

		await clearStored()
		set({ busy: false, actingAs: null })
		router.replace('/(app)/games')
	},

	async restore() {
		if (!IS_ADMIN) {
			set({ restored: true })
			return
		}
		const stored = await readStored()
		const { data } = stored
			? await supabase.auth.getSession()
			: { data: { session: null } }
		// A sign-out (or a sign-in as someone else) while impersonating leaves
		// a record pointing at a session that no longer exists.
		if (stored && data.session?.user.id === stored.userId) {
			set({
				actingAs: { userId: stored.userId, username: stored.username },
				restored: true,
			})
			return
		}
		if (stored) await clearStored()
		set({ restored: true })
	},
}))

// Both account switches drop the outgoing account's data first; the root
// layout's `user?.id` effect reloads the stores for whoever we land on, so
// neither loads anything itself. The push token is left alone — it belongs to
// the device's real account, and re-pointing it would send that person's
// notifications somewhere else.

// Into an impersonated account: redeem the one-time magic-link token minted by
// `dev-login`. No password is involved, so the target's own sessions elsewhere
// are untouched.
async function applyTokenHash(tokenHash: string) {
	clearAllUserStores()
	const { data, error } = await supabase.auth.verifyOtp({
		token_hash: tokenHash,
		type: 'magiclink',
	})
	if (error || !data.session) {
		return { error: error?.message ?? 'session could not be set' }
	}
	return { error: null }
}

// Back to the real account: its tokens were captured at the first switch and
// are still valid, since nothing above ever touched them.
async function applySession(accessToken: string, refreshToken: string) {
	clearAllUserStores()
	const { data, error } = await supabase.auth.setSession({
		access_token: accessToken,
		refresh_token: refreshToken,
	})
	if (error || !data.session) {
		return { error: error?.message ?? 'session could not be set' }
	}
	return { error: null }
}

async function readStored(): Promise<StoredImpersonation | null> {
	const raw = await authStorage.getItem(STORAGE_KEY)
	if (!raw) return null
	try {
		return JSON.parse(raw) as StoredImpersonation
	} catch {
		return null
	}
}

async function writeStored(record: StoredImpersonation) {
	await authStorage.setItem(STORAGE_KEY, JSON.stringify(record))
}

async function clearStored() {
	await authStorage.removeItem(STORAGE_KEY)
}

// supabase-js buries the function's `{ ok: false, error }` body inside the
// thrown error's Response; without this every failure reads "Edge Function
// returned a non-2xx status code".
async function readFunctionError(error: unknown): Promise<string | null> {
	const response = (error as { context?: Response } | null)?.context
	if (!(response instanceof Response)) return null
	try {
		const body = await response.json()
		return typeof body?.error === 'string' ? body.error : null
	} catch {
		return null
	}
}
