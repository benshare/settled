import { requireOptionalNativeModule } from 'expo'
import { Platform } from 'react-native'
import { callingCodeOf, toE164 } from './phone'

type ContactsSdk = typeof import('expo-contacts/legacy')

// `expo-contacts` binds its native module at import time and throws if the
// binary doesn't have it. Binaries built before this feature don't, and OTA
// updates still reach them (runtimeVersion is `appVersion`), so the SDK is only
// ever `require`d after this probe says the module is linked. Never import it
// statically anywhere else. See `.claude/specs/contacts-onboarding.md`.
export const contactsAvailable =
	Platform.OS !== 'web' && requireOptionalNativeModule('ExpoContacts') != null

let sdk: ContactsSdk | null = null
function load(): ContactsSdk | null {
	if (!contactsAvailable) return null
	sdk ??= require('expo-contacts/legacy') as ContactsSdk
	return sdk
}

// `blocked` = denied and the OS won't show the prompt again; only Settings
// can turn it back on.
export type ContactsPermission =
	'granted' | 'undetermined' | 'denied' | 'blocked' | 'unavailable'

function toPermission(res: {
	status: string
	canAskAgain: boolean
}): ContactsPermission {
	if (res.status === 'granted') return 'granted'
	if (res.status === 'undetermined') return 'undetermined'
	return res.canAskAgain ? 'denied' : 'blocked'
}

export async function getContactsPermission(): Promise<ContactsPermission> {
	const Contacts = load()
	if (!Contacts) return 'unavailable'
	return toPermission(await Contacts.getPermissionsAsync())
}

export async function requestContactsPermission(): Promise<ContactsPermission> {
	const Contacts = load()
	if (!Contacts) return 'unavailable'
	return toPermission(await Contacts.requestPermissionsAsync())
}

// Keeps one run well inside the server's daily quota (20k numbers), so a
// re-run from the Friends screen still works the same day.
const MAX_PHONES = 5000

export type ContactPhones = {
	// Distinct E.164 numbers, the caller's own excluded.
	phones: string[]
	// Display name per entry of `phones`, for labelling matches.
	names: string[]
}

/**
 * Every phone number in the address book, normalized and deduped. Numbers
 * without a country prefix are read as local to `ownPhone`'s country. Under
 * iOS limited access this is just the contacts the user picked.
 */
export async function readContactPhones(
	ownPhone: string | null | undefined
): Promise<ContactPhones> {
	const Contacts = load()
	if (!Contacts) return { phones: [], names: [] }
	const { data } = await Contacts.getContactsAsync({
		fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
	})

	const code = callingCodeOf(ownPhone)
	const own = ownPhone
		? toE164('+' + ownPhone.replace(/\D/g, ''), code)
		: null
	const seen = new Set<string>()
	const phones: string[] = []
	const names: string[] = []
	for (const contact of data) {
		for (const entry of contact.phoneNumbers ?? []) {
			const e164 = entry.number ? toE164(entry.number, code) : null
			if (phones.length >= MAX_PHONES) break
			if (!e164 || e164 === own || seen.has(e164)) continue
			seen.add(e164)
			phones.push(e164)
			names.push(contact.name ?? '')
		}
	}
	return { phones, names }
}
