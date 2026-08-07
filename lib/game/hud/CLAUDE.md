# The HUD layout (v1)

The full-bleed-board + floating-HUD alternative to the classic stacked-band
screen. Selected by the persisted `useGameLayout()` preference
(`lib/GameLayoutContext.tsx`, defaults to HUD, toggled from either overflow
menu). Both layouts mount under the same three providers and read the same
`useGameScreen()`, so this directory is presentation only. Full design in
`.claude/specs/game-hud.md`.

```
HudScreen        water frame + one full-screen SlidingArea + fixed HudTopBar
  HudTopBar      FIXED over the slide: Games ▾ | ⋯ menu
  SlidingArea
    HudGame      one pane per game — everything that rides the slide:
      BoardArea    reused whole (board, board-blocking overlays, trade banner,
                   bonus pane, confirm bar, utility buttons)
      PlayerChips  color dot + avatar + VP + cards; active seat pulses
      StatusBanner turn + roll over recent-action / what-the-table-waits-on
      Dock         hand + build/trade + primary-action, floating above the
                   bottom safe area
      + PlayerDetailOverlay, ChatPanel, GameOverOverlay, animations, Toast
```

## Rules

- **Every switchable game is a real, live pane — NOT the classic one-content
  trick.** `HudScreen` mounts a full provider stack + `HudGame` per switchable
  game, so a switch actually slides one game out and the next in (the classic
  screen's empty panes can't — see `ClassicScreen.tsx`). Panes are keep-alive.
  The cost is deliberate: N live games = N realtime subscriptions at once.
- **Off-screen panes render, but their `Modal`s do not.** An RN `<Modal>`
  portals over the whole screen regardless of parent opacity, so a background
  game's picker would appear over the one you're viewing. `HudGame`, `BoardArea`
  and `Dock` take an `active` prop; when false they render the in-tree content
  (so the pane still slides) but suppress every portaling overlay. In-tree
  overlays are left ungated — a pane's opacity hides those.
- **The fixed `HudTopBar` reads the route-level providers (the current game),**
  so the current game mounts twice — a cheap redundancy that keeps the bar off
  the per-pane wiring. The one thing it can't read that way is **chat open**
  (opened against a pane's own `ChatProvider`); `HudScreen` mounts a
  `ChatOpenReporter` inside the **active** pane to lift that flag up to the bar's
  fade, mounted only for the active pane so a switch clears it cleanly.
- **Island and banner are uniform across viewers** — both derive from
  `status.ts`, "you" vs. name only. The banner is a status summary, never the
  instruction (the dock or a picker carries the affordance); precedence is live
  wait > the turn's own line on `roll` / `initial_placement` > the most recent
  action **of the open turn** > nothing. The recent-action scan stops at the
  boundary that opened the turn (`turn_ended` / `placement_complete`) — reaching
  past it narrated the previous seat's last build to a player who had only just
  rolled. The **initial-placement line is the one exception to uniformity**: it
  names the piece the seat owes (settlement / road / ready to confirm) from
  `placementStage`, which is a local draft — a watching viewer has no draft and
  so sees the phase-level "settlement". It **doesn't render during bonus selection**
  for a seated viewer — the bonus pane owns the screen and already names who
  it's waiting on. A spectator has no pane, so they keep it.
- **The banner is mounted inside the board layer, not beside it.** It shares its
  line with the board's utility buttons and the log / legend panels those open,
  which expand upward over it — and `zIndex` only orders siblings, so the panels
  could never win from inside `boardFill` while the banner sat outside it. It
  renders as a last child of `boardFill` at `z.banner` (over the board, under
  `z.floatingButton` / `z.panel`).
- **The honk button and the undo arrow are the banner's interactive parts, and
  they share one slot.** Both are about the line the banner is showing — a honk
  is a complaint that the table is sitting on it, an undo takes back the action
  it reports — rather than about your own turn, which is what the dock is for.
  They can't both apply (you honk only at someone else, undo only your own
  move), so neither reserves space. Both break the banner's uniformity: each
  renders only for the viewer it applies to. The dock keeps its _placement_
  arrow, which pops a locally drafted piece and belongs beside the confirm it
  feeds.
- **The chips' dot set is `pendingSeats` (+ trade responders), not
  `current_turn`** (`actingSeats` in `status.ts`) — the seats that owe an action
  now, often not the turn-holder.
- **The dock renders nothing for a spectator** (their readout is island +
  banner); the trade / discard composers replace the hand row rather than
  stacking, since each is composed by tapping the hand.
- `status.ts` reuses `describeEvent` (from `ActionLog`) and `pendingSeats`
  (`timeout.ts`) rather than duplicating them.
