// The app-icon badge: how many in-progress games are waiting on this player —
// the same "your turn" signal the Games list and the header tab strip show as a
// dot, counted rather than flagged.
//
// It is set from two places, because neither covers the other's case. The
// client syncs it from `useGamesStore` whenever the count changes, so taking
// your turn clears the badge with no push involved; and every push carries a
// server-computed `badge` (see `supabase/functions/_notify/index.ts`), because
// the app is closed for the entire time anyone is actually looking at the icon.

import Constants, { ExecutionEnvironment } from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { useEffect } from 'react'
import { Platform } from 'react-native'
import { useAuth } from '../auth'
import { isMyTurn, useGamesStore } from '../stores/useGamesStore'

// Badging Expo Go's own icon would be someone else's app; the number is also
// meaningless there, since push never registers (see `push.ts`).
const isExpoGo =
	Constants.executionEnvironment === ExecutionEnvironment.StoreClient

/** Best-effort. A launcher that refuses the badge isn't an error worth raising. */
export async function setAppBadge(count: number): Promise<void> {
	if (Platform.OS === 'web') return
	if (isExpoGo) return
	try {
		await Notifications.setBadgeCountAsync(count)
	} catch {
		// Android launchers without badge support reject this; ignore.
	}
}

/**
 * Keeps the icon badge in step with the games store for as long as the app is
 * running. Mount once, in the `(app)` layout.
 */
export function useAppBadge(): void {
	const { user } = useAuth()
	const meId = user?.id
	// `null` while the store is still loading — a cold start must not clear a
	// badge a push set correctly before `activeGames` has landed.
	const count = useGamesStore((s) =>
		s.activeGames === undefined
			? null
			: s.activeGames.filter((g) => isMyTurn(g, meId)).length
	)

	useEffect(() => {
		if (count === null) return
		setAppBadge(count)
	}, [count])
}
