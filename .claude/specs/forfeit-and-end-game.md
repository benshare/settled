# Forfeiting and ending games

Branch: `forfeit-end-game`, off `main`.

Two withdrawable, per-player declarations that a game can end without anyone
reaching the VP threshold:

- **Forfeit** — "I'm out." When every seat but one holds a standing forfeit,
  the game ends immediately and the remaining player is the winner.
- **End game** — "let's call it." When _every_ seat holds a standing end-game
  vote, the game transitions to a new `canceled` status with **no winner**.

Both can be submitted at any point while the game is in progress, and withdrawn
at any point before the game is over.

Stats consequences: a **canceled** game contributes nothing at all; a
**forfeited** game contributes only to games played and win rate.

## 1. What a forfeit is (and isn't)

A forfeit is a **standing, withdrawable declaration**, not a removal from the
game. A player who has forfeited keeps their seat, their turn, their resources,
their bonus, and every action they could take before. Nothing in the turn
engine, robber chain, trade rules, discard requirements, special build queue, or
scoring learns about forfeits. The only thing that reads them is the
all-but-one threshold.

This is the whole reason the feature is small. The alternative — skipping a
forfeiter in turn order — would put a new condition into every turn-advance,
steal-target, trade-addressee and discard path in the edge function, and
withdrawing would have to splice a seat back into a queue that has moved on.

The same is true of an end-game vote: it is a flag and nothing more.

The two votes are **fully independent**. A player may hold both at once;
submitting or withdrawing one never touches the other. Whichever threshold trips
first ends the game.

### The all-but-one rule is unreachable at N

With `N` seats, the `(N-1)`th forfeit leaves exactly one seat un-forfeited and
ends the game there. An all-`N`-forfeited state is therefore unreachable, and
"the winner" is always well defined. (A one-seat game — not reachable through
the UI, but permitted by the `participants >= 1` check — never trips the rule at
all; the forfeit just stands.)

## 2. Schema

New migration `supabase/migrations/20260729120000_forfeit_and_end_game.sql`.

### `games`

```sql
alter table public.games
    add column forfeits uuid[] not null default '{}',
    add column end_votes uuid[] not null default '{}';

alter table public.games drop constraint games_status_check;
alter table public.games
    add constraint games_status_check
    check (status in ('placement', 'active', 'complete', 'canceled'));
```

Both arrays hold **user ids**, not seat indices — they're set from the caller's
auth id, and a uuid can't be silently misaligned against `player_order` the way
an int can.

They live on `games` rather than `game_states` for three reasons: the row is
already in the realtime publication and already loaded by both `useGamesStore`
and `GameProvider`, its select policies already cover participants _and_
spectators, and this is game metadata rather than board state (the same argument
`config` was moved for in `20260724120000`).

No RLS change. No new policies: like every other write in this subsystem, both
arrays are only ever written by the edge function under the service role.

### `game_results`

```sql
alter table public.game_results
    add column forfeit boolean not null default false;
```

True on every row of a game that ended by forfeit — the winner's included. The
default backfills existing rows correctly (they all ended by play), and
`dev/backfill-game-results.ts` needs no change: it only ever sees games that
finished the normal way.

**Canceled games write no `game_results` rows at all.** That is what "contribute
nothing" means at the storage layer, and it keeps every stat that derives from
those rows correct without a filter.

Regenerate `lib/database-types.ts` (`npm run types`) after `npm run migrate`.

## 3. Edge function — `supabase/functions/game-service/index.ts`

### Two new actions

```ts
type SetForfeitBody = { action: 'set_forfeit'; game_id: string; on: boolean }
type SetEndVoteBody = { action: 'set_end_vote'; game_id: string; on: boolean }
```

One action per flag with an `on` boolean, rather than four verbs. Submitting and
withdrawing share every guard and differ only in which way the array moves, and
an idempotent setter can't get out of step with a client that fires twice.

Both are added to the `Body` union and to `dispatch`. Neither joins
`UNDOABLE_ACTIONS` — undo restores a `game_states` snapshot, and these write
`games`. They do fall under the dispatcher's _clear the undo column_ rule for
free, which is correct: a forfeit is a real action taken after your build.

### `handleSetForfeit`

1. `loadGame`. Reject unless `game.status` is `'placement'` or `'active'` —
   `err(400, 'game is over')`. This is the whole "at any time while in progress"
   window, and it covers withdrawal too.
2. `const meIdx = game.player_order.indexOf(me)`; `< 0` → `err(403, 'not a
participant')`. Deliberately **not** `currentPlayerIndex`, which returns
   `null` whenever `games.current_turn` is `null` — that is the entire
   simultaneous bonus-selection phase, and forfeiting has nothing to do with
   holding the turn.
3. Compute `next` = `forfeits` with `me` added or removed. If `next` is the same
   length as the current array, return `json({ ok: true })` without writing —
   no event, no notification, no realtime churn.
4. Event: `{ kind: 'forfeit_submitted' | 'forfeit_withdrawn', player: meIdx, at }`.
5. **Threshold.** Only on `on === true`: if
   `game.player_order.length - next.length === 1`, the game ends. The winner is
   the seat of the one player not in `next`.
    - `stateUpdate.phase = { kind: 'game_over' }`
    - append `{ kind: 'game_complete', winner, vpCards: vpCardCountsByPlayer(state), by_forfeit: true, at }`
    - games update: `status = 'complete'`, `winner`, `forfeits = next`
    - `game_results` written with `forfeit: true` on every row
6. Otherwise: games update is just `forfeits = next` plus the event.

Note that the winner is the survivor **regardless of VP** — `findWinner` is not
consulted, and the forfeited game may end with nobody near the threshold.

### `handleSetEndVote`

Same guards and same idempotence. Event kinds `end_game_proposed` /
`end_game_withdrawn`.

Threshold, only on `on === true`: `next.length === game.player_order.length`.

- `stateUpdate.phase = { kind: 'game_over' }`
- append `{ kind: 'game_canceled', at }` — no `winner`, and **not** a
  `game_complete` event; a canceled game has no scoreboard to announce and
  nothing downstream should treat it as a completion.
- games update: `status = 'canceled'`, `end_votes = next`. `winner` stays
  `null`.
- **No `game_results` write.**

### `commitActionWrite` gains an options bag

Both handlers go through the existing two-step write rather than hand-rolling
one, so the `game_states` → `games` → `game_results` ordering (and the
best-effort-results rule) stays in one place. New optional last parameter:

```ts
opts?: {
    // Extra columns merged into the games update — `forfeits` / `end_votes`.
    gameFields?: Record<string, unknown>
    // Sets status without a winner and skips the results write entirely.
    canceled?: boolean
    // Stamps game_results.forfeit. Only meaningful alongside a winner.
    byForfeit?: boolean
}
```

`writeGameResults` takes `forfeit: boolean` and puts it on every row. Every
existing call site is unchanged (the parameter is optional and defaults to the
play-through behaviour).

### Notifications

Four new kinds in `supabase/functions/_notify/index.ts` (`NotificationKind` +
`renderBody`), all **ungated** — no `gate` key, the same posture as `honk`.
These are rare and consequential, so they don't get a preference toggle and no
new pref key is added to the account screen.

| kind                  | sent to            | body                                 |
| --------------------- | ------------------ | ------------------------------------ |
| `game_forfeited`      | every other player | `{sender} forfeited the game.`       |
| `end_game_proposed`   | every other player | `{sender} wants to end the game.`    |
| `game_canceled`       | every other player | `Your game was canceled.`            |
| `game_won_by_forfeit` | the winner only    | `Everyone else forfeited — you win.` |

All carry `gameId` so the deep link lands on the board; the first two carry
`senderProfileId`. **Withdrawals send nothing** — undoing a declaration isn't
worth a push.

When a forfeit ends the game, only the winner is notified: everyone else chose
to forfeit and already knows what that means. When an end-game vote cancels the
game, the last voter is skipped (they just tapped it) and everyone else is told.

Spectators are never targets, consistent with the rest of the service.

Both sends go inside `EdgeRuntime.waitUntil(...)` **after** the write commits,
so the badge count riding along is post-action (see
`supabase/functions/CLAUDE.md`).

### Concurrency

Both handlers read the array and write it back without a transaction — the same
read-modify-write every `games.events` append in this file already does. Two
forfeits landing in the same instant can drop one; the player can submit again,
and the threshold is re-evaluated on every write. Not worth an RPC with `for
update` given the interaction rate.

### Everything else is already guarded

No other handler needs to change. Every one of them tests `game.status` against
`'active'` or `'placement'`, so a `canceled` game rejects every action for free.
`badgeCounts` in `_notify` already filters to `status in ('placement','active')`,
so a canceled or forfeited game drops out of the app-icon badge with no edit.

## 4. Client — types and store

### `lib/stores/useGamesStore.ts`

Five new `GameEvent` variants, plus one field on an existing one:

```ts
| { kind: 'forfeit_submitted'; player: number; at: string }
| { kind: 'forfeit_withdrawn'; player: number; at: string }
| { kind: 'end_game_proposed'; player: number; at: string }
| { kind: 'end_game_withdrawn'; player: number; at: string }
// Terminal. Written when every seat voted to end; no winner, no scoreboard.
| { kind: 'game_canceled'; at: string }
```

and `game_complete` gains `by_forfeit?: boolean` — absent on every game that
ended by play, including all existing ones.

Two new actions, both through `callGameService`:

```ts
setForfeit: (gameId: string, on: boolean) => Promise<ActionResult>
setEndVote: (gameId: string, on: boolean) => Promise<ActionResult>
```

**One exported predicate, used everywhere a status is tested:**

```ts
// A game that is over, whichever way it ended. Both land in History and in
// `completeGames`; neither accepts any further action.
export function isFinished(status: string): boolean {
	return status === 'complete' || status === 'canceled'
}
```

Three places in the store change to use it:

- `loadForUser` — the completed query becomes
  `.in('status', ['complete', 'canceled'])`, keeping its existing
  `.contains('participants', [userId])`. The in-progress query is untouched, so
  a canceled game leaves `activeGames` on its own.
- `handleGameChange` INSERT/UPDATE — the `game.status === 'complete'` tests
  become `isFinished(game.status)`, so a canceled game routes into
  `completeGames` and triggers the same `stopSpectating` cleanup a completed one
  does. Without that, a spectator keeps a header tab for a game that ended.
- Nothing else: `isMyTurn` and `spectatableGames` are already scoped to
  in-progress rows.

### `lib/catan/gameContext.tsx`

No change — it reads whatever `games` row it's given, and the two new columns
ride along on `select('*')`.

### `lib/game/gameScreenContext.tsx`

- `inGameOver` becomes `isFinished(game?.status ?? '')`. This is what stops the
  board accepting input, hides the undo arrow (already gated on `inGameOver`),
  and shows the end overlay. The `displayVP` memo's `game?.status` branch gets
  the same treatment, so a canceled game reveals every hand like a completed one
  does.
- New derived values and handlers for the menu:

    ```ts
    myForfeit: boolean          // meId is in game.forfeits
    myEndVote: boolean          // meId is in game.end_votes
    forfeitedIds: string[]      // game.forfeits ?? []
    endVoteIds: string[]        // game.end_votes ?? []
    canEndGame: boolean         // !isSpectator && meIdx >= 0 && !inGameOver
    setForfeit: (on: boolean) => Promise<void>
    setEndVote: (on: boolean) => Promise<void>
    ```

    The two setters wrap the store actions and surface `error` the same way the
    context's other handlers do.

## 5. Client — UI

### The game menu (`lib/catan/GameMenu.tsx`, new)

An overflow button in the nav and the sheet it opens.

```
┌──────────────────────────────┐
│ ‹   Game with alice      ⋯•  │
└──────────────────────────────┘
```

`Nav.tsx` currently renders an empty `View style={styles.back}` on the right to
balance the chevron; `<GameMenu />` takes that slot, keeping the title centred.
It reads `useGameScreen()` — the provider already wraps `Nav` — and renders
`null` when `!canEndGame`, so a spectator and a finished game get the same
balancing spacer as today.

The button carries an **accent dot** (the `TURN_BADGE_SIZE` treatment reused
from `PlayerStrip` / the games list) whenever any forfeit or end-game vote is
standing. Without it the sheet is the only place a pending vote exists, and
nobody would think to open it.

The sheet is a plain centered `Modal` (`lib/modules/Modal.tsx`) — its content is
entirely self-contained, so the minimizable rule in `lib/catan/CLAUDE.md` does
not apply. Two sections:

```
┌────────────────────────────────────┐
│  Forfeit                           │
│  bob has forfeited.                │
│  Forfeit and the last player left  │
│  standing wins.                    │
│  [ Forfeit game ]                  │
│ ────────────────────────────────── │
│  End game                          │
│  2 of 4 players want to end.       │
│  Everyone has to agree. A canceled │
│  game counts for nothing.          │
│  [ Withdraw ]                      │
└────────────────────────────────────┘
```

- The forfeit line names the forfeiters (`profilesById`, "You" for self), or is
  omitted when there are none.
- The end-game line is a count, since the threshold is the whole table.
- Each button toggles: **Forfeit game** / **Withdraw forfeit**, **End game** /
  **Withdraw**.
- Submitting is behind `ConfirmModal` (`lib/modules/ConfirmModal.tsx`) —
  "Forfeit this game?" / "Vote to end this game?" — because both are visible to
  the whole table and one of them can end the game on the spot. **Withdrawing is
  not confirmed**; it's the undo.
- No native `alert`/`confirm`, per the global rules.

### `PlayerStrip.tsx`

A forfeited seat gets a small flag icon (`flag-outline`) beside its name, in the
muted text colour. It's persistent, per-player state that the table should be
able to read off the board without opening a menu — unlike an end-game vote,
which is only meaningful as a table-wide count and stays in the sheet.

`PlayerStrip` takes `forfeitedIds: string[]` (it already receives `playerOrder`,
so it resolves seats itself). `TopArea` passes it from the context.

### `ActionLog.tsx`

`describeEvent` gains the five new kinds. Copy:

- `bob forfeited.` / `bob withdrew their forfeit.`
- `bob wants to end the game.` / `bob no longer wants to end the game.`
- `Game canceled.` (`player: null`, the neutral marker)

None of them join a `CATEGORIES` bucket — they aren't rolls, builds, trades,
robber or bonus events, so like `game_complete` they appear only under **All**.
The `game_complete` line gains a "by forfeit" variant.

Per `lib/catan/CLAUDE.md`: every new kind must be in the `GameEvent` union or it
is written server-side and never rendered. Both halves ship together here.

### `GameOverOverlay.tsx`

Two new optional props, both defaulting to the current behaviour:

- `canceled?: boolean` — heading becomes **Game canceled** with no winner crown
  and no winner row treatment. The Scores / Rolls / Highlights tabs all still
  render (scores as they stood; a game canceled during bonus selection just
  shows zeroes, which is honest). **Rematch is still offered** — cancelling to
  restart with different settings is the likeliest reason to do it.
- `wonByForfeit?: boolean` — the normal overlay, with a muted **Won by forfeit**
  line under the winner's name.

`app/game/[id].tsx` derives both from the game row and the event log:
`canceled = game.status === 'canceled'`, and `wonByForfeit` from the
`game_complete` event's `by_forfeit` (it already passes the full `events` array,
so nothing new is fetched). `FinalScoreButton` is unchanged and reopens either.

### `app/(app)/games.tsx`

`GameHistoryRow` renders a muted **Canceled** tag next to the date when
`game.status === 'canceled'`. Both kinds share the one History section, and both
stay openable so the final board can be inspected.

## 6. Stats

### `lib/stores/useStatsStore.ts`

`GameResult` picks up `forfeit: boolean` from the regenerated row type. No query
change — canceled games have no rows to exclude.

### `lib/stats.ts`

The rule, from the top: **a forfeited game counts toward games played and win
rate, and nothing else.**

```ts
const played = results.filter((r) => !r.forfeit)
```

| stat                                                                       | over      |
| -------------------------------------------------------------------------- | --------- |
| `gamesPlayed`, `wins`, `winRate`                                           | `results` |
| `avgPoints`, `avgPlacement`, `avgRounds`, `avgPlayers`                     | `played`  |
| `bonusGames`, `bonusesPlayed`, `cursesPlayed`, `topPickRate`, `topWinRate` | `played`  |
| `distinctOpponents`, `topOpponents`                                        | see below |

New field `playedGames: number` (`played.length`) so the screen can say when the
two denominators differ.

`completeGames` now contains canceled games (they share the History list), so
`computeStats` filters them out itself:

```ts
const counted = completeGames.filter((g) => g.status !== 'canceled')
```

Forfeited games stay in `counted` — you did sit down with those people, and the
Friends section is about who you play with, not about how the game finished.
Keeping the filter inside `computeStats` rather than at the call site keeps the
whole "what counts" rule in one readable place.

### `app/(app)/stats.tsx`

One addition: a muted footnote under the Games grid when
`playedGames < gamesPlayed` —

> Averages exclude 2 forfeited games.

Without it, "Win rate 62% (8 of 13 games)" sitting beside an Avg points computed
over 11 is a discrepancy with no explanation on screen. Everything else on the
screen is unchanged.

### `dev/check-stats.ts`

New cases: all-forfeit input (averages are 0, win rate is real), a mix of
forfeit and played results (each average over the right subset), and a
`completeGames` list containing a canceled game (excluded from
`distinctOpponents` / `topOpponents`).

## 7. Docs to update

- `lib/catan/CLAUDE.md` — a **Forfeiting and ending** section: the two flags are
  metadata on `games` and nothing in the rules layer reads them; the two
  thresholds; the new event kinds; `GameOverOverlay`'s two new modes.
- `lib/game/CLAUDE.md` — `Nav.tsx` now hosts `GameMenu`, the one thing on the
  screen besides the title that is _about_ which game you're on.
- `lib/stores/CLAUDE.md` — `completeGames` holds canceled games as well as
  completed ones; `isFinished` is the single status test.
- `supabase/functions/CLAUDE.md` — `set_forfeit` / `set_end_vote`, the
  `commitActionWrite` options bag, and the four ungated notification kinds.

## 8. Out of scope

- Skipping forfeited players in turn order, or any other mechanical effect of a
  standing forfeit.
- Any timeout / auto-forfeit for an inactive player.
- Kicking or vote-kicking a player.
- Per-opponent forfeit records, or any stat _about_ forfeiting.
- Backfilling `game_results.forfeit` — every existing row is correctly `false`.
- Reopening or un-canceling a finished game.

## 9. Checklist

- [ ] Migration: `games.forfeits` / `games.end_votes`, `canceled` status,
      `game_results.forfeit`. `npm run migrate`, then `npm run types`.
- [ ] Edge: `set_forfeit` / `set_end_vote` handlers, `commitActionWrite` opts,
      `writeGameResults` forfeit flag, `GameRow.status` widened. `npm run edge`.
- [ ] Edge: four notification kinds in `_notify`.
- [ ] Store: event union, `setForfeit` / `setEndVote`, `isFinished`, widened
      completed-games query, `handleGameChange`.
- [ ] Screen context: `inGameOver`, `displayVP`, the menu's derived state and
      handlers.
- [ ] UI: `GameMenu` + `Nav` slot, `PlayerStrip` flag, `ActionLog` copy,
      `GameOverOverlay` canceled / forfeit modes, History row tag.
- [ ] Stats: `lib/stats.ts` split, `playedGames`, canceled-game filter, the
      stats-screen footnote, `dev/check-stats.ts`.
- [ ] Docs (§7). `npm run check` && `npm run format`.
