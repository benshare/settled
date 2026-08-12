// The client half of the `game-service` edge function: one call helper, shared
// by every store that talks to it.
//
// It lives outside the stores because `useProfileStore` needs it too (account
// deletion is a game-service action — see .claude/specs/account-deletion.md) and
// `useGamesStore` already imports `useProfileStore`, so the helper can't live in
// the games store without cycling.

import { emitGameMutated } from './gameSync'
import { supabase } from './supabase'

export type ServiceData = Record<string, unknown>

/**
 * The single entry point for every game-service call.
 *
 * Carries the edge function's own error string back to the caller — supabase-js
 * buries the body of a non-2xx response inside the thrown error, so it has to be
 * read back out — and pings `gameSync` on success so the acting player's board
 * advances without waiting on realtime.
 */
export async function callGameService(
	body: ServiceData,
	fallback: string
): Promise<{ error: string | null; data: ServiceData }> {
	const { data, error } = await supabase.functions.invoke('game-service', {
		body,
	})

	if (error) {
		const message = await edgeErrorMessage(error)
		return { error: message || fallback, data: {} }
	}

	const res = (data ?? {}) as ServiceData
	if (!res.ok) {
		return {
			error: (res.error as string | undefined) || fallback,
			data: res,
		}
	}

	const gameId = body.game_id
	if (typeof gameId === 'string') emitGameMutated(gameId)
	return { error: null, data: res }
}

// A FunctionsHttpError carries the raw Response on `context`; its own `message`
// is the same boilerplate for every failure ("non-2xx status code"), so the
// body's `error` is the only thing that says what actually went wrong. Network
// failures have no body — there `message` is all we have, and it's the truth.
async function edgeErrorMessage(error: unknown): Promise<string | null> {
	const context = (error as { context?: unknown }).context
	if (context && typeof (context as Response).json === 'function') {
		try {
			const body = await (context as Response).json()
			const message = (body as { error?: unknown })?.error
			if (typeof message === 'string' && message) return message
		} catch {
			// Not a JSON body — fall through to the error's own message.
		}
	}
	return (error as Error).message || null
}
