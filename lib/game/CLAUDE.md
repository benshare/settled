# The game screen

The zones behind one route (`app/game/[id].tsx`), split by **screen zone**
rather than by feature. The rules and the components themselves live in
`lib/catan/`; this directory is only the assembly. Everything here lives outside
`app/` because Expo Router warns about any file under `app/` with no default
export.

```
app/game/[id].tsx
           GameDetailScreen()   providers
                                <Nav gameId={id} />        fixed, outside Game
                                <Game />                   no props
           Game()               SlidingArea → TopArea
                                water frame → SlidingArea → BoardArea
                                SlidingArea → BottomArea
                                overlays, animations, ChatPanel
```

- `app/game/[id].tsx` — the shell. Mounts the three providers (`GameProvider` →
  `ChatProvider` → `GameScreenProvider`), owns the **fixed frames** (bar
  backgrounds, board water + edge shadows), wraps each zone in a `ZoneSlide`, and
  renders what belongs to no single zone: loading/not-found, `GameOverOverlay`,
  the event animations, `ChatPanel` (at the root so it can span every zone), and
  the `Toast` layer (raised from the nav's `GameMenu` but rendered here because it
  floats over every zone).
- `Nav.tsx` / `GameMenu.tsx` — the fixed top row (back chevron, `GameTitle`
  switcher, overflow menu). It fades out under an open chat panel, which now runs
  the full height of the screen — the HUD's top bar does the same.
  Outside every sliding area **and outside `<Game>`**
  because it's the one thing on screen that's about _which_ game you're on. The
  `⋯` menu holds forfeit / end-game (each submittable and withdrawable) and Copy
  debugging info; it carries an accent dot whenever a declaration is standing.
- `gameScreenContext.tsx` — `GameScreenProvider` / `useGameScreen()`: all local
  UI state, every phase-derived flag, and one handler per store action. New
  screen state or actions go here.
- `TopArea.tsx` — the top zone: `PlayerStrip`, status lines, the build/trade bar
  and the phase bars that replace it. Owns `spectatorStatus()` and
  `PlacementHeader`.
- `BoardArea.tsx` — `BoardView` and the panels/buttons floating over it, plus the
  inline `ConfirmBar`.
- `BottomArea.tsx` — the placement confirm, `MainLoopBar`, `TradePanel`, and the
  viewer's own hand. `TradePanel` and `DiscardPanel` each **replace** the hand
  rather than being a bar of their own, because both are composed by tapping the
  hand itself — the composer has to be where the hand is. `DiscardPanel` reads
  the live hand, not `displayHand`, so a reveal animation can't hide a card from
  the picker.
- `gameScreenShared.tsx` — the few things both menu zones render (`DieFaceView`,
  `HonkButton`, `UndoButton`, bar styles), so neither imports the other.
- `app/game/request/[id].tsx` — the pending-invite view. Unrelated to the above.

## Rules

- **Zones read `useGameScreen()`; they don't take props.** The screen has ~15
  pieces of local state and ~40 handlers, and affordances move between bars often
  enough that prop chains would be the whole diff. The context value is
  deliberately **not memoized** — every field derives from the same
  `game`/`gameState` pair, so a stable identity would only survive renders that
  don't happen anyway.
- **What slides is content, never a frame.** A zone renders only the travelling
  content; its background lives on the `ZoneSlide` container in the shell.
  Translating the frames too drags the backgrounds off and the screen reads as
  scrolling sideways.
- **The tab strip navigates with `router.setParams`, not `router.replace`.**
  `REPLACE` gives the route a fresh key, remounting this whole screen — providers,
  zones and all — on every tab tap; nothing here can animate a switch it doesn't
  survive. So `<Game>` takes no props and reads everything from context (a switch
  doesn't re-render the slider owner), and `Nav` is hoisted above it as the
  exception. See `lib/catan/GameTitle.tsx`.
- **`ZoneSlide` gives every switchable game a pane but content only to the active
  one.** A single `GameProvider` swaps its state under one tree, so there's no
  second game's data to render; the empty panes exist only to give `SlidingArea`
  something to cross with, and the direction falls out of the tab delta. The
  content pane carries a **fixed key** (`"zone"`) so moving it between tab
  positions moves the zone rather than unmounting and remounting it.
- **No zone clips**: `SlidingArea` defaults to `overflow: hidden`; zones override
  to `visible` so the build bar's tooltips and cancel badges can render outside
  their bar, letting the screen's edges do the clipping.
- **An overlay lives with what opens it, not with what it covers.** All screen
  overlays are `Modal`-based (which portals out of the tree), so where they sit in
  the JSX is a legibility choice, not a layout one.
- **An event-driven animation's cursor is tagged with its game.** The steal,
  nomad and fortune-teller animations fire on events past a remembered position in
  `games.events`. The provider survives a tab switch, so a bare count would carry
  into the next game and replay its whole log; each cursor is an `EventCursor`
  (`{ gameId, count }`) compared against **`game.id`** (not the `gameId` prop,
  which lags one render on a switch). A `games` row arriving without its `events`
  column would also read as a rewound log — that's kept out of the context
  entirely via `isPartialGameRow` (see `lib/stores/CLAUDE.md`).
- **A reveal animation holds the viewer's hand, it does not delay the state.** The
  steal/nomad/fortune-teller animations fire _after_ the resource reaches the hand
  (the steal one recovers which resource by diffing the hand). Each registers the
  pre-animation hand in `heldHands`, and `displayHand` renders that until the
  animation dismisses. **The bottom bar's fanned `ResourceHand` is the only
  surface that takes `displayHand`** — everything else (affordability, build
  enablement, trade) reads the live `myHand`, so a hold can never disable a build
  the player can actually make. Delaying the write server-side isn't the
  alternative: `game_states` is authoritative and the steal animation needs the
  applied state to exist.
- **A placement turn is drafted locally, so `phase.step` is not the stage.**
  `placementDraft` accumulates the pieces and only the confirm sends anything
  (`place_start`); `placementStage` on the context is what every placement
  affordance reads, since the server's `step` stays `'settlement'` for the whole
  turn. The placement arrow (`canUndoPlacement`, pops a drafted piece) is **not**
  the undo arrow (`canUndo`) — placement isn't an undoable action.
- **`canUndo` is read off `gameState.undo`, never derived from the event log.**
  The edge function stashes a pre-action snapshot there for undoable actions, and
  that column _is_ the availability signal. The context adds only what the server
  can't see (viewer seat, spectator status, and whether this seat holds the
  floor) — which during `special_build` is `phase.queue[0]`, not `current_turn`,
  so the gate reads `isMySpecialBuild` there. See `.claude/specs/undo.md`.
