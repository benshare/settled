# Contacts onboarding + friend suggestions

Offer, once, to look through the user's contacts for people already on Settled, then suggest friend requests to them. Also reachable any time from the Friends tab.

## Flow

1. **Trigger.** `useContactsOnboarding` (mounted in `(app)/_layout.tsx`) pushes `/find-friends?onboarding=1` when the loaded profile has `contacts_onboarded_at = null`. That single rule covers new sign-ups (after `set-username` lands them in the tabs) and existing accounts (retroactively, on their next open) alike. It waits for:
    - the push-permission prompt to settle, so a new user never gets two OS dialogs stacked;
    - the tab group to be on top, so it never covers a game a notification tap just opened;
    - not impersonating (it would stamp the borrowed account);
    - the native module being present (see OTA safety).
2. **Explainer.** Why we ask, a privacy line, "Find friends" / "Not now". If the OS permission is already granted it skips straight to searching; if it is permanently denied it offers Settings instead.
3. **Search.** Read every phone number, normalize to E.164, call `match_contacts`.
4. **Suggestions.** Per-person Add and Add all, via `useFriendsStore.sendRequest` (friends-service, so the receiver gets the usual push). Each row is labelled with the contact's name from the device. No matches → a short empty state and Continue.

**Never nag.** `contacts_onboarded_at` is stamped when the screen is _shown_, not answered, so declining, backing out, or killing the app all count. Declining the OS dialog during onboarding just leaves. The Friends-tab row ("Find friends from contacts") is the only way back, and only on demand.

## Matching (`match_contacts`, migration 20261125140000)

Phones live in `auth.users` (SMS auth), unreadable by clients, so this is a `security definer` RPC rather than an edge function — a single read whose only write is the quota counter, with no push to send.

- **In:** up to 1000 numbers per call (client batches, sequentially). **Out:** `id, username, avatar_path, updated_at, contact_index` — never a phone. `contact_index` points back into the caller's own array so the client can show its own contact name; it reveals nothing the caller couldn't get by querying one number at a time.
- **Excludes** self, deleted auth users, existing friends, and any pair with a `friend_requests` row of any status in either direction — the pair-unique index would 409 a new request anyway. Dev profiles are excluded unless the client passes `p_include_dev` (it passes `__DEV__`), per the dev-profile rule in `lib/stores/CLAUDE.md`.
- **Compared as bare digits.** GoTrue stores `phone` without the `+`; the RPC strips non-digits and also tries the `+` form.
- **Abuse.** Contact discovery is inherently a phone → account oracle. Guards: authenticated callers only (execute revoked from `anon`), 1000 per call, and a rolling 24h quota of 20 000 numbers per user in `contact_match_quota` (counts only). A refused call rolls back its own increment. The client caps one run at 5000 numbers so a same-day re-run still fits.
- **Privacy.** Numbers are never written or logged by the function; only the count is. Hashing was considered and skipped: the phone-number space is small enough that unsalted hashes are trivially reversible, so it would add a full scan of `auth.users` per call for no real protection.

## Normalization (`lib/contacts/phone.ts`)

No libphonenumber. A number with `+`/`00` (or `011` for +1 users) is taken as international; otherwise it is local to the user's own country, derived from their auth phone via the prefix-free calling-code rule (1/7 → one digit, a known two-digit set, else three). For +1, local means 10 digits or 11 starting with 1; elsewhere a single trunk `0` is dropped. Anything outside 8–15 digits is discarded. A wrong guess just fails to match. Known miss: national formats that keep a leading 0 (Italy).

## OTA safety

`expo-contacts` is a new native module, and `runtimeVersion` is `appVersion`, so OTA updates (CI publishes one on every push to `main`) reach binaries built without it. `expo-contacts` calls `requireNativeModule` at import time, which throws on those binaries. So:

- `lib/contacts/device.ts` is the **only** importer, and it `require`s `expo-contacts/legacy` lazily, after `requireOptionalNativeModule('ExpoContacts')` confirms the module is linked (`contactsAvailable`). Never import the SDK statically.
- With the module absent, the onboarding never triggers (and so never stamps — it will show once the user is on a new binary) and the Friends row is hidden.

`scripts/ota.mjs`'s fingerprint guard will flag this change (new package + plugin + Info.plist key) until a new native build ships; the guard above is what makes `--force` (and the unguarded CI publish) safe.

## Native config

`app.json` adds the `expo-contacts` plugin with `NSContactsUsageDescription`, and blocks the `WRITE_CONTACTS` permission the plugin adds on Android (read-only use).
