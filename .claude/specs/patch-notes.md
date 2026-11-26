# Patch notes ("App updates")

After the app restarts onto a new bundle — an OTA (CI publishes one on every push to `main`, `.github/workflows/ota-update.yml`) or a new binary — show a short list of what changed, once.

## Data

`lib/patchNotes/patch-notes.json`: an array, oldest first, of `{ "id": "YYYY-MM-DD.N", "notes": string[] }`. One entry per push to `main` that changes something players can see; authoring rule in the root `CLAUDE.md`, validated by `npx tsx dev/check-patch-notes.ts`.

**Id format.** The push's date (UTC is fine; it only has to increase) plus a per-day counter from 1. Chosen over a bare integer because it is easy to author without looking up the last value, it doubles as the screen's group label, and two branches written the same day collide visibly (same id → the check fails) rather than silently. The counter is numeric, so ids are compared by parts (`compareIds`), never as strings.

The file ships inside the JS bundle, so each OTA carries exactly the notes written up to that commit. No server table.

## Cursor

The device stores the newest id it has shown under `patch_notes_last_seen` in `authStorage` (SecureStore / localStorage). Per device, not per user: it describes what this install has displayed. iOS Keychain survives a reinstall, so a reinstall may carry its cursor over — harmless.

## Which entries

`entriesToShow(entries, lastSeen, accountCreatedAt)`:

- **Stored id:** every entry newer than it, newest first. A stored id ahead of the bundle (an OTA rolled back) shows nothing and is left alone.
- **No stored id** (fresh install, or the first OTA containing this feature): only the newest entry, not the whole history — that is the update the player just received. **Except** when the account was created on or after that entry's date: a new player has no "before" to compare with, so nothing is shown and the cursor is silently set to the newest id so the next update shows normally. Day granularity means an existing account created the same day as the newest entry also skips it — acceptable.
- **Empty file:** nothing, and nothing is stored.

## Trigger and sequencing

`usePatchNotes` (mounted in `(app)/_layout.tsx`) pushes `/patch-notes?from=<oldest id to show>` at most once per process. It waits for:

- the push-permission prompt to settle and contacts onboarding (`.claude/specs/contacts-onboarding.md`) to have pushed — prompts queue one at a time, this one last; on a launch where onboarding shows, the notes follow when the player comes back to the tabs;
- the tab group to be on top, so it never covers a game opened from a notification or an auth screen;
- not impersonating;
- the profile to be loaded (for the new-account rule).

Only cold starts check: the OTA check in `app/_layout.tsx` runs on launch, so a new bundle only ever arrives with a restart.

## Screen

Full-screen, slides up from the bottom: "App updates" title, a bullet list of the notes (grouped under a small date label when more than one entry is shown), and a "Got it" button. The cursor is stamped **on show**, like contacts onboarding — a back gesture or killing the app counts as seen, and a failed write can't re-push it this process.
