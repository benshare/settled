import * as Notifications from 'expo-notifications'

export type PushPermissionStatus = Notifications.PermissionStatus

/** The OS-level push permission, re-read every time the account screen focuses. */
export async function getPushPermissionStatus(): Promise<PushPermissionStatus> {
	return (await Notifications.getPermissionsAsync()).status
}
