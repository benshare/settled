// The games the header strip can toggle between: in-progress games I'm seated
// at plus the friends' games I'm allowed to watch, oldest-created first (the
// store's lists are `created_at desc`, so they're re-sorted here). Completed
// games aren't switchable — one opened from History has no tab of its own.
//
// Shared by the tab strip and the body's slide transition so the two agree on
// tab order, and the slide direction always matches the direction the tapped
// tab sits in.

import { useGamesStore, type Game } from '@/lib/stores/useGamesStore'
import { useMemo } from 'react'

export function useSwitchableGames(): Game[] {
	const activeGames = useGamesStore((s) => s.activeGames)
	const spectatableGames = useGamesStore((s) => s.spectatableGames)

	return useMemo(() => {
		const all = [...(activeGames ?? []), ...(spectatableGames ?? [])]
		return all.sort((a, b) => a.created_at.localeCompare(b.created_at))
	}, [activeGames, spectatableGames])
}
