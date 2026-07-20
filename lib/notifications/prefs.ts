export type NotificationPrefs = {
	gameInvite: boolean
	yourTurn: boolean
	trade: boolean
	friendRequest: boolean
	chatMessage: boolean
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
	gameInvite: true,
	yourTurn: true,
	trade: true,
	friendRequest: true,
	chatMessage: true,
}

// Narrow the JSONB blob to NotificationPrefs. Silently falls back on shape
// drift (mirrors parseGameDefaults).
export function parseNotificationPrefs(raw: unknown): NotificationPrefs {
	if (!raw || typeof raw !== 'object') return DEFAULT_NOTIFICATION_PREFS
	const src = raw as Record<string, unknown>
	return {
		gameInvite:
			typeof src.gameInvite === 'boolean'
				? src.gameInvite
				: DEFAULT_NOTIFICATION_PREFS.gameInvite,
		yourTurn:
			typeof src.yourTurn === 'boolean'
				? src.yourTurn
				: DEFAULT_NOTIFICATION_PREFS.yourTurn,
		trade:
			typeof src.trade === 'boolean'
				? src.trade
				: DEFAULT_NOTIFICATION_PREFS.trade,
		friendRequest:
			typeof src.friendRequest === 'boolean'
				? src.friendRequest
				: DEFAULT_NOTIFICATION_PREFS.friendRequest,
		chatMessage:
			typeof src.chatMessage === 'boolean'
				? src.chatMessage
				: DEFAULT_NOTIFICATION_PREFS.chatMessage,
	}
}
