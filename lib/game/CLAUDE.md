# The game screen

The zones behind one route (`app/game/[id].tsx`), split by **screen zone**
rather than by feature. The rules and the components themselves live in
`lib/catan/` — this directory is only the assembly.

Everything here lives outside `app/` on purpose: Expo Router treats every file
under `app/` as a route and warns about any that has no default export, so
non-route modules for a screen belong in `lib/`.

```
app/game/[id].tsx
           GameDetailScreen()   providers
                                <Nav gameId={id} />        fixed, outside Game
                                <Game />                   no props
           Game()               SlidingArea → TopArea
                                water frame
                                  SlidingArea → BoardArea
                                SlidingArea → BottomArea
                                overlays, animations, ChatPanel
```

- `app/game/[id].tsx` — the shell. Mounts the three providers (`GameProvider` →
  `ChatProvider` → `GameScreenProvider`), owns the **fixed frames** (the
  top/bottom bar backgrounds, the board's water background + edge shadows), and
  wraps each zone in a `ZoneSlide`. Also renders what belongs to no single
  zone: the loading / not-found states, `GameOverOverlay` + `FinalScoreButton`,
  the three event animations, and `ChatPanel` (at the root so it covers the
  action bars but leaves the nav clear — see `lib/catan/CLAUDE.md`).
- `Nav.tsx` — the fixed top row: the back chevron, `GameTitle` (the game
  switcher), and `GameMenu`. Outside every sliding area **and outside
  `<Game>`** on purpose.
- `GameMenu.tsx` — the overflow (`⋯`) menu opposite the back chevron: forfeit
  and end-game, each submittable and withdrawable. It sits in the nav because,
  like the title, it is about _which game you're on_ rather than about what the
  board is waiting for. It lives here rather than in `lib/catan/` — the rest of
  which is rules and board components — because it reads `useGameScreen()`,
  exactly as the zones do. Renders a same-width **spacer** rather than nothing
  when there's nothing to offer (spectator, or a finished game), so the title
  stays centred either way. Its `⋯` carries an accent dot whenever any
  declaration is standing: the sheet is otherwise the only place a pending vote
  exists and nobody would think to open it. Submitting goes through
  `ConfirmModal`; **withdrawing does not** — that's the undo. See the
  forfeiting section of `lib/catan/CLAUDE.md`.
- `gameScreenContext.tsx` — `GameScreenProvider` / `useGameScreen()`. All local
  UI state, every flag derived from the current phase, and one handler per
  store action. This is where a new action or a new piece of screen state goes.
- `TopArea.tsx` — the top menu zone: `PlayerStrip`, the status lines, the
  build/trade bar, and the phase bars that replace it (`RobberStatus`,
  `RoadBuildingStatus`, `SpecialBuildBar`, `DiscardBar`). Owns
  `spectatorStatus()` and `PlacementHeader`. `SpecialBuildBar` carries the
  third `UndoButton` placement, left of **Done building** — a special builder
  builds out of turn, so their arrow can't hang off `MainLoopBar`.
- `BoardArea.tsx` — `BoardView` and the panels/buttons floating over it, plus
  the inline `ConfirmBar`.
- `BottomArea.tsx` — the placement confirm, `MainLoopBar`, `TradePanel`, and
  the viewer's own hand (`ResourceHand` / `DevCardHand` / `KnightTapBar`).
  `MainLoopBar` also shows `DevRollPicker` beside the Roll button for a
  `dev`-flagged seat — see the admin-testing section of `lib/catan/CLAUDE.md`.
  It is the one affordance here that takes props rather than reading the
  context directly, because the bar is already prop-driven; `isDev` gates it by
  passing `onDevRollTotalChange` as `undefined` for everyone else. Renders
  `UndoButton` twice: inside `MainLoopBar` left of **End turn** during `main`,
  and on its own row during `post_placement` (where `MainLoopBar` doesn't
  render at all, so the fencer's tokens and the explorer's roads would
  otherwise have nowhere to hang it). Both are gated on the context's
  `canUndo` — see the undo rule below. It also carries a **third, unrelated**
  arrow, left of the placement confirm: that one is gated on
  `canUndoPlacement` and pops a locally-drafted piece — see the placement rule
  below.
- `gameScreenShared.tsx` — the few things both menu zones render (`DieFaceView`,
  `HonkButton`, `UndoButton`, the bar styles, `isWeb`), so neither has to
  import the other. `UndoButton` lives here rather than with the two bottom-zone
  placements because `SpecialBuildBar` is in `TopArea` — an undoable action can
  be taken from either zone.
- `app/game/request/[id].tsx` — the pending-invite view. Unrelated to the above.

## Rules

- **Zones read `useGameScreen()`; they don't take props.** The screen has ~15
  pieces of local state and ~40 handlers, and affordances move between bars
  often enough that prop chains would be the whole diff. A zone that needs
  something new adds it to the context's return object.
- **The context value is not memoized on purpose.** Every field derives from
  the same `game` / `gameState` pair, so a stable identity would only survive
  renders where nothing changed — and the provider doesn't re-render on those.
- **What slides is content, never a frame.** A zone file renders _only_ the
  travelling content; its background lives on the `ZoneSlide` container in the
  shell. Translating the frames too drags the backgrounds off with them and the
  screen reads as scrolling sideways.
- **The tab strip must navigate with `router.setParams`, not `router.replace`.**
  `REPLACE` gives the route a fresh key, so React Navigation unmounts and
  remounts this entire screen — providers, zones, sliding areas and all — on
  every tab tap. Nothing here can animate a switch it doesn't survive. See
  `lib/catan/GameTitle.tsx`.
- **Nothing under the nav is parameterized by `gameId`.** `<Game>` takes no
  props and reads everything from the context, so a switch doesn't re-render
  the component that owns the sliding areas. `Nav` is the exception and is
  therefore hoisted above it — it is the one thing on screen that is _about_
  which game you're on.
- **`ZoneSlide` gives every switchable game a pane but content only to the
  active one.** A single `GameProvider` swaps its state under one tree
  (`lib/catan/gameContext.tsx`), so there is no second game's data to render
  and a retained copy would immediately re-render as the _new_ game. The empty
  panes exist to give `SlidingArea` something to cross with, and the direction
  falls out of the tab delta (`gameTabIndex` / `gameTabCount` on the context,
  keyed off `useSwitchableGames()`). One game → one pane → a no-op. The content
  pane carries a **fixed key** (`"zone"`), not its positional one, so moving it
  from tab i to tab j moves the zone rather than unmounting it and mounting a
  fresh copy — otherwise every switch would discard the zone's own state and
  leave the slide animating a remount.
- **No zone clips.** `SlidingArea` defaults to `overflow: 'hidden'`; every zone
  overrides it to `visible` via `styles.zone`. Each zone spans the full width
  so the screen's edges do the clipping, and the build bar's tooltips and
  cancel badges deliberately render outside their bar.
- **An overlay lives with what opens it, not with what it covers.** The build
  bar's pickers are in `TopArea`, the pre-roll bonus modals are in
  `BottomArea`, the board-blocking phase pickers are in `BoardArea`. All of
  them are `Modal`-based (`lib/modules/Modal.tsx` → RN `Modal`, which portals
  out of the tree on web too), so where they sit in the JSX has no layout
  consequence — only a legibility one.
- **A zone early-returns on `!game`.** The shell already gates on it, but the
  guard is what narrows the type for the rest of the file.
- **An event-driven animation's cursor is tagged with its game.** The steal,
  nomad and fortune-teller animations fire on events that appear past a
  remembered position in `games.events`. The provider survives a tab switch, so
  a bare count carries into the next game and everything past it in that game's
  log reads as newly arrived — the whole game's animations replay in sequence
  the moment it loads. Each cursor is an `EventCursor` (`{ gameId, count }`)
  compared against `game.id`, and a mismatch re-seeds the cursor and drops any
  queued animation rather than emitting one. Compare against **`game.id`, not
  the `gameId` prop**: `useGame()` serves the outgoing game's row for one render
  after the param changes, and a cursor re-seeded on that render would be
  measuring the old log.
- **A placement turn is drafted locally, so `phase.step` is not the stage.**
  `placementDraft` accumulates a settlement, its road, and — for the seat that
  places both back-to-back — a second pair, and only the confirm sends
  anything (`place_start`). `placementStage` on the context is what every
  placement affordance reads: the server's `step` stays `'settlement'` for the
  whole turn, so reading it instead shows the wrong instruction from the second
  tap onwards. The one thing `step` still decides is **which flow is running** —
  `placementDrafting` — because a game left mid-turn by an older client or by
  the timeout sweep sits at `'road'` and takes the old one-piece-per-confirm
  path through `selection`. The stage alone can't tell those apart: a legacy
  `road` step and the drafting road stage read the same.
- **The placement arrow is not the undo arrow.** `canUndoPlacement` pops the
  last drafted piece — pure local state, nothing has reached the server. It has
  no relationship to `canUndo` / `gameState.undo` below, and placement is not
  an undoable action.
- **`canUndo` is read off `gameState.undo`, never derived from the event log.**
  The edge function stashes a pre-action snapshot on `game_states.undo` for the
  actions it considers undoable, and that column _is_ the availability signal —
  reconstructing "was my last action a build?" from `games.events` would drift
  from the server's rule the moment an action mutates state without logging an
  event. The context adds only what the server can't see: the viewer's seat,
  spectator status, and a phase test for whether this seat currently holds the
  floor. That last one is **not** `isMyActiveTurn` everywhere — during
  `special_build` the acting builder is `phase.queue[0]`, not `current_turn`
  (which has already advanced to the next roller), so the gate reads
  `isMySpecialBuild` there. Gating the whole thing on the turn-holder is what
  made a special builder's road un-undoable while the server was happily
  snapshotting it. See `.claude/specs/undo.md`.
