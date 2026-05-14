import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { supabase } from '../supabase'

// Foreground delivery: let the OS banner render so we don't need an in-app
// toast component. No sound or badge.
Notifications.setNotificationHandler({
	handleNotification: async () => ({
		shouldShowBanner: true,
		shouldShowList: true,
		shouldPlaySound: false,
		shouldSetBadge: false,
	}),
})

// Tracked module-level so we don't ask twice in a single session.
let permissionAsked = false

function projectId(): string | undefined {
	return (
		Constants.expoConfig?.extra?.eas?.projectId ??
		(Constants as unknown as { easConfig?: { projectId?: string } })
			.easConfig?.projectId
	)
}

/**
 * Idempotent. Asks for permission (once per session), reads the Expo push
 * token, and upserts it server-side. No-op on web, in simulators without push
 * support, or when the user denies. Safe to call on every (app) mount.
 */
export async function ensurePermissionAndRegister(
	userId: string
): Promise<void> {
	if (Platform.OS === 'web') return
	if (!Device.isDevice) return

	let status: Notifications.PermissionStatus = (
		await Notifications.getPermissionsAsync()
	).status

	if (status === 'undetermined' && !permissionAsked) {
		permissionAsked = true
		status = (await Notifications.requestPermissionsAsync()).status
	}
	if (status !== 'granted') return

	const id = projectId()
	if (!id) return

	const tokenRes = await Notifications.getExpoPushTokenAsync({
		projectId: id,
	})
	const token = tokenRes.data
	if (!token) return

	const platform: 'ios' | 'android' =
		Platform.OS === 'ios' ? 'ios' : 'android'

	const { error } = await supabase.from('push_tokens').upsert(
		{
			token,
			user_id: userId,
			platform,
			updated_at: new Date().toISOString(),
		},
		{ onConflict: 'token' }
	)
	if (error) {
		console.warn('[notifications] token upsert failed:', error.message)
	}
}

/** Best-effort: delete this device's token row before sign-out. */
export async function deregisterCurrentToken(): Promise<void> {
	if (Platform.OS === 'web') return
	if (!Device.isDevice) return
	try {
		const id = projectId()
		if (!id) return
		const { data } = await Notifications.getExpoPushTokenAsync({
			projectId: id,
		})
		if (!data) return
		await supabase.from('push_tokens').delete().eq('token', data)
	} catch {
		// Sign-out continues regardless.
	}
}
