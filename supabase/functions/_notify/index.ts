// Shared push fan-out helper. Imported by edge functions (game-service,
// friends-service) and run inside EdgeRuntime.waitUntil so failures never
// bubble back to the caller. The `_` prefix keeps Supabase from deploying
// this directory as its own function.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { pendingUserIds, type PendingPhase } from '../_shared/phase.ts'

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
	| 'trade_accept_offered'
	| 'trade_confirmed'
	| 'trade_rejected_all'
	| 'friend_request'
	| 'honk'
	| 'chat_message'
	// Forfeiting / ending. All four are ungated, like the honk: they are rare
	// and consequential enough not to earn a preference toggle.
	| 'game_forfeited'
	| 'end_game_proposed'
	| 'game_canceled'
	| 'game_won_by_forfeit'
	// Move timeouts. Ungated for the same reason: rare, and about to change the
	// game without you. The warning ships a `bodyOverride` because its lead
	// time varies (an hour, then ten minutes).
	| 'turn_timeout_warning'
	| 'turn_timed_out'

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
	// Ditto, for game_invite — there is no game to link to yet, only the
	// `game_requests` row the invite screen is keyed on.
	requestId?: string
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
	// iOS app-icon badge. Not a notification count — see `badgeCounts`.
	badge?: number
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

	const [profilesRes, tokensRes, namesRes, badges] = await Promise.all([
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
		badgeCounts(admin, userIds),
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
		// Consumed by `resolveNotificationLink` in lib/notifications/links.ts,
		// which declares the twin of the `NotificationKind` union above.
		const data: Record<string, unknown> = { kind: t.kind }
		if (t.gameId) data.game_id = t.gameId
		if (t.requestId) data.request_id = t.requestId
		for (const token of tokens) {
			messages.push({
				to: token,
				title,
				body,
				data,
				priority: 'high',
				badge: badges.get(t.userId),
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

/**
 * The app-icon badge is "in-progress games waiting on you", not "unread
 * notifications" — the count behind the Games list's per-row dot (`isMyTurn` in
 * `lib/stores/useGamesStore.ts`, mirrored here). It rides *every* push, whatever
 * the kind, so a chat message or a friend request also corrects a badge that
 * drifted while the app was closed.
 *
 * Safe to read here: every caller runs this after its write has committed, so
 * the phase and turn already describe the state the push is about. A user with
 * no matching games gets an explicit 0, which is what clears the icon.
 *
 * Failure returns an empty map rather than throwing — the badge is decoration
 * and the notification itself is the point.
 */
async function badgeCounts(
	admin: SupabaseClient,
	userIds: string[]
): Promise<Map<string, number>> {
	const counts = new Map<string, number>()
	for (const id of userIds) counts.set(id, 0)

	// Both halves of the answer live on the state row: the phase, and the turn
	// pointer it can override. The pointer alone can't answer the question —
	// null through bonus selection, the wrong seat during special build, one
	// seat where a parallel phase is waiting on several. PostgREST returns only
	// the two named columns from the joined row, so this stays small.
	const { data, error } = await admin
		.from('games')
		.select('player_order, game_states(phase, current_turn)')
		.in('status', ['placement', 'active'])
		.overlaps('participants', userIds)

	if (error) {
		console.warn('[notify] badge count failed', error)
		return new Map()
	}

	type Embed = { phase: PendingPhase; current_turn: number | null }
	for (const row of (data ?? []) as {
		player_order: string[] | null
		game_states: Embed | Embed[] | null
	}[]) {
		// A 1:1 embed comes back as an object, but PostgREST has shipped it as
		// a single-element array before; tolerate both rather than silently
		// badging nobody.
		const embed = Array.isArray(row.game_states)
			? row.game_states[0]
			: row.game_states
		const pending = pendingUserIds(
			row.player_order ?? [],
			embed?.phase,
			embed?.current_turn ?? null
		)
		// Only seats we were asked about; the query returns whole games, so
		// most rows name somebody else.
		for (const uid of pending) {
			const prev = counts.get(uid)
			if (prev !== undefined) counts.set(uid, prev + 1)
		}
	}
	return counts
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
		// Confirm mode: an addressee accepted; the proposer must still confirm.
		case 'trade_accept_offered':
			return `${sender ?? 'Someone'} wants to trade — confirm it.`
		// Confirm mode: the proposer confirmed the swap with this accepter.
		case 'trade_confirmed':
			return `${sender ?? 'Someone'} confirmed your trade.`
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
		case 'game_forfeited':
			return `${sender ?? 'Someone'} forfeited the game.`
		case 'end_game_proposed':
			return `${sender ?? 'Someone'} wants to end the game.`
		// Collective outcome — every player voted for it, so naming one would
		// be arbitrary.
		case 'game_canceled':
			return 'Your game was canceled.'
		case 'game_won_by_forfeit':
			return 'Everyone else forfeited — you win.'
		// Always sent with a bodyOverride naming the actual lead time; this is
		// the fallback the exhaustive switch needs.
		case 'turn_timeout_warning':
			return 'Your turn is about to run out.'
		case 'turn_timed_out':
			return 'You ran out of time — your turn was skipped.'
	}
}

function truncate(body: string): string {
	if (body.length <= MAX_BODY_CHARS) return body
	return `${body.slice(0, MAX_BODY_CHARS - 1).trimEnd()}…`
}
