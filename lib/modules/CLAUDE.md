# Modules

Shared, app-agnostic UI primitives (not Catan-specific). Style with `StyleSheet.create`, usually via a `makeStyles(colors)` factory memoized against `useTheme()`. Props are on the components; this file records only what isn't obvious from the signature.

- `Modal.tsx` — **the base overlay primitive; the only way to render a modal.** Wraps RN's `<Modal transparent>` and bakes in the dismissal every overlay needs (dimmed backdrop, outside-tap, hardware-back/Escape → `onDismiss`). The dismiss target is a `Pressable` sibling rendered **behind** the content, not a wrapper around it: a `Pressable` ancestor claims the touch responder and starves a scrollable sheet body of its drag gesture. Set `dismissOnBackdropPress={false}` for forced-choice overlays. Don't hand-roll a raw `<Modal>` + backdrop again.
- `MinimizableModal.tsx` — a top-anchored `Modal` whose body collapses to its title bar via a chevron. Use it **whenever the choice being asked for depends on what's behind the overlay** — otherwise the player has to dismiss and reopen to see what they're deciding about. A plain `Modal` is correct when the sheet already contains everything needed.
- `ConfirmModal.tsx` — styled replacement for native `confirm()`. Use for any "are you sure" before a destructive action.
- `Select.tsx` — single-choice select, for when a choice outgrows `SegmentedRow`'s three-or-four-pill ceiling. `value` is `T | null`; `null` renders `placeholder` as a **real option in the list**, so a select whose "off" is a legitimate choice needs no second control.
- `SlidingArea.tsx` — horizontal slide between a fixed set of children selected by `index`; direction follows the sign of the index delta. **Keep-alive**: every pane stays mounted, so each keeps its own state; non-consecutive jumps slide the two panes directly past each other. Width is measured via `onLayout`. Used by the Stats tabs and the game screen's zones — the latter is the non-obvious case (see `lib/game/CLAUDE.md`): every switchable game gets a pane but only the active one has content, because a single `GameProvider` means there's no second game's data to show.
- `Toast.tsx` — brief non-interactive confirmation ("Copied"). Deliberately **not** built on `Modal`: an RN `<Modal>` claims the touch responder for its whole window, so a toast on one would swallow taps for its lifetime. It's an in-tree `pointerEvents="none"` overlay, mounted at the root of the screen it belongs to with a `z` token above what it floats over.
- `Button.tsx`, `Input.tsx`, `Avatar.tsx`, `Tooltip.tsx`, `TabBarIcon.tsx` — the rest of the shared primitives.

## Overlays

Every modal/dialog/panel renders through `Modal.tsx`. Two intentional exceptions: `lib/catan/GameChat.tsx`'s `ChatPanel` (an in-play-area view so it stays inside the board, not a `<Modal>`), and the three Catan animation overlays (`StealAnimation`, `NomadAnimation`, `FortuneTellerAnimation`), which keep a raw `<Modal>` because they're transient, non-dismissible, and drive their own fade timeline.

### Stacking

Anything through `Modal.tsx` is already above everything else (RN's `<Modal>` gets its own native window / web `document.body` portal), so it needs no `zIndex`. In-tree overlays do compete: order them with the `z` scale in `lib/theme.ts` (`playArea` < `floatingButton` < `panel` < `chat`) rather than bare numbers. Non-obvious consequence: the board container carries `z.playArea` only so the panels inside it can overhang the player strip and action bars (its siblings), so anything else mounted at the play-area root that sits over the board (chat scrim, `FinalScoreButton`) must carry a token above it.
