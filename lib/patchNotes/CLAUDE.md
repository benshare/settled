# Patch notes

The "App updates" screen (`app/patch-notes.tsx`), shown once after the app restarts onto a bundle carrying notes this device hasn't seen. Full design: `.claude/specs/patch-notes.md`; the authoring rule is in the root `CLAUDE.md`.

- `patch-notes.json` — the notes, oldest first, bundled with the JS, so an OTA carries its own. An empty array shows nothing.
- `notes.ts` — pure (checked by `dev/check-patch-notes.ts`). Ids are `YYYY-MM-DD.N` and **must be compared with `compareIds`**, never as strings. `entriesToShow` owns the first-look rule.
- `usePatchNotes.ts` — the trigger, last in `(app)/_layout.tsx`'s prompt queue (push permission → contacts onboarding → this). The cursor is **per device**, in `authStorage`; the screen stamps it on show.
