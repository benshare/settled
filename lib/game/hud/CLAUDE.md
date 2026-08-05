# The HUD layout (v1)

The full-bleed-board + floating-HUD alternative to the classic stacked-band
screen. Selected by the `GAME_LAYOUT` dev flag in `lib/flags.ts`; both layouts
mount under the same three providers and read the same `useGameScreen()`, so this
directory is presentation only. Full design in `.claude/specs/game-hud.md`.

```
HudScreen        water frame + one full-screen SlidingArea + fixed HudTopBar
  HudTopBar      FIXED over the slide (never remounts/slides): Games ▾ | ⋯ menu
  SlidingArea
    HudGame      one pane per game — everything that rides the slide:
      BoardArea    reused whole: board, board-blocking overlays, trade banner,
                   bonus pane, confirm bar, bottom-right utility buttons
      PlayerChips  below the top bar: color dot + avatar + VP + cards; the
                   active seat pulses an accent ring
      StatusBanner above the dock: a combined card — turn + roll (top row) over
                   the recent action / what the table waits on
      Dock         bottom: hand (left) + build actions over primary (right),
                   floating with an even margin above the bottom safe area
      + PlayerDetailOverlay, ChatPanel, GameOverOverlay, animations, Toast
```

- `HudTopBar` — the games switcher (left) and overflow menu (right), rendered by
  `HudScreen` **outside** the SlidingArea so they don't remount or travel on a
  switch (they're about *which* game you're on). Both are anchored `Modal`
  dropdowns, not centered sheets; the `⋯` menu is one-tap (Back to games,
  propose/withdraw end game, resign/withdraw, copy debug) with no confirms or
  blurbs, deliberately separate from the classic `GameMenu`. The turn/roll
  indicator is **not** here — it's the top row of the combined `StatusBanner`.

## Rules

- **Every switchable game is a real, live pane — NOT the classic one-content
  trick.** `HudScreen` mounts a full provider stack (`GameProvider` →
  `ChatProvider` → `GameScreenProvider`) + `HudGame` per switchable game, keyed
  by game id at a fixed position; the `SlidingArea` index selects the active one.
  Because both the outgoing and incoming panes hold real content, a switch
  actually slides one game out and the next in (the classic screen's empty panes
  can't — see `ClassicScreen.tsx`). Panes are keep-alive, so no game reloads on a
  switch. The cost is deliberate: N live games (N realtime subscriptions) at
  once.
- **Off-screen panes render, but their `Modal`s do not.** A React Native
  `<Modal>` portals over the whole screen regardless of its parent's opacity, so
  a background game's picker / animation / game-over sheet would appear over the
  one you're viewing. `HudGame`, `BoardArea`, and `Dock` all take an `active`
  prop; when false they still render the board + in-tree chrome (so the pane
  slides with real content) but suppress every portaling overlay. Only in-tree
  overlays (`TradeBanner`, `BonusSelection`, `ConfirmBar`, `ChatPanel`, `Toast`)
  are left ungated — a pane's opacity hides those.
- **The fixed `HudTopBar` reads the route-level providers (the current game);**
  the per-pane stacks are separate. So the current game mounts twice — once for
  the top bar, once as its pane — a cheap redundancy that keeps the bar off the
  per-pane wiring.
- **`BoardArea` is reused whole, not reimplemented.** It already renders the
  board, every board-blocking picker, the trade banner, the bonus-selection
  pane, the confirm bar, and the top-right utility buttons. The HUD only adds
  the new chrome over it.
- **The board layer is inset below `TOP_BAND` and above the measured dock.**
  BoardArea pins its own floating buttons at `top: spacing.sm` of their parent,
  so the board layer is padded down (and up from the dock) to keep those buttons
  clear of the nav's `⋯` and the chips. Padding an RN parent offsets its
  absolutely-positioned children.
- **Island and banner are uniform across viewers.** Both derive from
  `status.ts` and show the same content to everyone, "you" vs. name only. The
  banner is a status summary, never the instruction — the dock (or a picker
  modal) carries the actual affordance. Precedence: live wait > recent action >
  nothing.
- **The chips' dot set is `pendingSeats` (+ trade responders), not
  `current_turn`.** `actingSeats` in `status.ts` lights the seat(s) that owe an
  action now — a 7's discarders, a special-build queue head — which is often not
  the turn-holder.
- **The dock renders nothing for a spectator** (their readout is island +
  banner), and the trade / discard composers replace the hand row rather than
  stacking, since each is composed by tapping the hand.
- **`status.ts` reuses two existing formatters** — `describeEvent` (exported
  from `ActionLog`) for the action line and `pendingSeats` (`timeout.ts`) for
  the waits — rather than duplicating them.
