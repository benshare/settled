# Catalog filter menu

Branch: `card-stats-filter`, off `main`. Follows
[card-global-stats](./card-global-stats.md), which added the per-card footer
this changes the scope of.

The **Bonuses & curses catalog** (`app/(app)/stats.tsx`, second tab) currently
picks **one** table size with a segmented pill row, and everything on the
screen follows it: which `card_stats` row a card's footer reads, the card's
description, and its "not dealt here" note.

That single-select is replaced by a **filter menu** — a filter icon that opens
a sheet of **three checkboxes** (2p / 3-4p / 5-6p), all checked by default. The
footer numbers become the **sum over the checked sizes**.

## 1. Why

The split is starving the screen. Measured against the live database (74
`game_results` rows, 29 games):

| size            | result rows |
| --------------- | ----------: |
| small (2p)      |          42 |
| standard (3-4p) |          12 |
| expanded (5-6p) |          20 |

The old default was `standard` — the thinnest bucket — so most cards read "No
games yet" on open despite having been played. Defaulting to all three checked
shows the whole sample, and narrowing stays available for anyone who wants it.

**Not an RLS problem.** Verified: signed in as an account with zero visible
`game_results` rows, `card_stats` still returns all 87 rows with identical
totals to a service-role read, and a JS re-aggregation of all 74 rows matches
the view per `(kind, card, size)` exactly. The view already runs as its owner.
No migration, no schema change, no RPC — `card_stats` stays exactly as it is.

## 2. Filter state

`CatalogTab` local state, replacing `size`:

```ts
const [sizes, setSizes] = useState<GameSize[]>([...GAME_SIZES])
```

- **Default: all three checked.**
- **The last checked box does not uncheck.** Its press is a no-op — no disabled
  styling, no error. The catalog always describes some table, and an
  all-unchecked state would be a fourth empty state for every cell to handle.
- Not persisted. Resets to all-checked on remount, like the tab selection it
  sits next to.

## 3. What the filter does and doesn't drive

Only the **numbers** follow the checkboxes. Card text does not:

- **Description: always the 3-4p baseline.** `bonusDescriptionFor(id,
'standard')` / `curseDescriptionFor(id, 'standard')` — the size every card's
  pool text is written against. A filter is a lens on the sample, not a mode
  the card is read in, and stacking per-size variants in a grid cell would make
  the rows uneven for a difference most cards don't have.
- **Availability: unavailable in _every_ checked size.** A card withheld at 2p
  but dealt at 3-4p is not "unavailable" while both are checked — it has real
  numbers to show. The note names the checked set: `Not dealt in 2-player
games` when only `small` is checked, `Not dealt in 2-player or 5-6 player
games` when those two are.

## 4. Aggregation — `lib/stats.ts`

`indexCardStats` folds the **selected** sizes into one entry per card, so the
key loses its size:

```ts
export function cardStatKey(kind: 'bonus' | 'curse', id: string): string

export function indexCardStats(
	rows: CardStatRow[],
	sizes: GameSize[]
): Map<string, CardStat>
```

Counts sum across the checked sizes before any rate is computed — summing
integers and dividing once, never averaging three rates. A card with no row in
any checked size is absent from the map, which the cell still renders as its
`No games yet` state. `CatalogTab` re-indexes on `[cardStats, sizes]`; nothing
refetches.

Two changes to `CardStat`, from the same diagnosis:

- **`winRate: number | null`** — null when `games === 0`. The view's full join
  yields 14 rows with offers but zero games (a card offered and always
  declined); those currently print a fabricated **0% win**. Null renders `—`,
  matching what `avgPoints` already does for an all-forfeit card.
- **The `picked` column is dropped, not dashed, when `pickRate` is null.** With
  offers this sparse — 50 of 74 results recorded a 2+ bonus offer, but only
  **5** recorded a 2+ curse offer (curses were dealt one per player until Aug 6) — most curse cells have no pick rate at all, and a column of `—` reads as
  a broken stat rather than an absent one. Win and points then split the row
  two ways.

`dev/check-stats.ts` gains cases for: summing one card across two sizes, a
size filter excluding a row, null `winRate` on an offer-only card, and the
single-size case still matching the old numbers.

## 5. UI — `CatalogFilter`

A right-aligned **icon-only** trigger above the grid, in place of
`SizeSelector`:

- The `Ionicons` `filter` glyph in a round pressable, brand-tinted while the
  filter is narrowed and muted otherwise.
- **Active indicator**: a small `colors.brand` dot on the corner whenever
  `sizes.length < GAME_SIZES.length` — the only signal that a narrowed filter
  is in effect, since the trigger carries no text.
- Opens a `Modal` sheet styled like `Select`'s (same `sheet` / `sheetTitle` /
  row metrics), titled **Players**, holding one row per size: label on the
  left, `checkbox` / `square-outline` icon on the right, brand-tinted when
  checked. Tapping toggles in place — the sheet stays open, because the point
  is to compose a set. Backdrop tap closes.

Kept local to `app/(app)/stats.tsx` rather than promoted to `lib/modules`: one
call site, and its trigger is a bespoke icon rather than `Select`'s row. If a
second multi-select appears, that's the moment to generalize.

`CardCell` loses its `size` prop (it no longer keys a lookup or resolves a
description) and takes `unavailable` plus the sizes-aware note text from its
parent.

## 6. Docs

- `.claude/specs/card-global-stats.md` — its "per table size" scope decision is
  now "per **selected** table sizes"; point at this file.
- `lib/catan/CLAUDE.md` / `lib/stores/CLAUDE.md` — unchanged. The store, the
  view, and the `gameSizeFor` mirror all stay as documented.

## Out of scope

- Any second filter control (bonus set, sample-size floor, date range). The
  menu is built to hold more, but ships with one.
- Persisting the filter across launches.
- Applying the filter to the **Stats** tab, which is the reader's own history
  and has no size dimension.
- Recording offers for legacy rows — the data was never written, and no filter
  brings it back.
