# "I'm back" — clearing your own timeout penalty

Builds on `.claude/specs/move-timeouts.md`.

## Problem

A seat skipped by a timeout joins `games.timed_out`, and every later window of
theirs is one minute (`TIMEOUT_PENALTY_MS`) until they take a real move. Off-turn
windows (special build, discards) come round often, so a returning player can be
skipped again before they get a chance to make a move that clears the flag.

## Design

### Server — `clear_timeout { game_id }`

- New `game-service` action, member of `TIMEOUT_NEUTRAL_ACTIONS`: it never moves
  phase, so it skips the autopilot + `refreshDeadline` after-hook (which would
  otherwise re-stamp a fresh full window for whoever _else_ is on the clock).
- Guards: game in progress (`placement` / `active`), caller is seated.
- Idempotent: caller not in `timed_out` → 200, no write.
- Writes `timed_out` without the caller. **Only if the caller is among
  `pendingSeats`** does it also re-stamp `deadline_at` (via `deadlineFor` with the
  new `timed_out`) and reset `timeout_warned` — a full window from now, unless
  another pending seat is still penalized (parallel discard), in which case the
  window stays one minute. Another player's deadline is never touched.
- No event log entry, no notification.

### Client

- `useGamesStore.clearTimeout(gameId)`.
- `gameScreenContext` exposes `myTimedOut` (seated, game in progress, not
  forfeited, `user.id` in `game.timed_out`) and `onClearTimeout`. Sent directly
  (not queued, no barrier flush) — like honk, it's move-neutral.
- `TimeoutBanner` over the board in `BoardArea` (shared by HUD and classic),
  in the same in-flow banner stack as the trade banner. Visible on and off turn.
  Copy: "You timed out — you have 1 minute per move." + **I'm back**.
- Forfeited seats don't see it — autopilot plays them regardless.

## Out of scope

- Changing the penalty length or exempting special build.
