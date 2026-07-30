# Move timeouts

A per-game config option that puts every pending action on a clock. When the
clock runs out the table moves on without the player who is holding it up: at
two players that ends the game (the absent player loses), at three or more the
seat is skipped.

The clock is a **game-level idle clock**, not a per-player one — the same model
as the Honk nudge (`lib/catan/honk.ts`). Any action by anyone pushes the
deadline out; it only bites when the whole table has gone quiet, which is
exactly the state the feature exists to break.

## 1. Config

`GameConfig.timeout: TimeoutOption | null`, default `null` (no timeout). Ten
values, in `lib/catan/timeout.ts`:

```ts
export const TIMEOUT_OPTIONS = [
	'1h',
	'3h',
	'12h',
	'1d',
	'2d',
	'3d',
	'4d',
	'5d',
	'6d',
	'7d',
] as const
export type TimeoutOption = (typeof TIMEOUT_OPTIONS)[number]
```

- `timeoutMs(option)` → milliseconds.
- `timeoutLabel(option)` → `'1 hour'`, `'3 hours'`, `'12 hours'`, `'1 day'`,
  `'2 days'` … `'7 days'`. One place for the copy; the Select, the config
  summary and the warning push all read it.

Parsed defensively in `parseGameConfig` like every other field — anything not in
`TIMEOUT_OPTIONS` (including a missing key, which is every pre-existing row)
falls back to `null`, so no in-flight game acquires a clock.

`summarizeGameConfig` appends `` `${timeoutLabel(t)} timeout` `` when non-null.
The default is `null`, so the existing "only non-default options are called out"
rule already gives us "note it if present, say nothing if absent" for free — this
is what shows up in the game-request description on `/game/request/[id]`.

`GameDefaults` (`lib/stores/useProfileStore.ts`) gains `settings.timeout` so the
choice is saveable as a personal default and travels through a rematch, same as
every other setting.

### 1a. The Select primitive

Ten options don't fit the existing `SegmentedRow`, and there is no select in
`lib/modules/` yet — so add one: **`lib/modules/Select.tsx`**, a general
primitive, not a timeout-specific picker.

- Renders a row: optional leading icon, label + description, current value and a
  chevron on the right. Tapping opens a `Modal` (the base primitive — never a
  raw RN `<Modal>`) listing the options, the selected one check-marked, tapping
  one selects and dismisses.
- Props: `label`, `description?`, `icon?`, `value`, `options: { key, label }[]`,
  `onSelect(key)`, `placeholder?`.
- Sized to line up with `CompactToggleRow` in the create-game options list so a
  row of controls stays visually even.

Used on the create-game screen inside **Game settings**:

```
⏱  Move timeout                                None ›
   Skip a player who doesn't take their turn in time.
```

Options: `None` plus the ten labels.

## 2. Schema

One migration, `supabase/migrations/<ts>_game_timeouts.sql`. All three columns
go on **`games`** — this is game metadata like `config` / `forfeits`, not board
state, and the sweep has to be able to find expired games with one indexed
query without touching `game_states`.

```sql
alter table public.games
    add column deadline_at timestamptz,
    add column timeout_warned smallint not null default 0,
    add column timed_out uuid[] not null default '{}';

create index games_deadline_idx on public.games (deadline_at)
    where status in ('placement', 'active');
```

- **`deadline_at`** — when the currently-pending action expires. `null` when the
  game has no timeout configured, or has ended. Computed and written, never
  derived at read time, so the sweep's query is a plain indexed range scan and
  the client can render a countdown straight off the row it already subscribes
  to.
- **`timeout_warned`** — the highest warning stage already pushed for the
  _current_ `deadline_at`: `0` none, `1` the one-hour warning, `2` the ten-minute
  warning. Reset to `0` every time `deadline_at` moves.
- **`timed_out`** — user ids that have been skipped by a timeout and have not
  acted since. Drives the one-minute penalty window (§4) and is cleared per-user
  the moment they take any real action.

No RLS change: `games` is already selectable by participants and spectators, and
already in the realtime publication, so the countdown arrives on the channel the
game screen is on.

### 2a. The scheduler

`pg_cron` + `pg_net`, in the same migration:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('game-timeouts', '* * * * *', $$ … net.http_post(…) … $$);
```

The job POSTs `{"action":"run_timeouts"}` to the `game-service` function every
minute, with the service-role key as its bearer token. **The key is read from
Vault, not written into the migration** — the migration references
`(select decrypted_secret from vault.decrypted_secrets where name =
'service_role_key')`, and the one-time
`select vault.create_secret('<key>', 'service_role_key')` is run by hand in the
SQL editor. A committed migration must never contain the key.

A minute of granularity is right for a feature whose shortest window is an hour,
and it is what makes the one-minute penalty window land promptly (worst case
~2 minutes).

**Why a server sweep at all**: the warning push has to fire when nobody has the
app open — that is the entire point of it — so a client-scheduled local
notification can't be the mechanism (the client can't schedule anything for a
turn that arrived while it was closed). Applying the timeout is a state mutation
and has to be server-authoritative regardless.

## 3. Shared rules: `lib/catan/timeout.ts`

Pure, no I/O, mirrored in the edge function like every other rules module, with
`dev/check-catan-timeout.ts` exercising it.

- `TIMEOUT_OPTIONS` / `TimeoutOption` / `timeoutMs` / `timeoutLabel` (§1).
- `TIMEOUT_PENALTY_MS = 60_000` — the one-minute window (§4).
- **`pendingSeats(phase, currentTurn): number[]`** — every seat the game is
  waiting on right now. This is the one derivation behind all three consumers
  (who to warn, who to skip, whose countdown the UI shows), so they can't
  disagree. An exhaustive `switch` over `Phase['kind']`, so a new phase fails to
  compile rather than silently never timing out — same discipline as
  `spectatorStatus` in `lib/game/TopArea.tsx`:

    | Phase                                                   | Pending seats                                                                         |
    | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
    | `select_bonus`                                          | every seat whose `hands[i].chosen` is `null`                                          |
    | `initial_placement` (all three steps)                   | `currentTurn`                                                                         |
    | `post_placement`                                        | every seat with an entry in `pending.specialist` / `.explorer` / `.fencer` / `.haunt` |
    | `roll`, `main`, `move_robber`, `steal`, `road_building` | `currentTurn`                                                                         |
    | `discard`                                               | every seat still in `pending`                                                         |
    | `scout_pick`                                            | `owner`                                                                               |
    | `curio_pick`                                            | every seat in `pending`                                                               |
    | `forger_pick`                                           | `queue[0].idx`                                                                        |
    | `magician_pick`                                         | `roller`                                                                              |
    | `special_build`                                         | `queue[0]` — **not** `currentTurn`, which has already advanced                        |
    | `game_over`                                             | none                                                                                  |

- **`deadlineFor({ config, phase, currentTurn, playerOrder, timedOut, now })`** →
  `string | null`. `null` when `config.timeout` is null. Otherwise
  `now + TIMEOUT_PENALTY_MS` if **any** pending seat's user id is in `timedOut`,
  else `now + timeoutMs(config.timeout)`.

## 4. The one-minute penalty window

Once a seat has been skipped by a timeout it is added to `games.timed_out`, and
every subsequent deadline that seat is pending for is **one minute** instead of
the configured window. It reverts to the full window the moment that user takes
any real action (they are dropped from `timed_out`).

So an absent player is skipped about once a minute rather than stalling the
table for another full timeout each go-around, and a player who comes back is
immediately treated normally again. A flagged seat gets **no warning pushes** —
there is no room for a ten-minute warning inside a one-minute window.

Note the flag is only consulted for seats that are _currently pending_: after A
is skipped, B is on the clock and gets the full window; when the turn comes back
around to A, the window is a minute again.

## 5. Keeping `deadline_at` current

Written in exactly **one place**, the `serve` wrapper in `game-service`,
alongside the existing `trackUndo` bookkeeping — not in the ~50 handlers. After a
successful dispatch, inside `EdgeRuntime.waitUntil` (nothing downstream is
waiting on it):

1. Re-read the `games` row (post-action) — a targeted select, not `loadGame`.
2. Drop the caller from `timed_out`.
3. Read `game_states.phase` **only if a timeout is configured**, so a game with
   no clock (the default, and most of them) never pays for the second read.
4. Write `deadline_at = deadlineFor(…)`, `timeout_warned = 0`. A game with no
   clock whose `deadline_at` is already null writes nothing at all, so the
   common case costs no extra realtime event either.

Two exclusions, both deliberate:

- **`honk` and `send_message` are not activity.** A honk writes a `games.events`
  entry but must not push the deadline out — the same reason `lastActivityAt`
  excludes honks: the nudge is a complaint about the stall, not an escape from
  it. Chat likewise.
- A game that just ended (`status` not in `placement`/`active`) gets
  `deadline_at = null`.

This is also the reason the sweep can't just re-derive the deadline from
`games.events`: the events array holds no notion of a penalty window, and
scanning a jsonb array per game per minute is not indexable.

## 6. The sweep: `action: 'run_timeouts'`

A new action on `game-service` rather than a second edge function — the auto
actions reuse the existing handlers wholesale, and those live here (see
`supabase/functions/CLAUDE.md`: grow this function before adding another).

**Authorization**: `run_timeouts` is the one action with no user JWT. `serve`
checks the `Authorization` bearer against `SUPABASE_SERVICE_ROLE_KEY` before the
usual `callerUserId` path and rejects anything else with 401. It never carries a
`game_id`, so it also skips the undo baseline and the §5 bookkeeping.

### 6a. Selection

```
select … from games
where status in ('placement','active')
  and deadline_at is not null
  and deadline_at <= now() + interval '61 minutes'
```

One indexed query; the per-row decision (warn vs expire vs nothing) happens in
TS. The 61-minute horizon is the widest warning lead plus a tick of slack.

### 6b. Warnings

For a game not yet expired, with `pending = pendingSeats(...)` minus any seat in
`timed_out`:

| Stage | Fires when                                       | Only for       |
| ----- | ------------------------------------------------ | -------------- |
| 1     | `now >= deadline − 1h` and `timeout_warned < 1`  | timeouts ≥ 12h |
| 2     | `now >= deadline − 10m` and `timeout_warned < 2` | every timeout  |

Push `turn_timeout_warning` to each pending seat, then bump `timeout_warned`.
1-hour and 3-hour games get only the ten-minute warning, per the design.

### 6c. Expiry — two players

The timed-out player is added to `games.forfeits` and the game ends with the
other player as winner, via the existing forfeit path (`commitActionWrite` with
`byForfeit: true`, `status = 'complete'`, a `game_complete` event carrying
`by_forfeit: true`). No new ending, no new stats shape: it counts toward games
played and win rate exactly like a manual forfeit. The winner gets the existing
`game_won_by_forfeit` push.

**Both seats pending at once** (only reachable in the simultaneous phases —
`select_bonus`, `post_placement`, a two-way `discard`) means nobody is there to
win: the game is **canceled** (`status = 'canceled'`, no winner, no
`game_results` rows) via the same path as a unanimous end-game vote.

### 6d. Expiry — three or more players

Every expired pending seat is auto-resolved, then the turn is ended. The runner
does **not** re-implement any game rules: it picks an arbitrary legal choice and
calls `dispatch(admin, thatUserId, body)` — the ordinary handler, with its own
validation, events, notifications and end-of-game checks. An auto-action is
indistinguishable from that player having tapped the button.

| Phase                              | Auto action                                                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `select_bonus`                     | `pick_bonus` with `hands[i].offered[0]`                                                                                                                                                    |
| `initial_placement` / `settlement` | `place_start` — a random legal vertex, then a random legal edge off it, twice for the back-to-back seat (a whole turn, like a player's)                                                    |
| `initial_placement` / `pick_last`  | `choose_last_settlement` with the round-2 settlement (the value the UI pre-seeds)                                                                                                          |
| `post_placement`                   | `set_specialist_resource` (arbitrary resource) / `place_explorer_road` / `place_fence_token` at random legal edges / `set_haunt_spots` at random legal vertices, one per outstanding entry |
| `roll` (no pending dice)           | `roll`, then `end_turn` once the phase is back to `main`                                                                                                                                   |
| `roll` (gambler pending)           | `confirm_roll`                                                                                                                                                                             |
| `discard`                          | `discard` a random legal selection of the owed count                                                                                                                                       |
| `move_robber`                      | `move_robber` to a random hex other than the current one                                                                                                                                   |
| `steal`                            | `steal` from a random candidate                                                                                                                                                            |
| `road_building`                    | `build_road` at a random legal edge, per remaining road                                                                                                                                    |
| `main`                             | `end_turn`                                                                                                                                                                                 |
| `special_build`                    | `end_special_build`                                                                                                                                                                        |
| `scout_pick`                       | `confirm_scout_card` with index 0                                                                                                                                                          |
| `curio_pick`                       | `claim_curio` with an arbitrary legal take                                                                                                                                                 |
| `forger_pick`                      | `pick_forger_target` with the first candidate                                                                                                                                              |
| `magician_pick`                    | `skip_magic`                                                                                                                                                                               |
| `game_over`                        | nothing (and `deadline_at` is cleared)                                                                                                                                                     |

**Bounded loop.** After each auto action the runner re-reads the game and
repeats, up to `MAX_TIMEOUT_STEPS` (12) per game per tick, stopping as soon as
the pending seats no longer intersect the expired set, or the game ends. That
way an abandoned turn that rolls a 7 clears the whole chain — roll → discard →
move robber → steal → end turn — in one sweep, instead of dribbling out over
five minutes. Hitting the cap is not a failure: the next tick continues.

**No legal option** for a sub-phase (a state a human couldn't act on either)
aborts that game's pass with a `console.warn` and leaves it for the next tick,
rather than throwing and taking the whole sweep down. Only seats the runner
actually moved past are flagged and notified — if nothing was legal, nothing was
skipped, and the row is left untouched.

**The sweep is batched** at `SWEEP_BATCH` (100) games per tick, most overdue
first, and logs when the batch comes back full. Anything left over is still
expired sixty seconds later, so the next tick takes it.

Afterwards the runner writes, itself (the §5 hook doesn't run for a direct
`dispatch`): the skipped seats appended to `timed_out`, a fresh `deadline_at`
(one minute, since a skipped seat that is pending again is flagged),
`timeout_warned = 0`, and `game_states.undo = null` — an auto action must not
leave an undo snapshot behind for someone else to take back.

**Each game is swept independently**; one game's failure never aborts the others.

## 7. Notifications

Two new kinds in `supabase/functions/_notify/index.ts` **and** their twin in
`lib/notifications/links.ts` (a kind added on only one side arrives and does
nothing on tap — this is how `honk` shipped broken). Both deep-link to
`/game/[id]`.

- **`turn_timeout_warning`** — `"Your turn ends in 10 minutes."` /
  `"Your turn ends in an hour."` The lead time varies, so the runner passes it
  as a `bodyOverride`.
- **`turn_timed_out`** — `"You ran out of time — your turn was skipped."`, or
  `"You ran out of time and lost the game."` at two players.

Both are **ungated** (no pref key), like the honk and the four forfeit kinds:
rare, consequential, and about to change the game without you. Only the
timed-out player is told; the next actor already gets the ordinary `your_turn`
push from whichever handler the runner just drove, and a two-player winner gets
`game_won_by_forfeit`.

## 8. Client

### 8a. Countdown

Subtle, and only when it matters: shown once `deadline_at − now <= 60 minutes`
(so it is effectively always on for a 1-hour game, and appears in the last hour
of a 7-day one). Rendered on the **pending seat(s)**, from
`pendingSeats(...)` — not `current_turn`, which is wrong during `special_build`
and null through bonus selection.

- `PlayerStrip` — a small muted time chip on each pending seat.
- `TopArea`'s status line — the same remaining time appended, so a player
  looking at a sub-phase prompt sees it too.

Formatting: `≥ 1m` → `12m`; under a minute → `45s`, ticking each second (the
penalty window lives entirely inside that last minute). A shared
`formatRemaining(ms)` next to the rules module, and a `useCountdown(deadline)`
hook doing a single interval per screen — one timer, not one per seat.

Nothing new on the Games list.

### 8b. Wiring

`games.deadline_at` / `timed_out` join the `Game` row type in
`lib/stores/useGamesStore.ts` (and `lib/database-types.ts` via `npm run types`).
No new fetch or channel — the game screen already subscribes to this row, and
the store already refetches on foreground.

## 9. Files

**New**

- `lib/catan/timeout.ts` — options, labels, `pendingSeats`, `deadlineFor`, penalty constant
- `lib/modules/Select.tsx` — the general select primitive
- `dev/check-catan-timeout.ts` — checks for the above
- `supabase/migrations/<ts>_game_timeouts.sql` — columns, index, cron job

**Changed**

- `lib/catan/types.ts` — `GameConfig.timeout`, `DEFAULT_CONFIG`, `parseGameConfig`, `summarizeGameConfig`
- `lib/stores/useProfileStore.ts` — `GameDefaults.settings.timeout` + parse
- `lib/stores/useGamesStore.ts` — `Game` row fields
- `app/(app)/create-game.tsx` — the Select row, form state, rematch/defaults plumbing
- `lib/game/TopArea.tsx`, `lib/catan/PlayerStrip.tsx` — the countdown
- `lib/notifications/links.ts` — the two new kinds
- `supabase/functions/_notify/index.ts` — the two new kinds + copy
- `supabase/functions/game-service/index.ts` — mirrored rules, `deadline_at` bookkeeping in `serve`, `run_timeouts`
- `lib/catan/CLAUDE.md`, `lib/modules/CLAUDE.md`, `lib/notifications/CLAUDE.md`, `supabase/functions/CLAUDE.md`, `lib/stores/CLAUDE.md`

## 10. Decisions taken, and their consequences

- **A timeout has no effect on a game with no timeout configured** — `null` is
  the default and every pre-existing row parses to it, so nothing in flight
  changes behaviour.
- **The clock is global, not per-seat.** In a parallel phase, one player acting
  buys everyone else another full window. Simpler than per-seat deadlines, and
  it can't punish a table that is visibly playing.
- **A forfeited seat still times out.** Forfeiting has no mechanical effect
  (`lib/catan/CLAUDE.md`), so a forfeited player still holds their turn — and
  with the penalty window, gets skipped in about a minute.
- **Timeouts never end a 3+ player game on their own.** The table keeps its
  existing tools: the forfeit and end-game-vote declarations.
- **An auto action is logged as the player's own.** It goes through the normal
  handler, so `ActionLog` shows a normal roll/discard/end turn. No new event
  kinds; nothing downstream (stats, highlights, the log's filters) needs to
  learn about timeouts.
