# Color preferences

Players rank the six player colors in Account settings. When a game starts,
every participant's ranking is resolved into a conflict-free color assignment
that is persisted on the game, replacing the current implicit
"seat index → palette index" convention.

## 1. Why this touches the game row

Today a player's color is not stored anywhere — it is derived on the fly as
`playerColors[seatIndex]` at ~26 call sites across 18 components. Seat index is
assigned by `shuffle(participants)` in `handleRespond`, so color follows seat
and nothing can influence it.

Preferences break that coupling: seat 0 may well be green. So the assignment
becomes real data on the `games` row, and the derivation goes away.

## 2. Data model

### 2.1 Color identity

Colors gain stable string ids. **The id order is exactly the current
`catanColors.players` array order**, which makes both the default preference
order and the backfill "the existing convention" for free.

```ts
// lib/catan/colors.ts
export const COLOR_IDS = [
	'red',
	'blue',
	'orange',
	'white',
	'green',
	'brown',
] as const
export type ColorId = (typeof COLOR_IDS)[number]
```

| id       | hex       | current seat |
| -------- | --------- | ------------ |
| `red`    | `#D32F2F` | 0            |
| `blue`   | `#1565C0` | 1            |
| `orange` | `#F57C00` | 2            |
| `white`  | `#FFFFFF` | 3            |
| `green`  | `#43A047` | 4            |
| `brown`  | `#6D4C41` | 5            |

All six are always available — 2-player games draw from the same six as
6-player games. There is no `GameSize` variation here.

### 2.2 Profile column

`profiles.color_prefs jsonb not null default '[]'::jsonb` — an ordered array of
`ColorId`, best first. A personal setting, so it sits beside
`notification_prefs` rather than inside `game_defaults` (which is documented as
per-user defaults for the **create-game form**, and this is not a create-game
field).

Stored as jsonb rather than `text[]` to match `notification_prefs` and because
`parseColorPrefs` treats it as unvalidated input anyway.

`parseColorPrefs(raw): ColorId[]` is the defensive reader, following
`parseGameConfig`'s posture — it keeps known ids in order, drops unknown
entries and duplicates, and returns `[]` for anything that isn't a well-formed
array. **It does not pad.** A short list stays short and the resolver fills the
tail at random.

**An empty `color_prefs` therefore means "no preference" and resolves entirely
at random** — not to the default order. This is a deliberate behavior change,
and it applies to every profile that has never opened the screen, since the
column defaults to `[]`. Today seat 0 is always red; afterwards a table where
nobody has ranked anything gets a fresh random assignment every game.
Historical games are unaffected — they carry backfilled colors on the row (§7).

`PROFILE_COLS` in `useProfileStore` gains `color_prefs`.

### 2.3 Game column

`games.colors text[] not null default '{}'` — parallel to `player_order`, one
entry per seat, in seat order. `colors[i]` is the color of the player at
`player_order[i]`.

A `text[]` here rather than jsonb because it is a flat homogeneous list that
the backfill wants to slice with plain array SQL.

### 2.4 GameState

`colors` joins `GameState` from the `games` row exactly the way `config`
already does — `gameContext.tsx` assembles `gameState` from the two rows, so
`BoardState` becomes `Omit<GameState, 'config' | 'colors'>`.

```ts
// lib/catan/types.ts
export type GameState = {
	// …
	config: GameConfig
	colors: ColorId[]
}
```

`gameContext` runs the raw column through `parseColors(raw, playerCount)`,
which falls back to `DEFAULT_COLOR_ORDER.slice(0, playerCount)` on a missing,
short, or malformed array. That keeps every client correct against a row the
backfill hasn't touched, and means the board can never render a `undefined`
color.

## 3. resolveColorPreferences

Pure, in `lib/catan/colors.ts`, mirrored into the edge function.

```ts
export function resolveColorPreferences(
	prefs: readonly (readonly ColorId[])[],
	rng: () => number = Math.random
): ColorId[]
```

`prefs[seat]` is that seat's ranking; the return value is one distinct `ColorId`
per seat, same length, same order.

Algorithm — the naive depth-first pass:

1. For each depth `d` from 0 to 5:
    - Collect claims: every still-unassigned seat claims `prefs[seat][d]`,
      **skipping the claim entirely if that color is already taken** (they fall
      through to their next choice on the following depth).
    - For each claimed color, assign it to the sole claimant, or to a
      uniformly-random claimant when more than one seat wants it.
2. Any seat still unassigned (empty or exhausted ranking) takes a color from a
   shuffled list of what's left.

A seat can claim at most one color per depth, so no seat can win two colors in
the same pass — no cross-claim guard is needed.

Randomness is injectable so `dev/check-catan-colors.ts` can assert exact
outcomes; production passes `Math.random`.

### Worked example

Three players. A ranks `[blue, red, …]`, B ranks `[blue, orange, …]`, C ranks
`[red, blue, …]`.

- **Depth 0** — A and B both claim blue; C claims red. C gets red outright. Blue
  goes to A or B by coin flip; say B.
- **Depth 1** — A is unassigned, and its depth-1 choice is red, already taken,
  so A claims nothing.
- **Depth 2** — A claims whatever it ranked third, and takes it if free.

Everyone lands on a distinct color, and the only randomness is the contested
blue.

## 4. Where the resolve runs

In `handleRespond`, in the `allAccepted` branch, immediately after
`playerOrder = shuffle(participants)`:

1. Select `id, color_prefs` from `profiles` for the participants (admin client,
   so RLS is not involved and no policy change is needed).
2. Build `prefs` in **`playerOrder` order** — not participants order — via
   `parseColorPrefs`, defaulting any missing profile row to `[]`.
3. `colors = resolveColorPreferences(prefs)`.
4. Include `colors` in the `games` insert.

Resolving at game start (rather than at invite time) means the ranking that
counts is the one in effect when the last invitee accepts. A request can sit
pending for days; preferences edited in that window take effect.

A failed profile read is **not fatal** — every seat falls back to `[]`, which
resolves to a random permutation, so a transient error can't block a game from
starting.

## 5. Consumer refactor

`playerColors[i] ?? playerColors[0]` disappears. `catanColors.players` in
`theme.ts` becomes `Record<ColorId, string>`; `lib/catan/palette.ts` re-exports
it and gains the one lookup:

```ts
export function seatColor(state: GameState, seat: number): string
```

Three groups of consumers:

**a. Already hold `GameState`** (10 files — `BoardView`, `RobberLayer`,
`PlacementLayer`, `GameOverOverlay`, `TradePanel`, `PlayerStrip`,
`ForgerMoveLayer`, `BonusSelection`, `BuildLayer`, `PlayerDetailOverlay`):
swap `playerColors[i]` for `seatColor(state, i)`. No signature change.

**b. Leaf SVG pieces** (`VertexPiece`, `EdgePiece`, `FenceTokenPiece`): their
`player: number` prop becomes `color: string`. Every caller is `BoardView`,
which has the state. These components have no business knowing about seats.

**c. Presentational, no state** (`ActionLog`, `GameChat`, `BuildTradeBar`,
`TradeBanner`, `ForgerPickOverlay`): gain a `seatColors: readonly string[]`
prop. This follows the established path in this codebase — derived per-game
values live in `gameContext`, are re-exposed through `gameScreenContext`, and
are prop-drilled into presentational components, exactly as `publicVP` /
`selfVP` already are. These five do not call `useGame()` today and should not
start.

`useGame()` exposes `seatColors: string[]` (the resolved hex strings, seat
indexed) beside `publicVP`/`selfVP`, for the same stated reason those exist:
one derivation, so nothing can drift.

## 6. Settings UI

### Route

New `app/player-colors.tsx`, registered on the **root** stack in
`app/_layout.tsx` as `<Stack.Screen name="player-colors" />`. Account gets a
"Player colors" row (in a new **Colors** section, between Appearance and
Notifications) that pushes to it.

Root stack rather than a hidden tab route: inside the tab navigator, back
resolves to the navigator's first tab (Games) regardless of who navigated in,
so leaving the screen dropped the viewer out of Account. On the root stack the
push/pop pair is real. `create-game` moved for the same reason at the same time
(a rematch pushed from a game screen has the same problem), and the two share
the root stack's `SUB_SCREEN` options — a slide, where every other root route
fades, because they are the only pushes with a back chevron.

The paths are unchanged (`(app)` is a group), so `router.push('/player-colors')`
still works — and because both routes are now reachable without a history entry
(a web URL, a cold deep link), each back chevron falls back to a `replace` onto
its parent tab.

A pushed screen rather than an inline section: six drag rows and a ScrollView
compete for the vertical gesture, and a full-height screen never needs to
scroll at all.

### Component

`react-native-sortables` v1.10.0, single container:

```tsx
<Sortable.Grid
	columns={1}
	data={order}
	renderItem={renderItem}
	rowGap={spacing.sm}
	customHandle
	onDragEnd={({ data }) => save(data)}
/>
```

Each row is a fixed-height card: rank number, color swatch, color name, grip
handle. The swatch needs a border in both themes — `white` is invisible on the
light card background otherwise.

Two integration notes:

- **`customHandle` + `Sortable.Handle`** is used even without a ScrollView, so
  the grip is the only drag affordance and a stray press on the row does
  nothing.
- `Sortable.PortalProvider` is not needed (no ScrollView, no modal).

`GestureHandlerRootView` is handled by §6.1 — this screen needs no local
wrapper.

### The unset state

Because empty now means random (§2.2), the screen must not present the default
order as though it were saved. With `color_prefs === []`:

- rows render in `DEFAULT_COLOR_ORDER` as a starting arrangement, but **without
  rank numbers**
- a hint reads: _"No preference set — colors are assigned randomly. Drag to
  rank them."_

The first drag persists all six ids in their displayed order, the rank numbers
appear, and the hint is replaced by _"Ties are broken randomly between players
who want the same color."_ Ranking is all-or-nothing by construction: using the
screen produces a full ranking, and never touching it leaves you random. A
partial list is therefore only reachable from legacy or malformed data, which
is exactly the case the random tail in §3 covers.

### Persistence

Reorder writes immediately and optimistically via a new
`updateColorPrefs(order)` on `useProfileStore`, matching how the notification
toggles and `setSpectating` already behave — no Save button, no dirty check
(those rules govern forms; this is direct manipulation). A failed write
surfaces the propagated `error.message` inline and reverts the list.

A "Clear preference" text button writes `[]`, returning the profile to random
assignment and the screen to its unset state. (Not "reset to default" — the
default order is no longer a meaningful saved value.)

## 6.1 Move GestureHandlerRootView to the app root

Currently the only `GestureHandlerRootView` in the app is inside `BoardView`.
That is the per-component workaround, not the documented setup; RNGH and Expo
Router both want a single root wrapper.

- `app/_layout.tsx`: wrap `RootLayout`'s tree in
  `<GestureHandlerRootView style={{ flex: 1 }}>`, **outside** `ThemeProvider`.
  It has to be above `RootNav`'s early `return <LoadingScreen />` so every
  branch is covered.
- `lib/catan/BoardView.tsx`: replace its `GestureHandlerRootView` with a plain
  `View` carrying the **identical** `style={{ flex: 1, width: '100%' }}`. That
  wrapper participates in layout — deleting the element rather than
  substituting it changes how the board sizes.

Landed as its own commit ahead of the feature work, so a board regression is
isolated from everything else here.

## 7. Migration

`supabase/migrations/20260804120000_color_preferences.sql`:

```sql
alter table profiles add column color_prefs jsonb not null default '[]'::jsonb;
alter table games add column colors text[] not null default '{}';

-- Backfill: the previous convention was seat index into the palette order.
update games
set colors = (array['red','blue','orange','white','green','brown'])
             [1:coalesce(array_length(player_order, 1), 0)]
where cardinality(colors) = 0;
```

No RLS changes — both columns are on tables with existing policies, and the
edge function reads `color_prefs` with the service-role client.

Run `npm run migrate`, then `npm run types`.

## 8. Edge function mirror

Per the standing convention in `lib/catan/CLAUDE.md`, `supabase/functions/game-service/index.ts` re-declares:

- `COLOR_IDS`, `DEFAULT_COLOR_ORDER`
- `parseColorPrefs`
- `resolveColorPreferences`

It already has a local `shuffle`. Nothing else in the edge function reads
colors — they are written once at creation and never mutated, so no other
handler is touched.

`npm run edge` is required for this to reach players.

## 9. Verification

- `dev/check-catan-colors.ts` (new), added to the check-script list in
  `lib/catan/CLAUDE.md`. Assertions:
    - output length equals input length; all entries distinct; all valid ids
    - uncontested first choices are always honored
    - a contested color goes to exactly one claimant, and the loser falls
      through to its next _free_ choice
    - a seat with an empty ranking still receives a distinct color, and over
      many seeded runs receives a **spread** of colors — the guard against
      empty quietly collapsing back to default order
    - a partial ranking is honored as far as it goes and random past that
    - identical rankings across 6 players still produce a full permutation
    - seeded rng ⇒ deterministic output
    - `parseColorPrefs` maps `[]`, `null`, garbage, and duplicate-bearing
      input to a valid list, and never pads
- `npm run check` (tsc + deno check + eslint + expo-doctor) and `npm run format`.

**Pre-existing expo-doctor note:** the dependency-validation check already
fails on `main` with 13 out-of-date expo packages. Adding
`react-native-sortables` introduces no new complaint — do not treat that
failure as caused by this work.

## 10. Known risk

On iOS + New Architecture, gesture-handler **2.x** (Expo 57 ships 2.32) can
leave a dragged item stuck after a screen is detached and re-attached —
[react-native-sortables#349](https://github.com/MatiPl01/react-native-sortables/issues/349).
Fixed by gesture-handler 3, which Expo 57 does not ship. A pushed screen is
less exposed than a tab screen, and the trigger is narrow. Not blocking; worth
knowing if a stuck row is ever reported.

## 11. Out of scope

- Per-game color overrides. Preferences are global to the profile.
- Showing a player their color before the game starts.
- Any change to how seat order itself is decided (`shuffle(participants)`
  stays).
