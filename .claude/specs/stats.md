# Stats tab

Branch: `stats`, off `main`. Fills in the `Stats` tab stubbed out by the
games-tab change (`app/(app)/stats.tsx`, currently "Coming soon").

Everything on this screen is **about the signed-in user only**, and derives
from **completed games** (`games.status = 'complete'`) they were seated at.

## 1. Where the numbers come from

Final scores exist nowhere today — victory points are a derivation over the
live `game_states` row, and placement is not recorded at all. So a game
completing now **persists a per-player summary row**, and a one-off script
backfills the existing games.

### `game_results` table (new migration)

One row per (game, seated player).

| column            | type        | notes                                                                           |
| ----------------- | ----------- | ------------------------------------------------------------------------------- |
| `game_id`         | uuid        | FK `games(id)` on delete cascade                                                |
| `user_id`         | uuid        | FK `profiles(id)` on delete cascade                                             |
| `player_index`    | int         | seat, i.e. index into `games.player_order`                                      |
| `points`          | int         | final VP, fully revealed (`totalVP(state, i)` — includes hidden VP dev cards)   |
| `placement`       | int         | 1-based; ties share the better rank (`1 + count of players with strictly more`) |
| `won`             | boolean     | `player_index === games.winner`                                                 |
| `turns`           | int         | final `game_states.round` (the monotonic turn counter — **not** rounds)         |
| `player_count`    | int         | `games.player_order.length`, denormalized so stats need no join                 |
| `bonus`           | text        | nullable — `PlayerState.bonus`; null on non-bonus games                         |
| `curse`           | text        | nullable — `PlayerState.curse`                                                  |
| `offered_bonuses` | text[]      | nullable — the bonuses this player was dealt (see §2); null for legacy games    |
| `offered_curses`  | text[]      | nullable — the curses this player was dealt; null before curses could be chosen |
| `completed_at`    | timestamptz | `now()` at write time; backfill uses the `game_complete` event's `at`           |

Primary key `(game_id, user_id)`. Index on `user_id`.

RLS enabled. **Select** policy: rows for any game the requester participated in

```sql
exists (select 1 from games g where g.id = game_id and auth.uid() = any(g.participants))
```

— broader than `user_id = auth.uid()` so head-to-head stats stay possible later,
and it matches the visibility the user already has via `games`. No insert /
update / delete policies: only the edge function (service role) writes.

### Written by the edge function

`applyEndOfActionChecks` in `supabase/functions/game-service/index.ts` is the
single place a game becomes complete (`findWinner` → `game_complete` event →
`commitActionWrite` flips `games.status`). Extend `commitActionWrite`: when
`winner !== null`, upsert one `game_results` row per seat, computed from the
post-action state it already holds (`totalVP` per seat for points, derived
placement, `state.round`, `players[i].bonus/curse`).

- Upsert on the primary key so a retry can't double-write.
- A failure to write results must **not** fail the action — the game is already
  over and the player is owed their 200. Log and continue.

### Backfill: `dev/backfill-game-results.ts`

Service-role script, in the style of the existing `dev/` scripts but `.ts` (it
imports `totalVP` from `lib/catan/dev` rather than reimplementing scoring):

```sh
npx tsx --env-file=.env dev/backfill-game-results.ts [--dry-run]
```

Reads every `games` row with `status = 'complete'` that has no `game_results`
rows, joins its `game_states` row, computes the same values as the edge
function, inserts them. Idempotent (skips games that already have rows);
`--dry-run` prints what it would write. Games whose `game_states` row is
missing are skipped with a warning. `offered_bonuses` is left null — the
offered pair was never stored (see §2). Document it in `dev/README.md`.

Run against dev first, then production, before the client change ships.

## 2. Recording the offered bonuses

Pick rate needs the bonuses a player _declined_, and today only the kept one
survives (`SelectBonusHand` lives in `phase`, which is replaced when placement
starts). Two additions, both forward-only:

- `handlePickBonus`: include `offered: hand.offered` on each `bonus_chosen`
  event it writes (the event is only written once everyone has locked in, so
  this leaks nothing).
- `commitActionWrite`'s results write: `offered_bonuses` from the same
  `bonus_chosen` events already in `games.events`.

Client-side, add `offered?: [BonusId, BonusId]` to the `bonus_chosen` variant of
`GameEvent` in `useGamesStore`. Optional — pre-change games have no offers.

**Consequence for the UI:** pick rate is only meaningful over games played
after this ships. The bonus section therefore shows pick rate with its sample
size (`3 of 5 offers`) and simply omits the tile when the user has no games
with offer data yet.

## 3. Store

New `lib/stores/useStatsStore.ts`, auto-loaded (registered in
`lib/stores/index.ts` per `lib/stores/CLAUDE.md`):

- State: `results: GameResult[] | undefined` (undefined = loading, null-free —
  a load failure sets `[]` plus an `error` string the screen can surface).
- `loadForUser(userId)` selects `game_results` where `user_id = userId`. No
  realtime channel: the set only changes when a game completes, and
  `loadAllUserStores` already re-runs on every foreground transition and on the
  game-complete navigation back to the list.
- `clear()` on sign-out.
- `GameResult` type derived from `Database['public']['Tables']['game_results']['Row']`
  with `bonus`/`curse` narrowed to `BonusId | null` / `CurseId | null`.

Regenerate `lib/database-types.ts` (`npm run types`) after the migration.

Friend stats do **not** need a new query: `useGamesStore.completeGames` already
holds the user's completed games with `participants`, and `profilesById` holds
the names/avatars.

## 4. Pure aggregation — `lib/stats.ts`

New module, no I/O, taking `(results: GameResult[], completeGames: Game[], meId: string)`
and returning one `Stats` object. Unit-checked by `dev/check-stats.ts` in the
style of the other `dev/check-*.ts` scripts (empty input, ties, single game,
missing-bonus games).

- `gamesPlayed` — `results.length`.
- `winRate` — `won / gamesPlayed`.
- `avgPoints` — mean `points`.
- `avgPlacement` — mean `placement`.
- `avgRounds` — mean of `turns / player_count` (the user asked for full
  go-arounds; `turns` is the raw turn counter).
- `avgPlayers` — mean `player_count`.
- `distinctOpponents` — size of the union of `completeGames[].participants`
  minus `meId`.
- `topOpponents` — that same union counted per user id, sorted by games desc
  then username asc, top 5. Each entry `{ userId, games }`; the screen resolves
  profiles.
- `bonusesPlayed` / `cursesPlayed` — distinct non-null `bonus` / `curse`
  values, alongside `BONUS_POOL.length` / `CURSE_POOL.length` as the
  denominator (all three bonus sets are live).
- `topPickRateBonus` — over results whose `offered_bonuses` holds **two or
  more** cards: for each bonus, `timesKept / timesOffered`; the max, ties broken
  by more offers then id. Null when no result has offer data. A game configured
  to deal a single bonus card (`GameConfig.bonusCount === 1`) still records the
  offer, but is excluded here — a card nobody could decline would read as 100%
  picked.
- `topCursePickRate` — the same derivation over `offered_curses` / `curse`,
  for games that dealt a curse choice (`GameConfig.curseCount > 1`).
- `topWinRateBonus` — over results with a `bonus`: `wins / games` per bonus,
  max, ties broken by more games then id. **No minimum sample** (per the user's
  choice) — a 1-of-1 100% is allowed, so the tile always shows its sample size.

## 5. Screen — `app/(app)/stats.tsx`

Same shell as the other tabs (`SafeAreaView` + `ScrollView`, title "Stats").
Loading: `ActivityIndicator` while `results === undefined` or the games store
hasn't loaded, matching the Games screen. Empty (no completed games): a single
muted line, "Play a game to see your stats." — no sections rendered.

Three sections, each with the existing uppercase `sectionHeading` treatment:

**Games**

A 2-column grid of stat tiles (`card` background, `border`, `radius.md`): big
value + small muted label.

| tile        | value                                  |
| ----------- | -------------------------------------- |
| Win rate    | `62%` (label sub-line `8 of 13 games`) |
| Avg points  | `9.4`                                  |
| Avg place   | `2.1` (of `avgPlayers`, e.g. "of 3.8") |
| Avg rounds  | `14.2`                                 |
| Avg players | `3.8`                                  |

**Friends**

- One full-width tile: "People played with" → `distinctOpponents`.
- Below it, the top-5 list: `Avatar` + username + right-aligned game count,
  using the same row styling as the Games screen rows. Falls back to `…` for a
  profile not yet in `profilesById` (same convention as elsewhere).

**Bonuses**

- Tiles: "Bonuses played" `12` / sub-line `of 27`; "Curses played" `7` /
  `of 11`.
- Two full-width rows for the superlatives, each with the bonus's Ionicon +
  title + the rate and its sample: "Most picked — Merchant · 60% (3 of 5
  offers)", "Best win rate — Gambler · 75% (3 of 4 games)". A row is omitted
  when its value is null (no bonus games / no offer data yet).

Whole bonus section is hidden when the user has never played a bonus game.

Subcomponents (`StatTile`, `StatGrid`, opponent row, bonus row) stay local to
`stats.tsx` — nothing else needs them yet.

## 6. Docs

- `lib/stores/CLAUDE.md` — add `useStatsStore` to the auto-loaded list and note
  why it has no realtime channel.
- `dev/README.md` — `backfill-game-results.ts` and `check-stats.ts`.
- `supabase/functions/CLAUDE.md` — note that completion now also writes
  `game_results`, and that the write is best-effort.

## Out of scope

- Any stat over active games, or per-opponent head-to-head records.
- Charts / graphs — all tiles are numeric for now.
- Backfilling `offered_bonuses`; it starts accumulating from this deploy.
