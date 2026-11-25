import { useRouter, useSegments } from 'expo-router'
import { useEffect } from 'react'
import { useProfileStore } from '../stores/useProfileStore'
import { contactsAvailable } from './device'

// Once per process per user, so a failed `markContactsOnboarded` write (which
// reverts the stamp) can't bounce the prompt straight back up.
let launchedFor: string | null = null

/**
 * Pushes the contacts prompt once for any profile that has never seen it —
 * new sign-ups and existing accounts alike. Only from the tab group, so it
 * never lands on top of a game a push notification just opened; it waits for
 * the user to come back. `ready` lets the caller hold it behind other
 * first-run prompts.
 */
export function useContactsOnboarding(
	userId: string | undefined,
	ready: boolean
) {
	const router = useRouter()
	const segments = useSegments()
	const inTabs = segments[0] === '(app)'
	const unseen = useProfileStore(
		(s) => s.profile != null && s.profile.contacts_onboarded_at == null
	)

	useEffect(() => {
		if (!userId || !ready || !inTabs || !unseen) return
		if (!contactsAvailable || launchedFor === userId) return
		launchedFor = userId
		router.push({ pathname: '/find-friends', params: { onboarding: '1' } })
	}, [userId, ready, inTabs, unseen, router])
}
