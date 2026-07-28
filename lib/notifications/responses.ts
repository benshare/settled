import * as Notifications from 'expo-notifications'
import { useRouter, useSegments, type Href } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { resolveNotificationLink } from './links'

/**
 * Sends a tapped notification to the thing it is about, whether the app was
 * already running or was launched by the tap.
 *
 * Mount once, in the **root** layout (`app/_layout.tsx`) — not in `(app)`, for
 * the same reason as `useAppBadge`: a deep link puts `/game/[id]` on top of the
 * tab group, and a `replace` used to swap the group out entirely, so a hook
 * mounted under `(app)` lost its listener for exactly the session that began
 * with a notification tap. Every later tap in that session then did nothing.
 *
 * Two sources feed one funnel. The live listener covers a tap while the app is
 * running; `getLastNotificationResponse()` covers the tap that launched it, and
 * returns the *same* response the listener may also deliver — hence the dedupe
 * on the request identifier, mirroring `expo-notifications`' own
 * `useLastNotificationResponse`.
 */
export function useNotificationRouting(): void {
	const router = useRouter()
	const segments = useSegments()

	// A resolved link waiting for somewhere to go. Held rather than navigated
	// on arrival, because the response can land before there is a navigator to
	// take it — see `ready`.
	const [pending, setPending] = useState<Href | null>(null)

	// Responses already routed this session. Bounded by how many notifications
	// one person taps between launches.
	const handled = useRef<Set<string>>(new Set())

	const accept = useCallback((resp: Notifications.NotificationResponse) => {
		const id = resp.notification.request.identifier
		if (handled.current.has(id)) return
		handled.current.add(id)
		// The native layer keeps handing this response back for the life of the
		// process. Left alone, remounting this hook — or merely reading it a
		// second time — yanks the user to a notification they dealt with
		// minutes ago.
		Notifications.clearLastNotificationResponse()
		const link = resolveNotificationLink(
			resp.notification.request.content.data
		)
		if (link) setPending(link)
	}, [])

	useEffect(() => {
		const sub =
			Notifications.addNotificationResponseReceivedListener(accept)
		const launch = Notifications.getLastNotificationResponse()
		if (launch) accept(launch)
		return () => sub.remove()
	}, [accept])

	// Navigating before the root navigator mounts is dropped, and navigating
	// while `index` is still deciding where to send us loses to its redirect.
	// One check covers both: `useSegments` reads the router store rather than a
	// navigation context, so it is safe to call from the root layout, and it is
	// empty for exactly those two states — no navigator state yet, and `index`,
	// whose path is `/`. `(auth)` then holds the tap through login.
	//
	// Parking rather than dropping is the point: a tap that arrives before the
	// tree can take it is still honoured, just later.
	const ready = segments.length > 0 && segments[0] !== '(auth)'

	useEffect(() => {
		if (!pending || !ready) return
		setPending(null)
		// `navigate`, not `push` or `replace`. Against a game screen that's
		// already on top it updates the params in place rather than stacking a
		// second copy of the same route behind the back chevron; and it leaves
		// the tab group underneath, so Back out of a deep-linked game returns
		// to the Games list instead of finding an empty stack.
		router.navigate(pending)
	}, [pending, ready, router])
}
