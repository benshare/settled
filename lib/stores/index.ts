export type AutoLoadedStore = {
	name: string
	loadForUser: (userId: string) => Promise<void>
	clear: () => void
}

import { friendsStoreRegistration } from './useFriendsStore'
import { gameStatesStoreRegistration } from './useGameStatesStore'
import { gamesStoreRegistration } from './useGamesStore'
import { profileStoreRegistration } from './useProfileStore'
import { statsStoreRegistration } from './useStatsStore'

export const autoLoadedStores: AutoLoadedStore[] = [
	profileStoreRegistration,
	friendsStoreRegistration,
	gamesStoreRegistration,
	// Downstream of `gamesStoreRegistration` (it follows `activeGames`), but
	// registered in its own right so the foreground resync re-reads its rows
	// and rebuilds its channel even when the set of games hasn't moved. These
	// run in parallel — it holds no ids on a cold start and picks them up when
	// the games store's load lands.
	gameStatesStoreRegistration,
	statsStoreRegistration,
]

export async function loadAllUserStores(userId: string): Promise<void> {
	await Promise.all(
		autoLoadedStores.map((s) =>
			s.loadForUser(userId).catch((err) => {
				console.warn(`[stores] ${s.name} loadForUser failed`, err)
			})
		)
	)
}

export function clearAllUserStores(): void {
	autoLoadedStores.forEach((s) => s.clear())
}
