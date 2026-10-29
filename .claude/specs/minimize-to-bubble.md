# Minimize to bubble

Replace the "collapse upward into the title bar" behavior with a minimize that
shrinks the whole sheet into a small circular bubble at the board's top right.
Applies to every surface that uses `CollapsibleSheet` today:

- the four `MinimizableModal` prompts (`SpecialistDeclareOverlay`,
  `ScoutPickOverlay`, `ForgerPickOverlay`, `MagicianPickOverlay`), and
- the in-tree bonus-selection pane (`BonusSelection`).

## Behavior

- **Backdrop** (modals only): dim drops from `rgba(0,0,0,0.55)` to half,
  `0.275`. Applies to `MinimizableModal` only; plain `Modal`s keep 0.55.
- **Toggle**: a 32px circular − button at the sheet's top-right. The title is
  no longer pressable (− button only).
- **Minimize**: the sheet morphs into a 32px circle at the board's top right. The
  content fades out early in the morph and travels with the shrinking surface
  toward the corner; the − button glides into the circle's center and spins 90°
  while crossfading into a +. Nothing else is shown in the bubble (no bonus icon).
- **While minimized** (modals): the backdrop fades to transparent alongside the
  morph, and at the end the RN `<Modal>` closes so the whole screen is
  interactive again. An in-tree bubble that looks identical takes over at the
  same spot.
- **Restore**: tapping the bubble reopens the modal with the sheet at the bubble
  rect, then morphs back out (+ spins into −) while the backdrop fades in.
- **First appearance** (modals): sheet + backdrop fade in (our own timing; the RN
  modal runs with `animationType="none"` so the morph and the native fade don't
  fight).
- **Bubble position**: board-relative `top: spacing.sm, right: spacing.sm` in
  both layouts. In the HUD the board layer already starts below the top bar and
  chip band, so that's "below the top bar"; the HUD's bottom-right utility
  stack is untouched. In the classic layout the bubble takes slot 0 of the
  top-right utility stack and legend / log / chat / watchers / stop-watching
  (and the panels they open) shift down one slot while a prompt is minimized.
- The bonus pane has no backdrop; its morph is in-tree only. Its float container
  becomes `pointerEvents="box-none"` so a minimized pane doesn't block the board.

## Design

### `lib/modules/MinimizableSheet.tsx` (replaces `CollapsibleSheet.tsx`)

Controlled (`minimized`, `onToggleMinimized`). Renders an absolute-fill root
(`box-none`) that measures itself, and inside it an absolutely positioned
**surface** whose `left/top/width/height/borderRadius` interpolate between the
rest frame and the bubble rect on a single `progress` shared value (1 =
expanded). Content is laid out at the rest size, absolutely anchored to the
surface's top-right, so the morph never reflows it.

- Rest frame: `fill` → the whole root (bonus pane). Otherwise content-sized:
  width `min(rootW − 2·lg, maxWidth)`, centered, `top` from a prop (the modal
  passes safe-area top + lg), height measured from the content's `onLayout`
  (height changes animate rather than jump — replaces the old
  `LinearTransition`).
- Bubble rect: prop `{ x, y }` in root coordinates; defaults to the root's top
  right.
- `onMorphEnd(minimized)` fires when a morph finishes (modal handoff).
- Exports `MinimizedBubble` — the standalone in-tree + circle, visually
  identical to the surface at progress 0 (card bg, 1px border, `shadow.card`,
  same as the utility buttons).

### `lib/modules/Modal.tsx`

- Backdrop becomes an `Animated.View` so `backdropStyle` may be animated.
- New `animationType` prop (default `'fade'`), `onShow`, and
  `fullScreenContent` (content wrapper fills the backdrop with
  `pointerEvents="box-none"`, so its child positions itself while outside taps
  still reach the dismiss target). The `layout` prop goes (only
  `MinimizableModal` used it).

### `lib/modules/MinimizableModal.tsx`

Controlled: `minimized`, `onToggleMinimized`; `contentStyle` is replaced by
`maxWidth`. It renders the `Modal` (with `animationType="none"`) plus an in-tree
`MinimizedBubble` at the board's top right, which it measures with
`measureInWindow` (minus the modal root's window origin) to give the sheet its
bubble target. Handoff states:

- `docked` — the morph has finished in the bubble state, so the modal is closed
  and the in-tree bubble is live. Set from `onMorphEnd(true)`, in the same
  commit that hides the modal, so the two overlap rather than flicker.
- `restoring` — the bubble was tapped, the modal is reopening, and the sheet
  is held at the bubble until `onShow`, then morphs out.

### State

`bonusPaneCollapsed` in `gameScreenContext` becomes `promptMinimized` /
`setPromptMinimized`, shared by every minimizable prompt (they're mutually
exclusive by phase). It resets to `false` whenever `gameState.phase.kind`
changes, so the next prompt always opens expanded. `BoardArea` passes it to each
overlay, and uses `promptMinimized && <a minimizable prompt is showing>` to
shift the classic stack, via a new `topOffset` prop on `BoardLegend`,
`ActionLog`, `ChatButton`, `WatcherButton` and `StopWatchingButton`.

## Docs

Update `lib/modules/CLAUDE.md` (MinimizableSheet replaces CollapsibleSheet,
Modal props, MinimizableModal handoff), `lib/catan/CLAUDE.md` rule 2 wording,
and any `lib/game` mentions of the bonus pane collapse.
