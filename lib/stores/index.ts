export type AutoLoadedStore = {
	name: string
	loadForUser: (userId: string) => Promise<void>
	clear: () => void
}

import { friendsStoreRegistration } from './useFriendsStore'
import { gamesStoreRegistration } from './useGamesStore'
import { profileStoreRegistration } from './useProfileStore'

export const autoLoadedStores: AutoLoadedStore[] = [
	profileStoreRegistration,
	friendsStoreRegistration,
	gamesStoreRegistration,
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
