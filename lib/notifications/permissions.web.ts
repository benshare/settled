// See `push.web.ts` for why the web builds of these modules import nothing.
// Nothing renders this on web — the account screen hides the whole
// notifications section off-native — but the import has to resolve.

export type PushPermissionStatus = 'undetermined' | 'granted' | 'denied'

export async function getPushPermissionStatus(): Promise<PushPermissionStatus> {
	return 'denied'
}
