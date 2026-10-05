// Per-game lease lock. Every game-service handler is load → compute → write
// whole columns, so two concurrent actions on one game would silently undo
// each other. Rather than guard each write, the entry points (`serve` and the
// timeout sweep) run the whole action under a lease — never `dispatch`
// itself, which the sweep calls while already holding it. Backed by
// `game_locks` + the acquire/release RPCs. See
// `.claude/specs/avarice-voluntary-discard.md`.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }

// Long enough for any action; short enough that a crashed invocation frees
// the game on its own.
const DEFAULT_TTL_MS = 10_000

export type GameLockOptions = {
	// How long to keep retrying while someone else holds the game. 0 = one try.
	waitMs: number
	ttlMs?: number
}

// Runs `run` under the game's lease. `after` is backgrounded work that still
// needs the lease but nothing is waiting on (it runs in `waitUntil`, and the
// lease is released once it finishes) — so the caller's response isn't held
// up by it. `{ locked: false }` means the game stayed held past `waitMs`.
export async function withGameLock<T>(
	admin: SupabaseClient,
	gameId: string,
	opts: GameLockOptions,
	run: () => Promise<T>,
	after?: (result: T) => Promise<void>
): Promise<{ locked: true; result: T } | { locked: false }> {
	const token = await acquire(admin, gameId, opts)
	if (!token) return { locked: false }

	let result: T
	try {
		result = await run()
	} catch (e) {
		await release(admin, gameId, token)
		throw e
	}
	if (!after) {
		await release(admin, gameId, token)
		return { locked: true, result }
	}
	EdgeRuntime.waitUntil(
		after(result)
			.catch((e) => console.error('[lock] after failed', gameId, e))
			.finally(() => release(admin, gameId, token))
	)
	return { locked: true, result }
}

async function acquire(
	admin: SupabaseClient,
	gameId: string,
	{ waitMs, ttlMs = DEFAULT_TTL_MS }: GameLockOptions
): Promise<string | null> {
	const token = crypto.randomUUID()
	const giveUpAt = Date.now() + waitMs
	for (let delay = 25; ; delay = Math.min(delay * 2, 250)) {
		const { data, error } = await admin.rpc('acquire_game_lock', {
			p_game_id: gameId,
			p_token: token,
			p_ttl_ms: ttlMs,
		})
		if (error) {
			console.error('[lock] acquire failed', gameId, error.message)
			return null
		}
		if (data === true) return token
		if (Date.now() + delay > giveUpAt) return null
		await new Promise((r) => setTimeout(r, delay))
	}
}

async function release(
	admin: SupabaseClient,
	gameId: string,
	token: string
): Promise<void> {
	const { error } = await admin.rpc('release_game_lock', {
		p_game_id: gameId,
		p_token: token,
	})
	// Not fatal: the lease expires on its own.
	if (error) console.error('[lock] release failed', gameId, error.message)
}
