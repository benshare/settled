import type { Href } from 'expo-router'

export type NotificationKind =
	| 'game_invite'
	| 'game_started'
	| 'your_turn'
	| 'discard_required'
	| 'trade_proposed'
	| 'friend_request'

export type NotificationData = {
	kind: NotificationKind
	game_id?: string
}

export function resolveNotificationLink(data: unknown): Href | null {
	if (!data || typeof data !== 'object') return null
	const d = data as NotificationData
	switch (d.kind) {
		case 'game_invite':
			return '/play'
		case 'game_started':
		case 'your_turn':
		case 'discard_required':
		case 'trade_proposed':
			return d.game_id ? (`/game/${d.game_id}` as Href) : '/play'
		case 'friend_request':
			return '/friends'
		default:
			return null
	}
}
