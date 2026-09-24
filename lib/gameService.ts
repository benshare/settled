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

// `retriable` says whether resending the identical body could plausibly
// succeed: true for a request that never got a verdict (network down, 5xx),
// false for one the server considered and refused.
export type ServiceResult = {
	error: string | null
	data: ServiceData
	retriable: boolean
}

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
): Promise<ServiceResult> {
	const { data, error } = await supabase.functions.invoke('game-service', {
		body,
	})

	if (error) {
		const detail = await edgeErrorDetail(error)
		return {
			error: detail.message || fallback,
			data: {},
			retriable: detail.retriable,
		}
	}

	const res = (data ?? {}) as ServiceData
	if (!res.ok) {
		// A 200 that says `ok: false` is the server declining on the rules.
		return {
			error: (res.error as string | undefined) || fallback,
			data: res,
			retriable: false,
		}
	}

	const gameId = body.game_id
	if (typeof gameId === 'string') emitGameMutated(gameId)
	return { error: null, data: res, retriable: false }
}

// A FunctionsHttpError carries the raw Response on `context`; its own `message`
// is the same boilerplate for every failure ("non-2xx status code"), so the
// body's `error` is the only thing that says what actually went wrong. Network
// failures have no body — there `message` is all we have, and it's the truth.
//
// `retriable` is that same distinction, which the local action queue needs: a
// response the server actually produced is a decision it will repeat, while no
// response at all is a transport failure worth sending the identical body into
// again. A 5xx is the server falling over rather than judging, so it retries
// too. See `.claude/specs/local-action-queue.md`.
async function edgeErrorDetail(
	error: unknown
): Promise<{ message: string | null; retriable: boolean }> {
	const context = (error as { context?: unknown }).context
	const response = context as Response | undefined
	if (response && typeof response.json === 'function') {
		const retriable =
			typeof response.status === 'number' && response.status >= 500
		try {
			const body = await response.json()
			const message = (body as { error?: unknown })?.error
			if (typeof message === 'string' && message)
				return { message, retriable }
		} catch {
			// Not a JSON body — fall through to the error's own message.
		}
		return { message: (error as Error).message || null, retriable }
	}
	// No response at all: the request never landed.
	return { message: (error as Error).message || null, retriable: true }
}
