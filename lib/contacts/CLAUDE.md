# Contacts

Find-friends-from-contacts: the device side of `.claude/specs/contacts-onboarding.md`. The screen is `app/find-friends.tsx`; the server match is the `match_contacts` RPC, called through `useFriendsStore.matchContacts`.

- `device.ts` — **the only file that may touch `expo-contacts`.** The SDK throws at import time on binaries built before it was added, and OTA updates reach those binaries, so it is `require`d lazily behind the `contactsAvailable` probe. A static import anywhere crashes old installs at launch.
- `phone.ts` — pure E.164 normalization; a wrong guess only costs a match.
- `onboarding.ts` — the one-time trigger. Keyed on `profiles.contacts_onboarded_at` (stamped on show by `useProfileStore.markContactsOnboarded`), plus a per-process guard so a failed stamp can't re-push the screen.
