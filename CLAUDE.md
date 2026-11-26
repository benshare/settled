# settled

## Documentation & comments

Each self-contained module has a `CLAUDE.md` documenting its functionality.
Keep docs and comments concise: **say only what a competent engineer cannot
infer from the code itself.** Favor high-level intent and non-obvious "why"
(invariants, gotchas, cross-file contracts, edge-function mirrors) over
restating what the code plainly does. Avoid duplication across docs — state a
fact in its home doc and reference it elsewhere.

Describe UI at the layout altitude, not the mechanism. For example:

- Good: "The game screen renders in one of two layouts, new or classic. The new
  layout is full-screen with a draggable background and a fixed floating
  header..."
- Bad: "the button uses a div with flex gap-6 and displays 'waiting for x
  players' when there is more than one..."

Depth belongs in `.claude/specs/*`, which the module docs link to for full
designs.

## Patch notes (every push to `main`)

Each push to `main` publishes an OTA, and players see what changed on their next launch. So **every push to `main` with a player-visible change appends one entry** to `lib/patchNotes/patch-notes.json` (oldest first):

```json
{
	"id": "2026-11-26.1",
	"notes": ["Robber placement no longer gets stuck after a reconnect."]
}
```

- `id`: the push's date plus a per-day counter from 1 (`.2` for the second push that day). Must sort after the previous entry.
- `notes`: one short line per change, in player-facing language (what they'll notice, not how it was done), sentence case with a full stop. No internal changes (refactors, docs, tooling, edge-function-only fixes with no visible effect).
- A push with no player-visible change adds **no entry** — say so in the commit message instead. Several commits pushed together share one entry.
- Run `npx tsx dev/check-patch-notes.ts` before pushing. Design: `.claude/specs/patch-notes.md`.
