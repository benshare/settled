// See `push.web.ts` for why the web builds of these modules import nothing.
// Browsers have no app icon to badge either way.

export async function setAppBadge(_count: number): Promise<void> {}

export function useAppBadge(): void {}
