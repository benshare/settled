// Own-action resync.
//
// Realtime is best-effort (see lib/stores/CLAUDE.md), but a player's own move is
// the one update they can't afford to miss: the board they're looking at is the
// board they just acted on, and if the update never arrives they re-tap and the
// edge function rejects the repeat — which is what a stuck robber placement
// looked like in the wild. The acting client already knows its write landed (the
// edge function returned 200), so it doesn't need the channel to find out.
//
// Every successful game-service call pings this bus; GameProvider re-reads the
// rows it just changed. Server-authoritative still — this is a re-read, not an
// optimistic update (the client can't predict a move_robber auto-steal anyway).

type Listener = () => void

const listeners = new Map<string, Set<Listener>>()

export function onGameMutated(gameId: string, listener: Listener): () => void {
	const forGame = listeners.get(gameId) ?? new Set<Listener>()
	forGame.add(listener)
	listeners.set(gameId, forGame)
	return () => {
		forGame.delete(listener)
		if (forGame.size === 0) listeners.delete(gameId)
	}
}

export function emitGameMutated(gameId: string): void {
	const forGame = listeners.get(gameId)
	if (!forGame) return
	for (const listener of forGame) listener()
}
