# Moving `current_turn` to `game_states`

Follow-up to `.claude/specs/pending-action-signal.md`, which removed the reason
the column was on the wrong table.

## Why

`games` is identity: participants, seating, colors, immutable config, and the
event log. `game_states` is progress. `current_turn` is progress — it moves
several times a turn — and it sat on `games` for one reason: the Games list
loads `games` rows and nothing else, so a turn pointer anywhere else was
invisible to it. `useGameStatesStore` removed that constraint.

## Shape: two releases

`games.current_turn` cannot simply move, because a client that hasn't updated
still reads it. So:

- **Release 1 (this spec).** Add `game_states.current_turn`, backfill it, and
  make it the source of truth: every writer writes both columns in the same
  statement it already writes, every reader reads the new one. Old clients keep
  working off the mirror. Ship, and let it reach users.
- **Release 2 (later, separate).** Drop `games.current_turn` and delete the
  mirror writes. Nothing reads it by then, so the migration can't break a client
  that is still running — but the deploy order flips; see below.

The mirror is written **inline at each existing write site**, not derived
afterwards in `serve` alongside `deadline_at`. `serve`'s post-action bookkeeping
runs inside `waitUntil`, after the response — an old client would get the
`games` UPDATE carrying `events` first and the turn pointer a beat later, and in
that window its UI reads "the previous player is still up" against a log that
has already moved on. Writing both in one statement makes the two columns
change atomically, which is the entire point of keeping the mirror.

## Migration

`supabase/migrations/<ts>_current_turn_on_game_states.sql`:

```sql
alter table public.game_states add column current_turn integer;

update public.game_states s
set current_turn = g.current_turn
from public.games g
where g.id = s.game_id;
```

Nullable on purpose — `null` is meaningful (nobody holds the turn through the
simultaneous `select_bonus` phase). No RLS change: `game_states` already governs
row access and a new column needs no new policy.

Then `npm run migrate`, then `npm run types`.

## Server (`game-service`)

- `loadGame` reads `current_turn` off the state row into `GameState.currentTurn`
  — the one place the field is constructed.
- **~38 reads of `game.current_turn` become `state.currentTurn`.** Almost all
  sites already destructure `{ game, state }` from `loadGame`. Three don't and
  need a signature touch:
    - `currentPlayerIndex(game, me)` — takes the pointer as an argument.
    - `applyRollOutcome` — has `state`; its structural `game` param drops the
      field.
    - `refreshDeadline` — already reads `game_states.phase` inside its `live`
      branch, so it takes `current_turn` from that same read and stops selecting
      it from `games`. (A game with no clock still pays for no state read.)
- **7 writes** (`handleRespond`'s insert, `handlePickBonus`, the two
  `place_start` paths, `choose_last_settlement`, `end_turn`) write the same
  value into the `game_states` update they already issue, keeping the `games`
  write as the mirror. Release 2 deletes the `games` half of each.
- `GameRow.current_turn` stays in the type, marked as the deprecated mirror, so
  the writes still type-check.
- **`UNDO_COLUMNS` deliberately does not gain `current_turn`.** The snapshot is
  restored wholesale, and no undoable action moves the turn (they're all solo
  and information-free), so including it would only create a way for the mirror
  and the source to disagree after an undo. The comment on `UndoSnapshot.state`
  in `lib/catan/types.ts` says exactly this today about the `games` column and
  needs rewording, not reversing.

## Server (`_notify`)

`badgeCounts` embeds `game_states(phase, current_turn)` and stops selecting
`games.current_turn`.

## Client

- `GameState` gains `currentTurn: number | null` (`lib/catan/types.ts`), so it
  rides in `BoardState` and `useGameStatesStore`'s `rowToState`. Required, not
  optional — the migration backfills every row, so a missing value is a bug
  rather than a legacy shape. `initialGameState`, the edge mirror's copy, and
  `dev/backfill-game-results.ts`'s own `rowToState` all have to supply it; the
  compiler finds them.
- The ~15 `game.current_turn` reads in `lib/game/*` and `lib/game/hud/*` become
  `gameState.currentTurn`. All are game-screen surfaces that already hold a
  `GameState`.
- `isMyTurn(game, state, meId)` takes the board rather than the phase.

### The cold-start fallback goes away

`pendingUserIds` currently falls back to `current_turn` when the phase hasn't
loaded, because the games row had an answer and the state row hadn't arrived.
After this, both come from the same row: no phase means no pointer either, and
there is nothing to fall back to.

So the contract changes from "guess" to "don't answer": `isMyTurn` returns false
for a game whose board hasn't loaded, and **`useAppBadge` treats a not-yet-loaded
state the way it already treats `activeGames === undefined` — count `null`, leave
the badge alone**. That is strictly better for the icon (a cold start can't blank
a badge a push set correctly, which was the fallback's whole purpose) and costs
the Games list dot a sub-second delay on cold start, since the states load
alongside the games.

`pendingUserIds` keeps taking the pointer as a plain argument, so it stays pure
and testable and doesn't care which row it came from.

## Verification

- Existing games keep playing across the deploy: take a turn from a client built
  before the change and one built after, in the same game.
- `dev/check-catan-timeout.ts` passes (it feeds the pointer in directly).
- Undo a road build: the turn pointer is unchanged and both columns still agree.
- A 7-roll chain, a special build slot, and a bonus selection each advance the
  turn correctly.
- The mirror-drift check below returns nothing after a few real turns. This is
  the query to run before scheduling release 2:

```sql
select g.id, g.current_turn, s.current_turn
from public.games g
join public.game_states s on s.game_id = g.id
where g.current_turn is distinct from s.current_turn
  and g.status in ('placement', 'active');
```

## Docs to update

- `lib/catan/CLAUDE.md` — the phases section states `games.current_turn` is null
  through `select_bonus`; that fact moves rows.
- `lib/stores/CLAUDE.md` — `isMyTurn`'s inputs.
- `supabase/functions/CLAUDE.md` — the badge paragraph and the `set_forfeit`
  note, which names `currentPlayerIndex`.
- `.claude/specs/pending-action-signal.md` — its "not in scope" section becomes a
  pointer here.

## Release 2: dropping the mirror

The code half is small — the six `games` updates stop naming the column,
`GameRow` stops declaring it, and a migration drops it. Nothing else in the repo
referenced it: no RLS policy, index or view, and no client read (the game screen
moved to `gameState.currentTurn` in release 1).

**The deploy order is the reverse of release 1, and getting it wrong takes the
game down.** Release 1 could migrate first because the new column was inert
until the edge function used it. Here the column is in use until the moment the
edge function stops naming it, so:

1. Confirm the mirror-drift query above returns nothing.
2. Confirm the rollout: no meaningful traffic from builds predating release 1.
   Those clients read `games.current_turn` for their turn indicator, and it
   stops moving the moment step 3 lands — before it disappears entirely.
3. **`npm run edge`** — handlers stop writing the column.
4. **`npm run migrate`** — drop it.
5. `npm run types`, and commit the regenerated `lib/database-types.ts`.

Between 3 and 4 the column simply freezes at its last value, which is harmless
for anything still reading it and invisible to everything else. The other order
— dropping while handlers still name the column in an `update` — fails every
write, so every action in every game 500s until the deploy catches up.

The client needs no release of its own. A release-1 build reads the column
nowhere, and `select *` just returns one field fewer.
