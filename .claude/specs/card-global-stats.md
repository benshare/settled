# Global card stats

Branch: `card-global-stats`, off `main`.

Every card in the **Bonuses & curses catalog** (`app/(app)/stats.tsx`, the
second tab) gains a footer of **global** play numbers — win rate, average
points, pick rate — measured across every player's completed games, not just
the reader's.

This is the first thing in the app that shows an aggregate over other people's
games, which is the whole design problem: `game_results` is readable only for
games you sat at. Everything below follows from that.

## 1. Scope decisions (settled)

- **Per table size.** The catalog already re-describes each card for the
  selected size (2p / 3-4p / 5-6p), so the numbers follow the selector: a card
  retuned at 2 players is not averaged with its 3-4 player version. Samples
  split three ways; the sample size is always printed so a thin bucket reads as
  thin.
    > **Superseded** by [card-stats-filter](./card-stats-filter.md): splitting a
    > sample this small three ways left most cards reading "No games yet". The
    > single-select became a filter menu of checkboxes, all checked by default,
    > and the numbers are summed over whatever is checked. Card text no longer
    > follows the filter at all.
- **Catalog cards only.** Not the in-game `BonusSelection` cards, not
  `PlayerDetailOverlay`.
- **No minimum sample.** A card with three recorded games shows its rate and
  says "3 games" underneath — the same convention the Stats tab already uses
  for its own superlatives.

## 2. Where the numbers come from

`game_results` (one row per game per seated player) already carries everything
needed: `bonus`, `curse`, `offered_bonuses`, `offered_curses`, `won`, `points`,
`forfeit`, `player_count`. Nothing new is recorded, and the edge function is
untouched.

What's missing is **reach**: the table's only select policy is
`game_results_select_participant`, so a client can never see a row from a game
it wasn't in. Rather than widen that policy (which would expose other people's
individual scores), a new **aggregate view** exposes counts only.

### `public.card_stats` view (new migration)

`supabase/migrations/20260806130000_card_stats.sql`. One row per
`(kind, card_id, size)`, only for combinations that have actually occurred:

| column         | type   | notes                                                  |
| -------------- | ------ | ------------------------------------------------------ |
| `kind`         | text   | `'bonus'` \| `'curse'`                                 |
| `card_id`      | text   | `BonusId` / `CurseId`                                  |
| `size`         | text   | `'small'` \| `'standard'` \| `'expanded'`              |
| `games`        | bigint | rows where this card was played                        |
| `wins`         | bigint | of those, `won`                                        |
| `played_games` | bigint | of those, `not forfeit` — the denominator for points   |
| `points_sum`   | bigint | summed `points` over the non-forfeit rows              |
| `offers`       | bigint | rows where the card appeared in a **multi-card** offer |
| `keeps`        | bigint | of those offers, the ones where it was the card kept   |

Rates are left to the client (`wins / games`, `points_sum / played_games`,
`keeps / offers`) so the view stays integer-only and a zero denominator is a
UI decision rather than a `null` from SQL.

Four rules baked into the SQL, each mirroring an existing convention:

- **`size` is `gameSizeFor(player_count)` re-expressed in SQL**
  (`<= 2 → small`, `>= 5 → expanded`, else `standard`). A third mirror of a
  rules function, in the spirit of the edge-function duplication — noted in
  `lib/catan/CLAUDE.md`.
- **Forfeited games count toward games and wins, never toward points**, exactly
  as `lib/stats.ts` treats the reader's own history (`Stats.playedGames`).
  Canceled games write no rows at all, so they need no exclusion.
- **A single-card offer is not a pick.** `offers` / `keeps` only count rows
  whose `offered_bonuses` / `offered_curses` array has **2 or more** entries —
  a card nobody could decline would otherwise read as 100% picked. Legacy rows
  (null arrays, from before offers were recorded) contribute nothing.
- **Dev profiles are excluded.** The view joins `profiles` and drops
  `dev = true` rows. Dev and production share one database, so without this a
  seeded test game would move a real global number. This is the aggregate
  analogue of the "filter dev profiles from searches" rule in
  `lib/stores/CLAUDE.md`; it means a dev build sees no numbers from its own
  test games, which is correct.

Access:

```sql
create view public.card_stats with (security_invoker = false) as …
```

`security_invoker = false` (the Postgres default, stated explicitly because it
is the point) runs the view as its owner, so the underlying RLS on
`game_results` does not filter it. That is safe **only because every column is
a count**: no game id, no user id, no individual score leaves the database.
`grant select on public.card_stats to authenticated` — anon gets nothing.

No index work: `game_results` is small and the view is read once per Stats-tab
visit. If it ever isn't, the fix is a materialized view refreshed on
completion, not a schema change.

Run `npm run migrate`, then `npm run types` to regenerate
`lib/database-types.ts` (views land in `Database['public']['Views']`).

## 3. Store

`useStatsStore` gains a second slice rather than a new store — same screen,
same table lineage, one registration:

- `cardStats: CardStatRow[] | undefined` (undefined = loading) and the existing
  `error` string, shared.
- `loadForUser` fires both queries with `Promise.all`. A failure of either
  settles its own slice (`[]`) and sets `error`; the personal stats must not
  disappear because the global view failed, and vice versa.
- `clear()` clears both. The card stats aren't user-scoped, but dropping them
  on sign-out costs one query and keeps the store's contract uniform.
- No realtime channel, for the reason already documented for this store.

`CardStatRow` is derived from
`Database['public']['Views']['card_stats']['Row']`, with `kind` / `size`
narrowed to their unions and the count columns narrowed to `number` (PostgREST
returns `bigint` aggregates as numbers; the generated type is `number | null`
because a view column is nullable to Postgres — narrow once here, in the store,
so nothing downstream carries the nulls).

## 4. Pure aggregation — `lib/stats.ts`

Two additions, both pure and checked by `dev/check-stats.ts`:

```ts
export type CardStat = {
	games: number
	winRate: number
	// Null when every recorded game of this card was a forfeit — there is no
	// meaningful score in one.
	avgPoints: number | null
	pointsGames: number
	// Null when the card has never been part of a real choice. Its sample is
	// the view's offer count — a different population from `games`, and not
	// surfaced.
	pickRate: number | null
}

export function indexCardStats(rows: CardStatRow[]): Map<string, CardStat>

export function cardStatKey(
	kind: 'bonus' | 'curse',
	id: string,
	size: GameSize
): string
```

`indexCardStats` is a straight fold — one entry per row, rates computed with
guarded denominators. The map is keyed by `cardStatKey` so the catalog's lookup
is O(1) per cell and a miss (card never played at that size) is `undefined`,
which the cell renders as its empty state.

New check cases in `dev/check-stats.ts`: empty input, a card with games but no
offers, a card with offers but never kept, an all-forfeit card (null
`avgPoints`), and a card present at one size and absent at another.

## 5. UI — `CardCell` footer

`CardCell` takes the indexed map and its own `kind` (it already knows its card
and the selected size, so it resolves its own key) and renders, below the
description, a hairline-separated footer:

```
────────────────────
  54%     9.6    41%
  win     pts  picked
     128 games
```

- Three equal columns: value (`font.sm`, bold) over label (`font.xs`, muted) —
  a size that still fits three columns in a 2-column phone grid. A column with no denominator shows `—` rather than `0%`: `pts` for an
  all-forfeit card, `picked` for a card that has only ever been dealt without a
  choice.
- Sample line, `font.xs` muted, centered: `128 games`. The offer count behind
  the pick rate is deliberately not printed — it is a different population from
  `games`, and two counts on one line raised more questions than they answered.
- **No footer at all** in three cases: the store is still loading
  (`cardStats === undefined`) — no skeleton, the catalog simply fills in; the
  card is `unavailable` at this size (it has no numbers by construction, and
  the cell already explains why); or the card has no row at this size, where
  the footer is replaced by a single muted `No games yet`.

The footer sits at the bottom of a cell whose height is already the row's
tallest (`cardCell` stretches), so it does not line up across a row — matching
the existing description text, which doesn't either. Not worth a fixed-height
card.

The `size` the catalog is showing is already local state in `CatalogTab`; it
selects the key. Switching sizes re-looks-up, no refetch.

## 6. Docs

- `lib/stores/CLAUDE.md` — note that `useStatsStore` now holds two slices: the
  reader's own rows (RLS-scoped) and a global aggregate read from a view, and
  why the view exists rather than a widened policy.
- `lib/catan/CLAUDE.md` — one line under the constants-duplication section:
  `gameSizeFor` now has a third mirror, in `card_stats`.
- This spec, linked from both.

## Out of scope

- Any global stat outside the catalog (in-game selection cards, player detail).
- Global stats for anything that isn't a bonus/curse (dev cards, board
  variants, ports).
- Head-to-head or per-friend card numbers.
- Backfill: none needed — every completed game already has its rows, and the
  view is computed live.
