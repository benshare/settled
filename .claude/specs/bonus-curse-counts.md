# Bonus / curse card counts

Two new per-game config options: how many **bonus** cards and how many **curse**
cards each player is dealt to choose between during the `select_bonus` phase.
Both range **1–3**; defaults are **2 bonuses / 1 curse** — exactly today's deal,
so nothing changes unless the host opts in.

- `bonusCount = 1` → the bonus is simply assigned (nothing to pick).
- `curseCount = 1` → today's behaviour: the curse card is dealt, not chosen.
- Any count > 1 → the player keeps one card of that kind; the rest are
  discarded.
- **1 and 1** → there is nothing to choose, so the `select_bonus` phase is
  skipped entirely (see "Skipping the phase").

Both picks are committed with a **single Confirm**.

## Config

`lib/catan/types.ts`:

```ts
// Bonus / curse cards dealt per player in select_bonus. 1 = assigned outright
// (no choice); higher = keep one, discard the rest.
export const MIN_CARD_COUNT = 1
export const MAX_CARD_COUNT = 3

export type GameConfig = {
	// …existing…
	bonusCount: number // 1..3
	curseCount: number // 1..3
}
```

- `DEFAULT_CONFIG`: `bonusCount: 2`, `curseCount: 1`.
- `parseGameConfig`: new local helper
  `clampCardCount(raw: unknown, fallback: number): number` — integer in
  `[MIN_CARD_COUNT, MAX_CARD_COUNT]` or `fallback`. No migration; `config` is
  raw JSONB read defensively, same pattern as `numberLayout` / `tradeMode`.
- `summarizeGameConfig`: only when `config.bonuses` is on and the value differs
  from the default, append (after the sets / banned-combos parts):
    - `bonusCount === 1` → `"One bonus card"`; `=== 3` → `"3 bonus cards"`.
    - `curseCount > 1` → `"${n} curse cards"`.
- Mirror into `GameDefaults` (`lib/stores/useProfileStore.ts`):
  `extras.bonusCount` / `extras.curseCount`, in `DEFAULT_GAME_DEFAULTS`
  (2 / 1) and parsed with the same clamp in `parseGameDefaults`. The
  `profiles.game_defaults` column default JSON is left alone — the parser
  fills both in.

### Create-game UI

`app/(app)/create-game.tsx`, inside the **Extras** section, in the `{bonuses &&
…}` block below the set checkboxes and above "Ban bad combos" — two
`SegmentedRow`s (the component Extra-build already uses), values `'1' | '2' |
'3'`:

- **"Bonus cards"** — description: _"How many bonus cards you choose between."_
- **"Curse cards"** — description: _"How many curse cards you choose between."_

Wired like every other option: `useState` seeded from `initial.extras`,
`setTouched(true)` on change, threaded through `currentDefaults`, the `dirty`
comparison against `savedDefaults`, the mount-reset `useEffect`, `onCreate`'s
config payload, and `onSaveDefaults`. Also added to the rematch path
(`parseRematchConfig` needs nothing — `parseGameConfig` supplies them).

## Data model — `SelectBonusHand`

`lib/catan/types.ts` (mirrored in the edge function):

```ts
// Per-player card hand during the select_bonus phase. `offered` / `curses` are
// the cards dealt (1..3 each, distinct within a hand). `chosen` / `chosenCurse`
// flip from null on commit, always together.
export type SelectBonusHand = {
	offered: BonusId[]
	curses: CurseId[]
	chosen: BonusId | null
	chosenCurse: CurseId | null
	// Legacy: hands dealt before curse counts existed carried a single
	// `curse` and no `curses` / `chosenCurse`. Read through the helpers
	// below, never directly.
	curse?: CurseId
}
```

`offered` widens from `[BonusId, BonusId]` to `BonusId[]` — assignment-compatible
with existing stored hands, so a game sitting in `select_bonus` across the deploy
keeps rendering.

Helpers (in `types.ts`, mirrored server-side) so no reader touches `curse`:

```ts
export function handCurses(hand: SelectBonusHand): CurseId[]
// hand.curses?.length ? hand.curses : hand.curse ? [hand.curse] : []

export function handChosenCurse(hand: SelectBonusHand): CurseId | null
// hand.chosenCurse ?? (handCurses(hand).length === 1 ? handCurses(hand)[0] : null)
```

`handChosenCurse` returning the lone curse for a 1-curse hand is what makes
`curseCount === 1` require no pick at all — it's already decided at deal time.
"Committed" stays `hand.chosen !== null`.

## Dealing — `dealBonusHands`

`lib/catan/generate.ts` (and its edge-function mirror):

```ts
export function dealBonusHands(
	playerCount: number,
	bonusSets: readonly string[],
	bannedCombos = true,
	bonusCount = 2,
	curseCount = 1
): Record<number, SelectBonusHand>
```

- Both counts clamped to `[1, 3]` server-side (the edge function must not trust
  `config`, which is stored unvalidated).
- Curses still go out first, now `curseCount` per player, each drawn with an
  `accept` filter that rejects curses already in that player's hand.
- Bonuses then drawn `bonusCount` per player, each `accept`-filtered to be
  (a) not already in the hand and (b) — when `bannedCombos` is on —
  **compatible with every curse in that player's hand**. This is the
  "deal clash-free hands" rule: whichever bonus/curse pair the player ends up
  keeping is guaranteed legal, so nothing needs blocking at pick time.
- `pickPool` gains a `need` parameter (`Math.max(bonusCount, curseCount)`,
  floor 2) so pool selection still prefers a pool big enough to fill a hand;
  `dealer`'s guard relaxes to `pool.length < 1`. As today, an unsatisfiable
  `accept` filter is dropped rather than failing the deal, so a narrow pool
  degrades to repeats instead of throwing.
- Cross-table uniqueness degrades where it must: 6 players × 3 curses = 18 draws
  against an 11-card curse pool, so a curse can repeat across the table once the
  bag is exhausted (the `dealer` reshuffles only after a full pass, so repeats
  come last). Within a hand, cards stay distinct. Document this in the function
  comment.
- Call sites pass `config.bonusCount` / `config.curseCount`
  (`lib/catan/generate.ts:333` and the edge function's `handleRespond`).

## Skipping the phase (1 bonus / 1 curse)

When `config.bonuses` is on but both counts are 1, no player has a decision to
make, so `handleRespond` never enters `select_bonus`:

```ts
const needsSelection =
	config.bonuses && (clamped.bonusCount > 1 || clamped.curseCount > 1)
```

- `games.current_turn`: `needsSelection ? null : 0` (today's
  `config.bonuses ? null : 0` — the null is specifically for the simultaneous
  selection phase, which no longer always exists when bonuses are on).
- Still call `dealBonusHands(...)` when `config.bonuses` is on, then — if
  skipping — snapshot each hand's single bonus + curse straight onto
  `initialPlayers(...)` and set `initialPhase = INITIAL_PHASE`.
- Emit the same `bonus_chosen` events (with `offered` / `offeredCurses` of
  length 1) in the `games` insert's `events` array, so the action log still
  reads "Ben: Gambler — Ambition" and `game_results` still records the offer.
  Those single-card offers are excluded from pick-rate by the `>= 2` guard.

Nothing downstream branches on this: `post_placement` (specialist declaration,
haunt spots, fence tokens) already runs off `PlayerState.bonus`, which is now
set one phase earlier.

## Committing the pick

`pick_bonus` gains a curse:

```ts
type PickBonusBody = {
	action: 'pick_bonus'
	game_id: string
	bonus: string
	curse?: string
}
```

`handlePickBonus` (edge fn):

- Existing guards unchanged; `bonus` must be in `hand.offered`.
- `curse`: when present, must be in `handCurses(hand)` → else
  `400 'curse not offered'`. When absent, allowed only if
  `handCurses(hand).length === 1` (the no-choice deal, and any client that
  predates this change); otherwise `400 'must pick a curse'`.
- Write `{ ...hand, chosen: bonus, chosenCurse: curse }`.
- On `allChosen`, snapshot `bonus: nextHands[i].chosen`,
  `curse: handChosenCurse(nextHands[i])` onto `PlayerState`.
- The `bonus_chosen` event gains `offeredCurses: CurseId[]` alongside the
  existing `offered` (bonuses) and the kept `bonus` / `curse`.

Client store (`lib/stores/useGamesStore.ts`): `pickBonus(gameId, bonus, curse)`
— `curse` typed `CurseId` and always sent by the app.

`gameScreenContext.onPickBonus(bonus, curse)` passes both through.

## UI — `BonusSelection.tsx`

Layout, per the decision to keep card text readable:

- **≤ 2 cards**: today's flex row, unchanged (`flex: 1` cards side by side).
- **3 cards**: a horizontal `ScrollView` (`horizontal`,
  `showsHorizontalScrollIndicator={false}`, `contentContainerStyle` carrying the
  gap) with fixed-width cards (~150) so the full title/description stays legible
  and the row swipes.

Extract the card into a local `CardPicker` subcomponent (row vs. scroll chosen
from `items.length`) and use it for both bonuses and curses — one code path,
`kind: 'bonus' | 'curse'` picking `colors.brand` vs `colors.error` for the icon
and picked-border tint.

Behaviour:

- Bonus row: as today (`pick` index state, picked/faded/committed states).
- Curse row:
    - `handCurses(hand).length === 1` → today's single non-interactive card,
      copy unchanged ("Your curse card stays either way").
    - `> 1` → a selectable `CardPicker` with its own `cursePick` state, mirroring
      the bonus row's picked / faded / committed treatment. After commit the kept
      curse comes from `handChosenCurse(hand)`.
- Subheading copy branches on the counts:
    - 2–3 bonuses + 1 curse (today): unchanged string.
    - 1 bonus + >1 curse: _"Keep one curse card. The other will be discarded.
      Your bonus card is fixed."_
    - Both > 1: _"Keep one bonus card and one curse card. The rest are
      discarded."_
    - Both 1: unreachable — the phase is skipped.
- Confirm gating: `canSubmit = pick !== null && (needsCursePick ? cursePick !==
null : true)`. Label: `"Pick a bonus"` → `"Pick a curse"` → `"Confirm"`,
  whichever is still missing first. With `bonusCount === 1` the single bonus
  card is preselected (`pick = 0`) and non-interactive, so Confirm is live
  immediately.
- `onPick(bonus, curse)` — curse resolved as `handCurses(hand)[cursePick ?? 0]`.

Nothing else in the game screen changes: `BoardArea` just forwards the new
handler signature, and the spectator status line ("Players are choosing
bonuses") still reads correctly.

## Stats

Curses become a real choice, so record what was offered — mirroring
`offered_bonuses`.

**Migration** `supabase/migrations/<ts>_offered_curses.sql`:

```sql
alter table public.game_results add column offered_curses text[];
```

Comment it like the existing `offered_bonuses` column (null for games that
predate the column, or that ran without bonuses). No RLS change — the table's
policies are column-agnostic. Then `npm run types`.

**Edge fn**: generalize `offeredBonusesByPlayer` to read both fields off the
`bonus_chosen` events (returning `{ bonuses, curses }` per player) and write
`offered_curses: …` on the `game_results` upsert.

**`lib/stores/useStatsStore.ts`**: `GameResult` gains
`offered_curses: CurseId[] | null` (same `Omit` + re-add pattern).

**`lib/stats.ts`**:

- `topPickRate` now skips results whose `offered_bonuses.length < 2` — with
  `bonusCount === 1` every offer is trivially kept, which would otherwise
  inflate a card to 100%.
- New `topCursePickRate` over `offered_curses` with the same `>= 2` guard.
- Both return the existing rate shape, renamed to a neutral
  `CardRate = { id: string; total: number; hits: number; rate: number }`
  (`BonusRate`'s `bonus` field becomes `id`). Update `StatsSummary`
  (`topPickRate`, `topWinRate`, `topCursePickRate`) and `best`/`topWinRate`
  accordingly.

**`app/(app)/stats.tsx`**: `BonusRateRow` → `CardRateRow({ label, rate, unit,
kind })`, resolving title/icon via `bonusById` or `curseById` from `kind`. Add a
`"Most picked curse"` row under the existing pick-rate / win-rate rows, rendered
only when `stats.topCursePickRate` is non-null (i.e. the user has finished a game
that offered a curse choice).

## Edge function mirror

`supabase/functions/game-service/index.ts` — source of truth stays `lib/catan/`:

- `GameConfig` + `bonusCount` / `curseCount` (read defensively with the same
  clamp; the stored config is never validated on write).
- `SelectBonusHand` + `handCurses` / `handChosenCurse`.
- `dealBonusHands` signature + clash-free multi-curse dealing + `pickPool`
  `need`.
- `handleRespond`'s `dealBonusHands(...)` call passes the two counts, plus the
  `needsSelection` branch (current_turn, initial phase, pre-set players,
  seeded `bonus_chosen` events).
- `handlePickBonus` curse validation + `chosenCurse` + `offeredCurses` on the
  event.
- `writeGameResults`: `offered_curses`.

## Testing

`dev/check-catan-bonuses.ts` — existing `hand.curse` / two-bonus assertions move
to `handCurses(hand)` / `hand.offered.length`, plus new cases:

- Every `(bonusCount, curseCount)` in `1..3 × 1..3` deals hands of exactly those
  lengths, with cards distinct within a hand.
- With `bannedCombos` on, **every** offered bonus × offered curse pair in a hand
  is clash-free (extend `testDealBannedCombos` to the cross product, incl. the
  stubbed-ban case at `curseCount: 3`).
- Counts out of range (0, 4, 2.5, NaN) clamp rather than throw.
- `handCurses` / `handChosenCurse` on a legacy `{ offered, curse, chosen }` hand
  return the single curse.
- Existing withheld-card and cross-table-uniqueness cases still pass at the
  default counts.

Run `npx tsx dev/check-catan-bonuses.ts`, then `npm run check` + `npm run
format`.

Deploy order: `npm run migrate` → `npm run types` → `npm run edge` (the rules
only reach real games through the edge function).

## Decisions

| Question                            | Answer                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| Range / defaults                    | 1–3 both; **2 bonuses, 1 curse** (today's deal).                                         |
| Banned combos with multiple curses  | **Deal clash-free hands** — every offered bonus is compatible with every offered curse.  |
| Confirm flow                        | **One Confirm** submits bonus + curse together.                                          |
| 1 bonus + 1 curse                   | **Skip `select_bonus`** — cards assigned at creation, game starts at initial placement.  |
| 3-card layout                       | **Horizontal scroll row**, fixed-width cards; ≤2 keeps today's flex row.                 |
| Curse pick stats                    | **Yes** — new `game_results.offered_curses` column + a "Most picked curse" stat row.     |
| Pick-rate with 1-card deals         | Excluded (`offered.length >= 2`) so a forced card can't read as 100% picked.             |
| Migration for the config itself     | None — `config` is raw JSONB, parsed defensively; legacy games read 2 / 1.               |
| In-flight `select_bonus` games      | Legacy `{ curse }` hands read through `handCurses` / `handChosenCurse`; no backfill.     |
| Cross-table curse uniqueness at 6×3 | Degrades to repeats after the 11-card pool is exhausted; within-hand distinctness holds. |
