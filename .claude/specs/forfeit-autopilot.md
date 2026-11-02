# Forfeit autopilot

Branch: `forfeit-autopilot`, off `main`. Amends `forfeit-and-end-game.md`, whose
central rule — "a forfeit has no mechanical effect" — this reverses.

Today a forfeited player in a 3+ game keeps the turn, so the table stalls on
them until the move timeout (if any) kicks in. Instead, a standing forfeit now
puts the seat on **autopilot**: whenever the game is waiting on a forfeited
seat, the server immediately acts for it — rolling and ending the turn — and
any decision the player would have had to make is **skipped**, as if that step
never happened.

## 1. Decisions (settled)

- **Still withdrawable.** Withdrawing just turns autopilot off; the seat never
  left turn order, so nothing needs splicing back. Seat keeps its hand, bonus
  and pieces throughout.
- **Immediate, server-side.** Autopilot runs inside the same request, under the
  game lease, right after any action that leaves a forfeited seat pending —
  including the `set_forfeit` itself when it's the forfeiter's turn.
- **On a forfeiter's 7, only _their_ decisions are skipped.** Other players
  still discard; the forfeiter's robber move and steal are skipped (robber
  stays put). Symmetrically, a forfeiter who owes a discard on someone else's 7
  has that discard skipped and keeps their cards.
- **UI: the seat card fades** (whole card, ~40% opacity) in `PlayerStrip`, and
  the flag icon is dropped.
- Two players: unchanged — one forfeit already ends the game.

## 2. What autopilot does, per phase

Only for the forfeited seat(s) among `pendingSeats(phase, currentTurn)`.
"Dispatch" = an ordinary handler via `dispatch(admin, userId, body)`, as the
timeout runner does. "Skip" = a new server-only transition (§3) that drops the
seat's obligation without taking the action.

| Phase                                        | Autopilot                                                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `select_bonus`                               | dispatch `pick_bonus` with `offered[0]` (+ first curse) — unavoidable, the game needs one                                                                    |
| `initial_placement`                          | dispatch `place_start` with random legal pairs — unavoidable; reuses the timeout runner's placement picker                                                   |
| `post_placement` (specialist/explorer/haunt) | **skip** — drop the seat's entries; specialist stays undeclared, explorer roads unplaced, no haunt spots                                                     |
| `roll`, forger token must move               | dispatch `move_forger_token` to a random adjacent hex (it gates the roll)                                                                                    |
| `roll`, gambler dice pending                 | dispatch `confirm_roll` `which: 0`                                                                                                                           |
| `roll`                                       | dispatch `roll`                                                                                                                                              |
| `main`                                       | dispatch `end_turn`                                                                                                                                          |
| `special_build`                              | dispatch `end_special_build`                                                                                                                                 |
| `discard` (seat owes)                        | **skip** — drop the seat from `pending`, keep its cards; if pending empties, proceed exactly as the last real discard would (deferred gains → `move_robber`) |
| `move_robber`                                | **skip** — robber stays, phase → `resume`, through the same 7-chain exit as a no-candidate move (shepherd payout, fortune teller, magician wrap)             |
| `steal`                                      | **skip** — no steal, same exit                                                                                                                               |
| `road_building`                              | **skip** remaining free roads → `resume`                                                                                                                     |
| `scout_pick`                                 | dispatch `confirm_scout_card` `index: 0` (the card was paid for)                                                                                             |
| `curio_pick`                                 | **skip** — drop seat from `pending`, no resources                                                                                                            |
| `forger_pick` (seat is `queue[0]`)           | **skip** — pop the queue head, no copy                                                                                                                       |
| `magician_pick`                              | dispatch `skip_magic` (pays the withheld roll gain, as a decline does)                                                                                       |
| `game_over`                                  | nothing                                                                                                                                                      |

`autopilotStepFor(state, game, seat)` is an exhaustive `switch` over
`Phase['kind']` (new phase fails to compile), returning either
`{ dispatch: Body }` or `{ skip: SkipKind }`, or `null` when nothing is legal.

## 3. Edge function — `supabase/functions/game-service/index.ts`

### Extracted transitions (shared with the real handlers)

So a skip can't drift from the action it replaces, each "this obligation is
resolved, move on" tail is pulled out of its handler into a pure helper that
both the handler and the skip call:

- `afterDiscard(state, players, seat)` — removes `seat` from `discard.pending`;
  if empty, applies nomad/investor deferred gains and goes to `move_robber`.
  Used by `handleDiscard`.
- `exitRobberChain(state, players, events)` — the `phase.resume` landing with
  shepherd payout, fortune-teller chain, magician wrap. Used by
  `handleMoveRobber` (0/1 candidate), `handleSteal`, and the skip. Async
  (fortune teller).
- `afterPostPlacement(state, phase)` — drain-to-`roll` once all post-placement
  entries are gone. Used by the specialist/explorer/haunt handlers.
- curio / forger / road-building: their existing "drop from pending / pop head
  / → resume" tails, same treatment.

### `applyAutopilotSkip(admin, game, state, seat, kind)`

Loads nothing itself; computes the next state via the helpers above, writes
`game_states` + appends events (state → games, same order as handlers).

### Event

One new kind, written by every skip:

```ts
{ kind: 'autopilot_skipped', player: number, step: SkipKind, at: string }
type SkipKind = 'discard' | 'robber' | 'steal' | 'road_building'
              | 'post_placement' | 'curio' | 'forger'
```

Dispatched steps log their ordinary events (roll, end turn…), like the timeout
runner.

### `runAutopilot(admin, gameId)`

Bounded loop (`MAX_AUTOPILOT_STEPS = 24` — enough for consecutive forfeited
seats in a 6p game each rolling a 7): reload, find pending seats ∩
`games.forfeits`, take the first, run its step, repeat until none is pending or
the game ends. A `null` step or a rejected dispatch logs a warning and stops
(the move timeout remains the backstop). Returns whether anything moved.

Called from:

1. **`serve`'s locked `after`**, after every successful game action (including
   `set_forfeit`), **before** `refreshDeadline` so the deadline is stamped for
   whoever is pending after autopilot. Runs for `TIMEOUT_NEUTRAL_ACTIONS` too?
   No — those never move the phase, so they can't hand a forfeiter the floor.
2. **The timeout sweep**: `sweepGame` runs `runAutopilot` first (covers forfeits
   that were standing when this shipped, and turns the timeout runner hands to a
   forfeiter); then `applyTimeout`, if still expired, runs it again after its
   own loop.

### `handleSetForfeit`

No logic change — the serve hook covers the immediate trigger. Error copy and
the threshold rule are unchanged.

### Notifications (`_notify`)

`your_turn` and `discard_required` are **not sent to a user in that game's
`forfeits`** — autopilot will have acted before they could tap it.
`sendNotifications` does one `games.forfeits` lookup for the game ids among
those kinds' targets. Everything else (forfeit, trade, chat, honk…) unchanged.

## 4. Client

### `lib/stores/useGamesStore.ts`

`GameEvent` gains `autopilot_skipped`. Comment on the forfeit events updated
(no longer "keeps their turn").

### `lib/catan/ActionLog.tsx`

`autopilot_skipped` → e.g. `bob's robber was skipped (forfeited)`,
`bob's discard was skipped (forfeited)`. Not in a category bucket except
`robber`/`discard`-related ones going under **Robber** (discard, robber, steal).

### `lib/catan/PlayerStrip.tsx`

Forfeited seat: whole card at reduced opacity; flag icon removed. Prop comment
updated.

### `lib/game/GameMenu.tsx`

Copy reflects autopilot:

- Section description: "Forfeit and your turns are played automatically — you
  roll and end turn, nothing else. The last player left standing wins."
- Confirm body: "Everyone will see it. Your turns will be rolled and ended for
  you until you withdraw. If every other player has also forfeited, the game
  ends now and the remaining player wins."

### Local queue

`onSetForfeit` already calls `flushBeforeBarrier()` first, so queued builds land
before autopilot ends the turn. No change.

### Also fixed

`autoActionFor`'s `roll` case now moves a forger's token first (it gates the
roll). The timeout runner had the same gap, and now shares the fix.

## 5. Docs

- `lib/catan/CLAUDE.md` — rewrite the Forfeiting section: forfeit now has one
  mechanical effect (autopilot); thresholds unchanged; fade in `PlayerStrip`.
- `supabase/functions/CLAUDE.md` — `runAutopilot`, where it hooks in, the
  extracted transitions, the notification suppression.
- `lib/game/CLAUDE.md` if it mentions forfeit semantics.
- `forfeit-and-end-game.md` — note at top that §1 is superseded by this spec.

## 6. Out of scope

- Trades addressed to a forfeiter (they never respond; the proposer can
  cancel).
- Making forfeiters ineligible as steal victims.
- Auto-forfeiting idle players.

## 7. Checklist

- [ ] Extract shared transitions; handlers use them (behaviour unchanged).
- [ ] `autopilotStepFor`, `applyAutopilotSkip`, `runAutopilot`; hook in `serve`
      and `sweepGame`/`applyTimeout`.
- [ ] `_notify` suppression.
- [ ] `autopilot_skipped` event: edge + `GameEvent` + `ActionLog`.
- [ ] `PlayerStrip` fade; `GameMenu` copy; forfeit flushes queue.
- [ ] Docs. `npm run check`, `npm run format`, `npm run edge`.
