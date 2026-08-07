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
import { useEffect, useMemo } from 'react'
import { Platform } from 'react-native'
import { useAppForeground } from '../appState'
import { useAuth } from '../auth'
import { useGameStatesStore } from '../stores/useGameStatesStore'
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
 * running. Mount once, in the **root** layout (`app/_layout.tsx`) — not in
 * `(app)`. Tapping a push replaces the tab group with `/game/[id]`, so a hook
 * mounted under `(app)` unmounts for exactly the session where the badge most
 * needs clearing: launched from a "your turn" push, turn taken, badge stuck.
 */
export function useAppBadge(): void {
	const { user } = useAuth()
	const meId = user?.id
	// `null` while the store is still loading — a cold start must not clear a
	// badge a push set correctly before `activeGames` has landed. A game whose
	// board hasn't landed yet still counts, off `current_turn` (see
	// `pendingUserIds`), for the same reason.
	const activeGames = useGamesStore((s) => s.activeGames)
	const statesById = useGameStatesStore((s) => s.byId)
	const count = useMemo(
		() =>
			activeGames === undefined
				? null
				: activeGames.filter((g) =>
						isMyTurn(g, meId, statesById[g.id]?.phase)
					).length,
		[activeGames, statesById, meId]
	)

	useEffect(() => {
		if (count === null) return
		setAppBadge(count)
	}, [count])

	// A push that lands while we're backgrounded sets the badge itself, from a
	// count the store never saw. Re-apply on the way back in rather than waiting
	// for `count` to move — it usually doesn't, and the effect above only fires
	// on change. Worst case this writes a stale number for the moment before the
	// foreground resync lands, which the effect then corrects.
	useAppForeground(() => {
		if (count === null) return
		setAppBadge(count)
	})
}
