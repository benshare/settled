// The games the header strip can toggle between: in-progress games I'm seated
// at plus the friends' games I'm *actively* spectating, oldest-created first
// (the store's lists are `created_at desc`, so they're re-sorted here).
// Completed games aren't switchable — one opened from History has no tab of its
// own.
//
// "Actively spectating" is the key filter: the store's `spectatableGames` is
// everything I *may* watch (every friend-of-a-friend game), which would be far
// too many tabs. `profiles.spectating` records the ones I've actually opened —
// see `.claude/specs/spectating.md`.
//
// Shared by the tab strip and the body's slide transition so the two agree on
// tab order, and the slide direction always matches the direction the tapped
// tab sits in.

import { useGamesStore, type Game } from '@/lib/stores/useGamesStore'
import { useProfileStore } from '@/lib/stores/useProfileStore'
import { useMemo } from 'react'

export function useSwitchableGames(): Game[] {
	const activeGames = useGamesStore((s) => s.activeGames)
	const spectatableGames = useGamesStore((s) => s.spectatableGames)
	const spectating = useProfileStore((s) => s.profile?.spectating)

	return useMemo(() => {
		const watched = new Set(spectating ?? [])
		const spectated = (spectatableGames ?? []).filter((g) =>
			watched.has(g.id)
		)
		const all = [...(activeGames ?? []), ...spectated]
		return all.sort((a, b) => a.created_at.localeCompare(b.created_at))
	}, [activeGames, spectatableGames, spectating])
}
