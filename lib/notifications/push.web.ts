// Web gets no push at all, so `expo-notifications` is deliberately never
// imported on this platform — not even to no-op against. Merely importing it
// runs its device-push-token auto-registration side effect, which registers a
// token listener the web build can't honour and warns about it on every load.
// Every module here that touches the SDK therefore has a `.web` twin that
// imports nothing; the native guards (`Platform.OS === 'web'`) stay in place as
// the second line of defence.

export async function ensurePermissionAndRegister(
	_userId: string
): Promise<void> {}

export async function deregisterCurrentToken(): Promise<void> {}
