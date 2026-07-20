// Shared push fan-out helper. Imported by edge functions (game-service,
// friends-service) and run inside EdgeRuntime.waitUntil so failures never
// bubble back to the caller. The `_` prefix keeps Supabase from deploying
// this directory as its own function.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

export type NotificationPrefKey =
	'gameInvite' | 'yourTurn' | 'trade' | 'friendRequest' | 'chatMessage'

export type NotificationKind =
	| 'game_invite'
	| 'game_started'
	| 'your_turn'
	| 'discard_required'
	| 'trade_proposed'
	| 'trade_accepted'
	| 'trade_rejected_all'
	| 'friend_request'
	| 'honk'
	| 'chat_message'

// A chat message body is arbitrary user text and can run to the column's 500
// chars. Ship a bounded preview rather than letting the OS clip at an arbitrary
// point.
const MAX_BODY_CHARS = 150

export type NotifyTarget = {
	userId: string
	kind: NotificationKind
	// Omit to send ungated — the honk is deliberately un-mutable, so it has no
	// corresponding pref key rather than borrowing an unrelated one.
	gate?: NotificationPrefKey
	senderProfileId?: string // fills in <sender>/<proposer> body copy
	gameId?: string // included in the deep-link payload
	firstPlayer?: boolean // game_started copy variant for player_order[0]
	// Chat puts the sender's name in the title and their message in the body,
	// where every other kind is titled 'Settled' with generated copy. Opting in
	// by flag rather than passing a title string keeps the username lookup here
	// — callers would otherwise have to re-resolve a name this module already
	// has.
	titleFrom?: 'app' | 'sender'
	bodyOverride?: string
}

type ExpoMessage = {
	to: string
	title?: string
	body?: string
	data?: Record<string, unknown>
	sound?: 'default' | null
	priority?: 'default' | 'normal' | 'high'
}

/**
 * Resolves preferences + tokens, builds Expo Push messages, posts them in one
 * request. Errors are logged but never thrown — push delivery is
 * fire-and-forget by design.
 */
export async function sendNotifications(
	admin: SupabaseClient,
	targets: NotifyTarget[]
): Promise<void> {
	if (targets.length === 0) return

	const userIds = Array.from(new Set(targets.map((t) => t.userId)))
	const senderIds = Array.from(
		new Set(
			targets
				.map((t) => t.senderProfileId)
				.filter((id): id is string => typeof id === 'string')
		)
	)

	const [profilesRes, tokensRes, namesRes] = await Promise.all([
		admin
			.from('profiles')
			.select('id, notification_prefs')
			.in('id', userIds),
		admin
			.from('push_tokens')
			.select('user_id, token')
			.in('user_id', userIds),
		senderIds.length > 0
			? admin.from('profiles').select('id, username').in('id', senderIds)
			: Promise.resolve({ data: [], error: null }),
	])

	if (profilesRes.error || tokensRes.error) {
		console.warn('[notify] load failed', profilesRes.error, tokensRes.error)
		return
	}

	const prefsById = new Map<string, Record<string, unknown>>()
	for (const row of profilesRes.data ?? []) {
		prefsById.set(
			row.id,
			(row.notification_prefs as Record<string, unknown>) ?? {}
		)
	}

	const tokensByUser = new Map<string, string[]>()
	for (const row of tokensRes.data ?? []) {
		const arr = tokensByUser.get(row.user_id) ?? []
		arr.push(row.token)
		tokensByUser.set(row.user_id, arr)
	}

	const usernameById = new Map<string, string>()
	for (const row of (namesRes.data ?? []) as {
		id: string
		username: string
	}[]) {
		usernameById.set(row.id, row.username)
	}

	const messages: ExpoMessage[] = []
	for (const t of targets) {
		const prefs = prefsById.get(t.userId) ?? {}
		// Default-on: only skip if the user explicitly turned it off. A target
		// with no gate is ungated and always sends.
		if (t.gate && prefs[t.gate] === false) continue
		const tokens = tokensByUser.get(t.userId)
		if (!tokens || tokens.length === 0) continue
		const senderName = t.senderProfileId
			? (usernameById.get(t.senderProfileId) ?? 'Someone')
			: undefined
		// A deleted or unreadable profile must not produce a notification
		// titled `undefined`.
		const title =
			t.titleFrom === 'sender' ? (senderName ?? 'Settled') : 'Settled'
		const body = truncate(t.bodyOverride ?? renderBody(t, senderName))
		const data: Record<string, unknown> = { kind: t.kind }
		if (t.gameId) data.game_id = t.gameId
		for (const token of tokens) {
			messages.push({
				to: token,
				title,
				body,
				data,
				priority: 'high',
			})
		}
	}

	if (messages.length === 0) return

	try {
		await fetch(EXPO_PUSH_URL, {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Accept-Encoding': 'gzip, deflate',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(messages),
		})
	} catch (e) {
		console.warn('[notify] push send failed', e)
	}
}

function renderBody(t: NotifyTarget, sender: string | undefined): string {
	switch (t.kind) {
		case 'game_invite':
			return `${sender ?? 'Someone'} invited you to a game.`
		case 'game_started':
			return t.firstPlayer
				? "Game starting — you're up first."
				: 'Game starting.'
		case 'your_turn':
			return "It's your turn."
		case 'discard_required':
			return 'You rolled a 7 — discard cards.'
		case 'trade_proposed':
			return `${sender ?? 'Someone'} proposed a trade.`
		case 'trade_accepted':
			return `${sender ?? 'Someone'} accepted your trade.`
		// Collective outcome — naming one of the N rejecters would be arbitrary.
		case 'trade_rejected_all':
			return 'Your trade was turned down.'
		case 'friend_request':
			return `${sender ?? 'Someone'} sent you a friend request.`
		case 'honk':
			return `HONK. It's your turn. (Sent by ${sender ?? 'someone'})`
		// Unreachable in practice — chat always passes bodyOverride — but the
		// switch is exhaustive over NotificationKind.
		case 'chat_message':
			return 'Sent you a message.'
	}
}

function truncate(body: string): string {
	if (body.length <= MAX_BODY_CHARS) return body
	return `${body.slice(0, MAX_BODY_CHARS - 1).trimEnd()}…`
}
