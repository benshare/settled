// Foreground resync.
//
// Realtime is a best-effort transport, not a source of truth. While the app is
// backgrounded the OS suspends the JS thread and closes the WebSocket, and
// Supabase realtime has no replay on reconnect — every postgres_changes event
// emitted during that window is lost for good. So on every background → active
// transition, subscribed surfaces must re-read state from the database and
// re-create their channels rather than trust that they kept up.

import { AppState, type AppStateStatus } from 'react-native'
import { useEffect, useRef } from 'react'
import { supabase } from './supabase'

type Listener = () => void

const listeners = new Set<Listener>()
let previous: AppStateStatus = AppState.currentState
let registered = false

async function handleChange(next: AppStateStatus) {
	const wasBackgrounded = previous === 'background'
	previous = next
	// `inactive` covers transient states (notification centre pulled down, app
	// switcher peeked, incoming call banner) where the socket is still alive —
	// only a real background → active round trip needs a resync.
	if (!wasBackgrounded || next !== 'active') return

	// Refreshes the token if it expired while we were away, so the resync — and
	// the channel rejoins that follow it — run with a valid JWT.
	await supabase.auth.getSession().catch(() => {})

	// The OS closed the socket while the app was suspended, but React Native
	// doesn't reliably surface that close: supabase-js can go on believing it's
	// connected, and channels rejoined on the dead socket receive nothing. Force
	// a fresh one. Deliberately not awaited — closing a wedged socket can sit on
	// the adapter's 10s timeout, and the refetches below shouldn't wait on it.
	// Joins pushed in the meantime are buffered and flush on the new connection.
	supabase.realtime
		.disconnect()
		.then(() => supabase.realtime.connect())
		.catch(() => {})

	for (const listener of listeners) listener()
}

function subscribe(listener: Listener): () => void {
	listeners.add(listener)
	if (!registered) {
		AppState.addEventListener('change', handleChange)
		registered = true
	}
	return () => {
		listeners.delete(listener)
	}
}

/**
 * Runs `cb` each time the app returns to the foreground from a real background.
 * The callback is held in a ref, so it doesn't need a stable identity.
 */
export function useAppForeground(cb: Listener): void {
	const ref = useRef(cb)
	useEffect(() => {
		ref.current = cb
	}, [cb])
	useEffect(() => subscribe(() => ref.current()), [])
}
