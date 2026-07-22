import type { Href } from 'expo-router'

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
	| 'chat_message'

export type NotificationData = {
	kind: NotificationKind
	game_id?: string
}

export function resolveNotificationLink(data: unknown): Href | null {
	if (!data || typeof data !== 'object') return null
	const d = data as NotificationData
	switch (d.kind) {
		case 'game_invite':
			return '/games'
		case 'game_started':
		case 'your_turn':
		case 'discard_required':
		case 'trade_proposed':
		case 'trade_accepted':
		case 'trade_accept_offered':
		case 'trade_confirmed':
		case 'trade_rejected_all':
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
