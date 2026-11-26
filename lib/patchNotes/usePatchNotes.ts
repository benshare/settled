import { useRouter, useSegments } from 'expo-router'
import { useEffect } from 'react'
import { useProfileStore } from '../stores/useProfileStore'
import { authStorage } from '../supabase'
import { entriesToShow, PATCH_NOTES } from './notes'

// Per device, not per user: it records which notes this install has shown.
const STORAGE_KEY = 'patch_notes_last_seen'

// Once per process: the screen stamps on show, but a failed write must not
// bounce it straight back up when the user returns to the tabs.
let launched = false

function readLastSeen(): Promise<string | null> {
	return authStorage.getItem(STORAGE_KEY).catch(() => null)
}

/** Records the bundle's newest entry as shown. Best-effort. */
export function markPatchNotesSeen() {
	const newest = PATCH_NOTES[PATCH_NOTES.length - 1]
	if (!newest) return
	authStorage
		.setItem(STORAGE_KEY, newest.id)
		.catch((err) => console.warn('[patch-notes] write failed', err))
}

/**
 * Pushes the "App updates" screen once per launch when the bundle carries
 * notes this device hasn't shown. Only from the tab group, so it never covers
 * a game a notification tap opened; `ready` holds it behind the other
 * first-run prompts. Needs the profile for the new-account rule in
 * `entriesToShow`.
 */
export function usePatchNotes(ready: boolean) {
	const router = useRouter()
	const segments = useSegments()
	const inTabs = segments[0] === '(app)'
	const createdAt = useProfileStore((s) => s.profile?.created_at ?? null)

	useEffect(() => {
		if (!ready || !inTabs || !createdAt || launched) return
		if (PATCH_NOTES.length === 0) return
		let cancelled = false
		readLastSeen().then((lastSeen) => {
			if (cancelled || launched) return
			launched = true
			const show = entriesToShow(PATCH_NOTES, lastSeen, createdAt)
			if (show.length > 0) {
				router.push({
					pathname: '/patch-notes',
					params: { from: show[show.length - 1].id },
				})
			} else if (lastSeen == null) {
				// A new account: start its cursor so the next update shows.
				markPatchNotesSeen()
			}
		})
		return () => {
			cancelled = true
		}
	}, [ready, inTabs, createdAt, router])
}
