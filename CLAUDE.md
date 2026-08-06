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
