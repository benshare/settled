// Where a tapped notification lands. Pure — see `responses.ts` for when it is
// safe to actually navigate there.

import type { Href } from 'expo-router'

// Twin of the union in `supabase/functions/_notify/index.ts`, which is what
// puts `kind` on the wire. Adding a kind there without adding it here sends it
// to `default` below, and the tap is silently swallowed — keep them in step.
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

export type NotificationData = {
	kind: NotificationKind
	game_id?: string
	// game_invite only: a `game_requests` row, since there is no game yet.
	request_id?: string
}

export function resolveNotificationLink(data: unknown): Href | null {
	if (!data || typeof data !== 'object') return null
	const d = data as NotificationData
	switch (d.kind) {
		// The invite screen, not the list — it is the one place the invite can
		// be accepted or declined. A request already resolved elsewhere renders
		// its own "no longer available" state there, which is a fair landing.
		// The fallback covers pushes queued by a server build that predates
		// `request_id`.
		case 'game_invite':
			return d.request_id
				? (`/game/request/${d.request_id}` as Href)
				: '/games'
		case 'game_started':
		case 'your_turn':
		case 'discard_required':
		case 'trade_proposed':
		case 'trade_accepted':
		case 'trade_accept_offered':
		case 'trade_confirmed':
		case 'trade_rejected_all':
		case 'honk':
			return d.game_id ? (`/game/${d.game_id}` as Href) : '/games'
		// Land in the conversation, not merely on the board — the message is
		// what the tap was about.
		case 'chat_message':
			return d.game_id ? (`/game/${d.game_id}?chat=1` as Href) : '/games'
		case 'friend_request':
			return '/friends'
		default:
			return null
	}
}
