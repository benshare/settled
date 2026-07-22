# Games tab (merge Play + History) + Stats placeholder

Branch: `games-tab`, off `spectating`.

## Goal

Collapse the `Play` and `History` tabs into a single `Games` tab, with history
demoted to a collapsible section at the bottom of that screen. Reuse the freed
tab slot for a `Stats` tab, stubbed as "Coming soon" for now.

## Tab bar

Final order: **Games, Stats, Friends, Account**.

- `app/(app)/play.tsx` → `app/(app)/games.tsx` (git mv; keeps history in the
  file). Component renamed `PlayScreen` → `GamesScreen`.
- `app/(app)/history.tsx` deleted — its complete-games list moves into the
  Games screen; nothing else it renders is unique (Pending/Active already
  exist on Play).
- New `app/(app)/stats.tsx`.
- `_layout.tsx`: `unstable_settings.initialRouteName = 'games'`; `Tabs.Screen`
  entries reordered as above. `PlayTabIcon` → `GamesTabIcon` (same
  `game-controller-outline` icon + invite dot logic). Stats tab icon:
  `stats-chart-outline` (plain `Ionicons`, no dot).

### Route references to update (`/play` → `/games`)

- `app/index.tsx` — `/(app)/play` redirect
- `app/(auth)/login.tsx` (x2), `app/(auth)/verify.tsx`,
  `app/(auth)/set-username.tsx` — post-auth `replace`
- `app/(app)/create-game.tsx` — `router.replace('/play')`
- `app/game/[id].tsx` — `onBackToGames`
- `lib/notifications/links.ts` — three `/play` fallbacks

## Games screen

Header stays as today: title (now **"Games"**) + `+` button to `/create-game`.

Sections, top to bottom:

1. `Invites` — unchanged (`PendingRow`).
2. `Active` — unchanged (`GameRow`).
3. `Watch` — unchanged (`SpectateRow`, from the spectating branch).
4. **`History`** — new, collapsible, **collapsed by default**. Contains
   **completed games only** (`completeGames` from `useGamesStore`); pending and
   active are already above.

### History section

- Header is a `Pressable` row reusing the existing `sectionHeading` style, with
  a trailing `chevron-forward` / `chevron-down` (`colors.textMuted`) indicating
  state. Local `useState(false)` for expansion — not persisted.
- Rendered only when `completeGames.length > 0`; no empty-state text of its own.
- Rows: the old `GameHistoryRow` from `history.tsx` — participant names (`me`
  for self) as the primary line, `formatDate(game.created_at)` as a muted
  secondary line, chevron on the right. `formatDate` moves over with it.
  Tapping pushes `/game/${id}`.
- Expand/collapse is a plain conditional render (no animation). Rows sit inside
  the section's existing `gap`.

### Loading / empty state

`storeLoaded` gains `completeGames !== undefined`. The
"No games yet. Tap + to start one." empty state additionally requires
`completeGames.length === 0` — a user with only finished games shouldn't be
told they have none.

## Stats screen

`app/(app)/stats.tsx` — `SafeAreaView` + `ScrollView` matching the other tabs,
title "Stats", and centered muted "Coming soon." text (same `emptyText`
treatment used elsewhere). No store reads.

## Docs

No `CLAUDE.md` under `app/`; `lib/` docs are unaffected by this change.

## Out of scope

- Any actual stats content.
- Changing what `useGamesStore` loads or how.
