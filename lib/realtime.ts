// Shared realtime plumbing. See lib/stores/CLAUDE.md for why realtime is
// treated as best-effort rather than a source of truth.

let counter = 0

/**
 * Names a channel so that a replacement can never collide with the channel it
 * replaces.
 *
 * A socket may hold only one channel per topic. Every subscribed surface here
 * re-creates its channel on foreground, and the `removeChannel` that precedes
 * it is asynchronous — its `leave` may still be in flight, or (if the socket
 * died while the app was suspended) may never land at all. Rejoining the same
 * topic in that window is refused by the server, and `subscribe()` has nowhere
 * to report that, so realtime goes quiet for the rest of the session.
 */
export function uniqueTopic(base: string): string {
	counter += 1
	return `${base}:${counter}`
}
