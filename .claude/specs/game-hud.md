# Game HUD (v1)

A reimagining of the game screen (`app/game/[id].tsx`) from a stacked-band
layout into a **full-bleed board with a floating HUD**. The board is the star;
chrome is expandable rather than always-open. Shipped **behind a feature flag
alongside the existing screen** (no deletion) so the two can be A/B tested
before a replacement.

Scope is deliberately **self-contained: no changes to stores, the edge
function, game rules, or the realtime/data layer.** The HUD is a new
presentational tree over the *same* providers the classic screen uses.

---

## 1. Feature flag

- **A development-only flag, not a shipped user setting.** A single module
  constant in `lib/flags.ts`: `export const GAME_LAYOUT: 'classic' | 'hud' =
  'classic'`. Flip it in code to preview the HUD; fast-refresh swaps the layout
  in place without dropping the route.
- No persistence, no UI, no store touch. (A runtime dev toggle can be added
  later if side-by-side comparison of a live game proves useful — out of scope
  for v1.)

## 2. The screen split

`app/game/[id].tsx` becomes a thin switch. The three providers are **shared** by
both layouts — `GameProvider` (data) → `ChatProvider` (chat) →
`GameScreenProvider` (UI state + ~40 handlers). Both layouts consume
`useGameScreen()`; nothing about that context is layout-specific, so the HUD
reuses every derived flag and handler as-is.

```
GameDetailScreen()
  SafeAreaView
    GameProvider → ChatProvider → GameScreenProvider
      layout === 'hud' ? <HudScreen/> : <ClassicScreen/>
```

- The current `Game()` / `ZoneSlide` / styles in `[id].tsx` are extracted
  verbatim into `lib/game/ClassicScreen.tsx` (behaviour identical — pure move).
- The HUD assembly lives in a new `lib/game/hud/` directory.

## 3. HUD composition — frame vs. content

Top-to-bottom, per the agreed structural model:

```
[ water background + Nav ]                      ← FIXED frame (never slides)
[ full-screen transparent SlidingArea ]         ← lays panes out horizontally
   [ one pane per switchable game ]             ← only the active pane has content
      HudGame()                                 ← ALL floating components:
        BoardView                (full bleed)
        DynamicIsland            (top center)
        PlayerChips              (below island)
        StatusBanner             (above dock)
        UtilityRail              (right edge)
        Dock                     (bottom: hand | actions)
        overlays / pickers / animations / game-over / confirm bar (reused)
```

- **The only fixed elements are the water background and the Nav.** Everything
  else — board content, island, chips, banner, rail, dock — rides inside the
  sliding pane, so a game switch animates the whole HUD in one translate. The
  blue water does not reload; the Nav dropdown does not reload.
- **Sliding mechanism is the existing `ZoneSlide` trick, unified into one area.**
  A single content pane carries a fixed key (`"zone"`) and is *moved* to the
  active tab index rather than remounted, so the HUD's own local state survives
  a switch and `SlidingArea` has something to translate. Direction falls out of
  the tab delta (`gameTabIndex` / `gameTabCount`, keyed off
  `useSwitchableGames()`). One game → one pane → a no-op. (Today this is three
  separate zone-slides; the HUD collapses them into one.)
- Empty panes for the other games give the slide something to cross against —
  same as today; a single `GameProvider` swaps state under one tree, so there is
  never a second game's data to render.

## 4. Nav (fixed)

- Collapsed state: a single **chevron-down** chip (top-left), plus the `⋯`
  overflow menu (`GameMenu`, reused) top-right.
- Expanded: a dropdown listing the viewer's **active + actively-watched games**
  (`useSwitchableGames()`), each row = opponent avatars + label + a turn dot,
  with **"Back to Games"** pinned at the bottom (routes to `/games`).
- Selecting a game navigates with `router.setParams({ id })` — **never
  `router.replace`** — so the screen (and its providers) survive the switch and
  the slide can animate. Same rule as today's `GameTitle`.
- Cross-game turn dots in the dropdown use `games.current_turn` (the only turn
  field available without loading each game's `game_states`) — approximate, and
  the same source the Games list already uses.

## 5. Dynamic island (top center)

- Stable, non-expanding. Shows the **current turn** ("Your turn" / "Bea's turn")
  plus **the turn's roll** as dice faces.
- Omits the dice when there is no roll yet (roll phase, initial placement); still
  names the current turn. During other players' turns it shows *that* turn's most
  recent roll alongside their name.
- **Uniform across all viewers** — same content for everyone, "you" vs. name
  substitution only (same rule as the banner, §6).
- Status / instructions do **not** live here — that is the banner's job.
- Fixed warm palette (dark parchment pill), theme-independent, since it floats
  over the always-blue water.

## 6. Status banner (above the dock)

A single always-current line: the most recent action, or what the table is
waiting on. **One line of text; the turn dot is a separate set** (see §7).

- **Uniform across all viewers.** The island and the banner show the *same
  content to everyone*, differing only in "you" vs. the player's name. The
  banner is a **status summary, not a per-viewer instruction** — the actual "do
  this now" affordance lives in the dock (the `DiscardPanel` composer, the
  `TradeBanner` response UI, a picker modal). So on a 7 everyone reads "Waiting
  for {names} to discard" (the ower sees "you" in the list); the ower *also*
  gets the discard composer in their dock.
- **Precedence:** live pending-wait > most-recent completed action > nothing.
  When any seat is pending, the wait line wins; a bare roll with nothing pending
  shows no banner. **All non-roll actions are shown, including the viewer's own.**
- **Waiting text** derives from `pendingSeats(phase, currentTurn)` (already in
  `timeout.ts`) — plus the open `TradeOffer`'s responders, the one wait that
  lives outside the phase machine (during `main`, a proposal is owed by its
  addressees, then in confirm-mode flips back to the proposer).
- **Action text** derives from the latest meaningful `games.events` entry via
  `describeEvent` (ActionLog's formatter). Bare rolls are suppressed.
- **Parallel-heterogeneous phases** (`post_placement`, `select_bonus`) can have
  different players owing different actions at once. The banner **generalizes**
  ("Setting up bonuses — waiting on Bea, Cy"); each viewer's own required action
  is surfaced by the dock / a modal, not the banner.
- **Factoring:** the two phrasings already exist as `describeEvent` (ActionLog)
  and `spectatorStatus` (TopArea). Extract them into a shared helper both the
  banner and the existing surfaces can call, rather than duplicating.

## 7. Turn-dot precision

- **In-game (player chips):** "whose action is it" = `pendingSeats(phase)` ∪
  trade responders. This fixes the class of bugs where player A keeps the cue
  while player B must act (7-discards during A's turn; `special_build` queue
  head vs `current_turn`). The dot is a **set** — multiple seats can be lit.
- **Cross-game (nav dropdown, Games list):** stays `current_turn` — data
  availability, not choice. Documented asymmetry; **Games-list / `GameTitle`
  dots are out of scope for v1** (shared surfaces).

## 8. Player chips (below the island)

- Compact: avatar + VP (+ card count). The pending seat(s) highlighted (§7).
- **Layout:** ≤4 players → one centered row; 5–6 → two centered rows.
- **Tap → full detail**, reusing `PlayerDetailOverlay`. Temporary board
  occlusion is acceptable — it's a deliberate peek.

## 9. Utility rail (right edge)

- Vertical stack of expandable buttons, reusing the existing floating
  components: **costs** (`BoardLegend`), **log** (`ActionLog`), **chat**
  (`ChatButton` + its badge), **spectators** (`WatcherButton`), and
  **stop-watching** (`StopWatchingButton`, spectator-only).
- Part of the sliding pane (everything but Nav slides). Within a game the
  buttons don't reload; opening a panel reads the current game's data — same as
  today.

## 10. Dock (bottom) — v1 left/right split

- **Left column: your hand.** `ResourceHand` (via `displayHand` for reveal
  holds) + `DevCardHand` + the veteran `KnightTapBar`. The trade / discard
  composers (`TradePanel` / `DiscardPanel`) **replace** the hand here, exactly as
  today (the give / discard side is composed by tapping the hand).
- **Right column: the active actions.**
  - **Main phase:** build tools at top (road / settlement / city, plus the
    bonus builds that apply to this seat — super city, carpenter VP, accountant,
    invest, buy dev card), the **Trade** button, then **End turn** below.
  - **Roll phase:** Roll (plus gambler Confirm / Reroll, ritual-roll /
    shepherd-swap, and the dev roll picker for `dev` seats). Build/trade are
    hidden, so the right column **may take over the freed space** for these.
  - **Placement:** the placement confirm + local undo occupy the right column;
    `MainLoopBar` does not render.
- Compact styling throughout (the whole point of the redesign is reclaiming the
  two fat action bars).
- **Open:** the left column's content during initial placement (the round-1 hand
  is empty) — likely instructions or simply the (empty) hand.

## 11. Reuse map

Reused **unchanged** (data + rules + most components):

- Providers: `GameProvider`, `ChatProvider`, `GameScreenProvider`.
- Board + interactions: `BoardView` and its `interaction` / `build` / `robber` /
  `forgerMove` props.
- Floating panels: `BoardLegend`, `ActionLog`, `GameChat` (`ChatButton` /
  `ChatPanel`), `Watchers`.
- Player detail: `PlayerDetailOverlay`.
- Hand + composers: `ResourceHand`, `DevCardHand`, `KnightTapBar`, `TradePanel`,
  `DiscardPanel`.
- All board-blocking pickers/overlays (scout / curio / forger / magician /
  metropolitan / fence / bonus selection / ritual / shepherd / etc.).
- Event animations (steal / nomad / fortune-teller), `GameOverOverlay` +
  `FinalScoreButton`, the inline `ConfirmBar`, the `Toast` layer.

New components (in `lib/game/hud/`):

- `HudScreen` — the shell (fixed frame + one `SlidingArea`).
- `HudGame` — the per-pane assembly of all floating components.
- `DynamicIsland`, `StatusBanner`, `PlayerChips`, `UtilityRail`, `Dock`.
- A shared status helper factored from `describeEvent` + `spectatorStatus`, and
  a `pendingSeats`-based "whose action" derivation for the chips' dots.

## 12. Out of scope for v1

- Deleting or modifying the classic screen (beyond the pure `ClassicScreen`
  extraction).
- Cross-game dot precision (Games list / `GameTitle`).
- Any store, edge-function, rules, or realtime change.

## 13. Resolved decisions

1. Flag is **development-only** — a `lib/flags.ts` constant, no account UI (§1).
2. Banner shows **all** non-roll actions, including the viewer's own (§6).
3. Placement dock left column just shows the (empty) hand — no special state
   (§10).
4. Island shows the current turn's most recent roll during other players' turns,
   and island + banner are **uniform across all viewers** (§5, §6).
