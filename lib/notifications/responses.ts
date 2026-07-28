import * as Notifications from 'expo-notifications'
import { useRouter } from 'expo-router'
import { useEffect } from 'react'
import { resolveNotificationLink } from './links'

/**
 * Sends a tapped notification to the thing it is about, whether the app was
 * already running or was launched by the tap. Mount once, in the `(app)`
 * layout.
 */
export function useNotificationRouting(): void {
	const router = useRouter()

	useEffect(() => {
		const sub = Notifications.addNotificationResponseReceivedListener(
			(resp) => {
				const link = resolveNotificationLink(
					resp.notification.request.content.data
				)
				// `navigate`, not `push`: when the game screen is already on
				// top, this updates its params in place instead of stacking a
				// second copy of the same game behind the back chevron.
				if (link) router.navigate(link)
			}
		)
		// Cold-start case: the app was launched by tapping a notification.
		Notifications.getLastNotificationResponseAsync().then((resp) => {
			if (!resp) return
			const link = resolveNotificationLink(
				resp.notification.request.content.data
			)
			if (link) router.replace(link)
		})
		return () => sub.remove()
	}, [router])
}
