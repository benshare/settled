# Avarice: voluntary discard (+ per-game write lock)

Two parts in one branch. Part 1 is a prerequisite surfaced by part 2: an
off-turn action is the first thing that routinely writes a game row while
another seat is mid-action.

## Part 1 — per-game lease lock

### Problem

Every game-service handler is load → compute → write the whole column
(`players`, `phase`, `games.events`, …) with no check that the row moved in
between. Two concurrent actions on one game = last write wins, silently undoing
the other. Already latent today (parallel 7-discards, `post_placement`, trade
responses); off-turn avarice discards make it routine.

### Design

Serialize game-scoped actions per game with a short lease, taken **in front of**
the handlers so none of the ~29 write sites change.

- Migration: table `game_locks (game_id uuid pk references games on delete
cascade, token uuid not null, expires_at timestamptz not null)`. RLS enabled,
  no policies (service role only).
- RPC `acquire_game_lock(p_game_id uuid, p_token uuid, p_ttl_ms int) returns
boolean`: insert, or on conflict take over only where `expires_at < now()`;
  true iff the row now holds `p_token`.
- RPC `release_game_lock(p_game_id uuid, p_token uuid)`: delete where token
  matches (a lease that expired and was taken over is not released by the old
  holder).
- Edge helper `withGameLock(admin, gameId, { waitMs, ttlMs }, run, after?)` in
  `supabase/functions/_shared/gameLock.ts`: acquire with backoff (25ms
  doubling to 250ms); `{ locked: false }` once `waitMs` is spent. `after` is
  backgrounded work that still needs the lease (run in `waitUntil`, lease
  released when it finishes). `serve` waits 5s then returns **503** (the
  client's flush already treats 5xx as retriable). Lease TTL 10s (30s for the
  sweep, which can chain several auto actions), so a crashed invocation frees
  the game on its own.
- **Where it wraps:**
    - `serve`: around `dispatch` for any body with a `game_id`, and the
      post-action `refreshDeadline` runs inside the lease too (it
      read-modify-writes `timed_out`). The response returns as soon as the
      handler does; `refreshDeadline` + release run in `waitUntil`.
    - `handleRunTimeouts`: around each game's whole check/apply, one try
      (`waitMs: 0`) — a busy game is skipped until the next tick. The sweep calls
      `dispatch` directly, so it must not re-acquire there — the lock lives at
      the two entry points, never inside `dispatch`.
    - Actions without a game (`propose_game`, `respond`, `cancel_request`,
      `delete_account`) are unlocked. `respond` creates the game row; nothing
      else can address it yet.
- Not locked: `waitUntil` notification fan-outs (they don't write game rows).

Latency: +1 DB round trip on the critical path; release is backgrounded. A
contended action waits for the holder to finish.

## Part 2 — avarice voluntary discard

### Rule

A player under `avarice` may discard any cards from their hand, **minimum 2 per
discard** (`AVARICE_MIN_DISCARD`), at any time in an active game, on anyone's
turn. It never changes phase, turn, pending seats, or the move clock.

Allowed phases: every active phase after initial placement **except
`discard`** (would stale the owed count) and **`steal`** (would let the victim
dump the card being stolen). Not allowed in `select_bonus`,
`initial_placement`, `game_over`.

Curse description gains: "You may discard two or more cards at any time."

### Rules layer

A local-queue reducer `applyAvariceDiscard` in `lib/catan/apply.ts` (mirrored)
plus `LocalAction` arm `{ action: 'avarice_discard'; discard: ResourceHand }`
and an `UNDOABLE_ACTIONS` entry. Gates: curse, phase set above, `handSize ≥ 2`,
`canAfford`. Unlike every other reducer it has **no turn gate**. Runs `finish`
with no road recompute (discarding can't change VP, but the shared tail is
cheap and keeps the contract uniform). Emits event
`{ kind: 'avarice_discarded', player, count, at }` — count only, never the
resources.

### Server

- `parseLocalAction` accepts it (so it can ride in a `batch`).
- Single-action `avarice_discard` → `commitLocalActions`, like builds.
- `avarice_discard` added to `TIMEOUT_NEUTRAL_ACTIONS`: off-turn it must not
  refresh the deadline or clear the caller's timed-out flag. (Inside a `batch`
  on their own turn the batch refreshes it anyway, which is right.)

### Client

- **Own turn → queued + undoable; anyone else's turn → sent immediately.**
  "Own turn" = holds the floor: `isSpecialBuildActor` during `special_build`,
  else `currentTurn === meIdx` — except `post_placement`, which is parallel
  and has no barrier, so it sends immediately. Covers the pre-roll case (queued, then the
  roll's barrier flushes it before rolling, so a 7 sees the thinned hand).
  The immediate path goes through `flushBeforeBarrier` like any barrier.
- `gameScreenContext`: `avariceDiscardOpen` state, `onAvariceDiscard`,
  `onAvariceDiscardPress`; `showAvariceDiscard` (curse + phase, via
  `isAvariceDiscardPhase`) and `canAvariceDiscard` (the reducer's full gate
  against `gameState`). Opening it closes the trade composer and vice versa.
- UI, both layouts: a small "Discard" button beside the hand, shown only to the
  avarice player while the phase allows, disabled under 2 cards. It opens
  `VoluntaryDiscardPanel` (in `DiscardPanel.tsx`) in the hand's place: the
  shared `DiscardComposer` capped at the hand, a Cancel link, and a submit
  reading "Pick at least 2" / "Discard N". Closes on submit/cancel and
  whenever `canAvariceDiscard` goes false (e.g. a 7 opens the discard phase).
- `GameEvent` union + `describeEvent`: "X chose to discard N cards" (filter
  groups `robber` and `bonuses`), distinct from the 7-discard line.

### Docs

`lib/catan/CLAUDE.md` (curse mechanic + reducer with no turn gate),
`supabase/functions/CLAUDE.md` (the lock and its two entry points),
`lib/game/CLAUDE.md` if the hand area's contract changes.

### Checks

`dev/check-catan-curses.ts`: allowed/blocked phases, min-2, afford, other
curse rejected, off-turn accepted. `dev/check-catan-apply.ts`: queue
truncation property still holds with the new action.
