# The local action queue: no confirms, batched sends, step-back undo

Today every undoable action is a round-trip. Tapping a build spot raises a
confirm bar, the confirm fires an edge-function call, the server writes the row,
realtime brings it back, and `game_states.undo` holds a single snapshot so the
player can take exactly one step back. A turn that builds three things is three
confirms, three round-trips, and an undo that only ever reaches the last of them.

This replaces that with a **local queue**. Undoable actions no longer confirm and
no longer go to the server when taken — they append to an ordered list held on
the client, which is projected onto the game state so the board, the hand and
every affordance read as though they had happened. Undo pops the last entry.
When the player reaches an action that can't be undone, the whole queue is sent
as one batch immediately ahead of it.

The trade the design makes: a confirm dialog asks "are you sure?" _before_ an
action that can't be walked back; a queue lets the player be unsure for as long
as they like and walk back as far as they like, right up until something forces
the question. Every confirm this removes is one the undo arrow already answered.

## Locked decisions (confirmed with user)

1. **Every action in `UNDOABLE_ACTIONS` goes local** — all thirteen, not just the
   six that confirm today. A queue holding only _some_ undoable actions can't
   step back one at a time: undo would have to walk an interleaved list where
   half the entries are local and half are server rows whose single snapshot
   slot was destroyed by the action after them.
2. **Sub-phase actions are included.** `place_explorer_road` (`post_placement`),
   `cast_magic` / `skip_magic` (`magician_pick`) and free roads during
   `road_building` queue like everything else, which means the client projects
   those phases' own transitions. This is the expensive half of the work and was
   chosen with that understood — see "Projecting sub-phases".
3. **Opponents see nothing until the flush.** A queued build is invisible to the
   table; the log shows the whole turn's worth at once when the batch lands.
   Accepted as what batching means.
4. **An unflushed queue is disposable.** It lives in React state and nowhere
   else. Leaving the game screen, killing the app, or being skipped by the
   move-timeout sweep throws it away, exactly as the placement draft already
   behaves. No persistence, no auto-flush on a timer.
5. **Server-side undo is deleted** — the `game_states.undo` column,
   `handleUndo`, `UndoSnapshot`, and the snapshot/invalidate block in `serve`.
   Once a batch flushes it is final.
6. **A queued winning move does not auto-send.** The projection detects the win
   and says so in the status banner and on the VP track, but the queue stays
   pending and undo stays available; the game ends when the player takes a
   barrier action. The cue is information, not a prompt — it names what ending
   the turn would do, on surfaces that already exist, rather than staging a
   celebration for an outcome that can still be taken back.
7. **Queued pieces are visually indistinguishable from committed ones.** No
   ghosting, no pending badge, no count. It is the player's board.
8. **A failed flush never drops the queue.** Transport failures (network, 5xx)
   pause and retry the same batch with backoff. A 4xx rule rejection stops the
   retry, keeps the queue, and surfaces the server's message.
9. **A barrier is two requests, not one.** `batch` goes up first; the barrier
   action follows as its own call once it lands. `handleBatch` therefore only
   ever runs local actions — folding barriers into it would mean teaching it
   roll, trade, discard and the robber chain, which is most of the dispatcher.
   The cost is a window where the builds are real and the turn hasn't ended: the
   player presses End turn again, and the board was honest throughout.

## The model

```
server state (game_states row, via realtime)
        +
   queue: LocalAction[]        ← ordered, append-only, pop-from-end
        ↓ project
   projectedState: GameState   ← what every surface reads
```

Three rules hold the whole design up:

- **The queue is a list of actions, not of state.** Projection is a fold:
  `queue.reduce(applyLocalAction, serverState)`. Undo is `queue.slice(0, -1)`,
  and the fold re-runs. Nothing has to compute an inverse — the same reason
  server undo restored a snapshot rather than unwinding a build.
- **The fold is the same code the server runs.** Both sides call the same pure
  reducers (`lib/catan/apply.ts`, mirrored into the edge function per this
  repo's standing convention). Drift here means a player builds four things and
  the flush rejects, so this is the one place where a second implementation
  would be actively dangerous.
- **`projectedState` replaces `gameState` for every reader inside the game
  screen.** Not some readers. A single surface left reading the server row shows
  a hand that can afford a road the board says is unaffordable.

## Client state — `lib/game/gameScreenContext.tsx`

```ts
// The actions taken this turn that haven't been sent. Ordered; the last one is
// what undo pops. Never persisted — see locked decision 4.
const [queue, setQueue] = useState<LocalAction[]>([])
// Set while a flush is in flight or waiting out a backoff, so the barrier
// action that triggered it can't fire twice.
const [flush, setFlush] = useState<FlushState>({ kind: 'idle' })
```

`LocalAction` is the wire body minus `game_id` — the exact payload the batch
sends, so nothing is re-derived at flush time:

```ts
type LocalAction =
	| { action: 'build_road'; edge: Edge; use_bricklayer?: boolean; smith_swap?: number }
	| { action: 'build_settlement'; vertex: Vertex; … }
	| … // one per undoable action
```

Derived:

```ts
// What every surface in the game screen reads instead of the raw row.
const projectedState = useMemo(
	() => (gameState ? projectQueue(gameState, meIdx, queue) : undefined),
	[gameState, meIdx, queue]
)
const canUndo = queue.length > 0 && !isSpectator
// Locked decision 6: the frontend knows, the table doesn't yet.
const pendingWin = projectedState?.phase.kind === 'game_over'
```

`canUndo` loses its whole phase branch. The old version asked "does this seat
hold the floor right now?" because the snapshot was a property of the game; a
local queue is a property of this client, and a client only ever queues its own
actions in a phase it was allowed to act in.

## The apply layer — `lib/catan/apply.ts` (new)

The reducers both sides fold with. One per undoable action:

```ts
export type ApplyResult =
	{ state: GameState; events: GameEvent[] } | { error: string }

export function applyLocalAction(
	state: GameState,
	meIdx: number,
	action: LocalAction
): ApplyResult
```

These are **extracted from the existing edge handlers, not written fresh.** Each
handler today is four things in one function: load + auth, validation, a pure
state transition, and the write. The transition is lifted out; the handler keeps
the rest and calls it. `handlePlaceStart` already works exactly this way with
`placeSettlementPiece` / `placeRoadPiece`, so the pattern has precedent here.

Per-action, the transition to extract:

| Action                | Pure transition to lift out of the handler                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `build_road`          | cost resolution (bricklayer / smith / fence-upgrade), `applyCost`, edge write, fence-token consumption, `road_building` remaining/resume |
| `build_settlement`    | cost, vertex write, port acquisition, haunt ghost rules                                                                                  |
| `build_city`          | cost (incl. metropolitan swap), vertex upgrade                                                                                           |
| `build_super_city`    | cost + swap, vertex upgrade                                                                                                              |
| `build_fence`         | 1 wood, `fenceTokens` write                                                                                                              |
| `bank_trade`          | `bankPartitionFor` + `applyBankTradeToPlayer` (already pure in `ports.ts`)                                                               |
| `liquidate`           | piece removal, refund, supply return                                                                                                     |
| `invest`              | `players[me].investments` append, cost                                                                                                   |
| `buy_carpenter_vp`    | cost, VP increment                                                                                                                       |
| `tap_knight`          | knight tap flag, 2-resource grant                                                                                                        |
| `place_explorer_road` | edge write, `post_placement` pending drain                                                                                               |
| `cast_magic`          | discard, phantom production, `pendingGain` payout, phase exit                                                                            |
| `skip_magic`          | `pendingGain` payout, phase exit                                                                                                         |

Plus the shared tail every one of them runs (`finish`): longest-road recompute
where the road graph could have moved, then the win check that sets
`phase: game_over`. That tail is what makes locked decision 6 work — the
projection reaches `game_over` on its own, with no server involved.

**The tail runs per action, not once per batch.** A batch whose second action
wins should stop there, exactly as two separate requests would have; running it
once at the end would let a third action apply on top of a finished game.

**The reducers own validation**, not their callers — phase, turn and legality
are all pure functions of the state handed in, so putting them anywhere else
would mean two copies. Callers supply only what the state can't answer: who is
acting, and whether the game is still active. The client calls the same reducer
before appending, so an illegal action never enters the queue and the
projection's truncation only ever fires on a rebase.

Four helpers had to come down from the edge function to make this possible:
`resolvePurchaseCost` and `applyCost` (`build.ts`), `vpCardCountsByPlayer`
(`dev.ts`) and `isSpecialBuildActor` (`roll.ts`). Everything else the reducers
need was already pure and already in `lib/catan/`.

## Barriers and the flush

A **barrier** is any action not in the local set. Taking one flushes the queue
first, and only proceeds when the batch has landed:

```
roll · confirm_roll · reroll_dice · ritual_roll · end_turn · end_special_build
buy_dev_card · play_dev_card · confirm_scout_card
propose_trade · accept_trade · reject_trade · cancel_trade · confirm_trade
discard · move_robber · steal · claim_curio · pick_forger_target
move_forger_token · shepherd_swap · set_specialist_resource · set_haunt_spots
pick_bonus · place_start · set_forfeit · set_end_vote
```

`honk` and `send_message` are **not** barriers — they are the two actions the
server already treats as move-neutral (`TIMEOUT_NEUTRAL_ACTIONS`), and flushing a
turn's builds because someone sent a chat message would be absurd.

Flush is one call:

```ts
async function flushQueue(): Promise<{ error?: string }>
// no-op when the queue is empty; otherwise sends `batch` and clears on success
```

Every barrier action routes through a wrapper that flushes first and aborts the
barrier if the flush fails — the player gets the flush's error, and the barrier
they asked for doesn't happen on a state the server never saw:

```
[ End turn ]
   ↓
POST batch […]   ── fails ─→ barrier aborted, queue kept, error surfaced
   ↓ 2xx
POST end_turn    ── fails ─→ builds are real, still your turn, press again
```

The two calls are deliberately not one transaction (locked decision 9). The
only state the split can leave behind is "your builds landed, your turn didn't
end", which is a state the player can see and fix with one more press.

## Undo

```ts
function onUndo() {
	setQueue((q) => q.slice(0, -1))
}
```

That is the whole implementation. The projection re-folds, the board re-renders,
nothing is sent. Consequences worth stating:

- **Undo is unlimited within a turn**, where it used to be one step. Step back to
  an empty queue and the board is the server's row again.
- **Undo is instant** — no `submitting`, no spinner, no failure mode.
- **Undo disappears at the barrier**, because the queue empties. Same felt rule
  as today ("the next action destroys the snapshot"), reached differently.
- The `UndoButton` keeps all three of its current placements and its icon. Only
  what it calls changes.

## Failure and retry

```
flush → POST batch
  ├─ 2xx           → queue cleared, barrier proceeds
  ├─ network / 5xx → FlushState 'retrying', backoff, resend the SAME batch
  └─ 4xx           → FlushState 'rejected', queue KEPT, server message surfaced
```

Backoff: a few attempts with growing delay, then park in `retrying` with a
visible "couldn't reach the server" state and a manual retry. The batch is
resent byte-identical — it is a list of actions, not of resulting state, so a
retry can't double-apply as long as the server applies it atomically.

A 4xx means client and server disagreed about the rules, which is a bug, not a
race: during a seat's own turn nothing else mutates its board. The queue is kept
so the player can undo back to something acceptable rather than losing the turn,
and the message names what the server refused.

## Projecting sub-phases (the hard part)

Locked decision 2 means the fold has to carry phase machinery the client has
never had to model:

- **`road_building`** — `remaining` decrements, and the phase resumes early when
  `hasLegalRoadPlacement` fails. Both already exist as pure helpers; the
  transition extracted from `handleBuildRoad` covers it.
- **`magician_pick`** — `cast_magic` / `skip_magic` both pay out
  `phase.pendingGain` and unwind `phase.resume`, which nests (a roll that queued
  `curio_pick` / `forger_pick` resumes into them). The fold must unwind the same
  chain the server does.
- **`post_placement`** — the genuinely awkward one. It is **parallel**: other
  seats act while this one's queue sits unflushed, so realtime updates land
  mid-queue and the projection rebases onto them (below). A queued
  `place_explorer_road` that drains this seat's pending entry must not be folded
  onto a server row where someone else's entry drained too — it is, and that's
  fine, because the reducer only touches this seat's entry.
  The phase has no barrier action of its own, so the explorer banner carries a
  Confirm that flushes once the last road is queued. It keys off the server
  row, since the projection may already have drained to `roll`.

**Rebase rule:** whenever the server row changes under a non-empty queue, re-fold
from the new row. If any action in the queue now fails to apply, truncate the
queue at that action and surface a message. The queue is a list of intents, so
rebasing is just running the fold again — no merge, no conflict resolution.

## Server — `supabase/functions/game-service/index.ts`

### New: the `batch` action

```ts
{ action: 'batch', game_id: string, actions: LocalAction[] }
```

`handleBatch` parses each entry with `parseLocalAction` (nothing off the wire is
trusted), then hands the list to **`commitLocalActions`**, the one write path for
queued actions:

1. Load, game status and participation — once.
2. `applyLocalActions` folds the list. Any failure → `err(400, …)` naming the
   reason and which move it was. **Nothing is written.**
3. One write of the changed columns + all events, through `commitActionWrite`.

Atomic by construction: a single write at the end means a rejected batch leaves
no trace, which is what makes the client's retry safe to send byte-identical.

`changedStateColumns` writes only what actually moved, compared **by reference**
— the reducers build a new object only for something they changed, so reference
inequality is exactly the right test. It also matters for correctness: a seat
acting in the parallel `post_placement` phase must not clobber another seat's
columns.

`MAX_BATCH_ACTIONS` caps the list so a malformed client can't ask the server to
fold forever.

### The single-action handlers collapse onto the same path

All thirteen become three-line wrappers around `commitLocalActions`. That isn't
a tidy-up: leaving their old bodies in place would have left a _second_
implementation of every build on the server itself, which is the exact drift the
shared reducers exist to prevent. `handleBankTrade` keeps one shim — the legacy
merchant payload fold — before handing off. `preflightBuild` is deleted; its
phase/turn test is now `buildFloor` inside the reducers.

### Deletions

- `game_states.undo` column (migration), `UndoSnapshot`, `GameState.undo`, the
  `rowToState` mapping, `handleUndo`, the `undo` action + its store action, the
  snapshot-write and invalidate-on-every-action block in `serve`, the timeout
  sweep's snapshot clear, and `UNDO_NEUTRAL_ACTIONS`.
- `UNDOABLE_ACTIONS` **survives in `lib/catan/types.ts`** with a changed meaning
  — it is the queue's membership list — but its **edge mirror is deleted**:
  `parseLocalAction`'s switch is the server's membership test, and a second list
  would only be a second thing to keep in step. A compile-time check in
  `types.ts` asserts that list and `LocalAction` cover each other.

### Unchanged

Every single-action handler stays and stays reachable — the batch is an
additional path, not a replacement. The timeout sweep still calls `dispatch`
with individual actions, and a client that somehow sends `build_road` directly
still gets the old behavior.

## UI changes

- **Every confirm bar for a local action is deleted**: builds (road, fence,
  settlement, city) and `liquidate`. `confirmAction` survives only for the three
  non-undoable confirms — move robber, steal, move forger token.
  A dev card buy is also non-undoable but confirms only on the player's own
  opt-in (`profiles.play_prefs.confirmDevCardBuy`, default off), as a modal.
- **`liquidate` loses the refund text it showed in the bar.** The projected hand
  jumping is now the feedback; the tapped piece disappearing is the confirmation.
- **The metropolitan cost picker stays a modal.** It isn't a confirm — it's a
  genuine choice about how to pay, and the answer is part of the queued action's
  payload.
- **Nothing marks a queued piece** (locked decision 7).
- **The pending win is named in the status banner and on the VP track** — the
  banner says ending the turn finishes the game, the VP display marks the
  threshold crossed. `hud/status.ts` gains a line for it, ahead of the ordinary
  main-phase fall-through; `bannerStatus` is already the surface that narrates
  what the table is waiting on, and this is the one case where the viewer knows
  something the table doesn't.
- **End turn survives the projected `game_over`.** The projected phase has no
  control of its own, so both layouts render End turn off `pendingWin` instead
  of the phase. Pressing it is the flush alone — the batch's fold ends the game
  on the server, and a following `end_turn` would be refused.
- **`submitting` no longer covers local actions.** They are synchronous state
  updates. It stays for barriers, which now include a flush.

## Known consequences

- **The move clock doesn't know about local work.** `games.deadline_at` is
  stamped by server actions, so a player who builds for twenty minutes without
  reaching a barrier can be timed out and lose the queue. Accepted under locked
  decision 4; worth remembering when the timeout is next tuned.
- **`ActionLog` gets bursts.** A turn's builds all carry the flush's timestamp
  and arrive in one realtime update.
- **Honk gets less informative.** The idle clock sees a player who is actively
  building as idle. Unchanged mechanically, but the nudge will fire more often.
- **Spectators see the same as opponents** — nothing until the flush.

## Files

| File                                              | Change                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `lib/catan/apply.ts`                              | **new** — the pure reducers, the fold, and `projectQueue`                                                    |
| `lib/catan/types.ts`                              | `LocalAction` + the coverage check; `UNDOABLE_ACTIONS` recommented; drop `UndoSnapshot` / `GameState.undo`   |
| `lib/catan/build.ts` `dev.ts` `roll.ts`           | `resolvePurchaseCost`, `applyCost`, `vpCardCountsByPlayer`, `isSpecialBuildActor` brought down from the edge |
| `lib/game/gameScreenContext.tsx`                  | the queue, the projection as `gameState`, flush + barriers, `onUndo`, `pendingWin`                           |
| `lib/game/BoardArea.tsx`                          | drop the build / liquidate confirm bars and their board previews                                             |
| `lib/game/hud/status.ts` `StatusBanner.tsx`       | the win cue and the two stuck flush states                                                                   |
| `lib/gameService.ts`                              | `retriable` on the result, so a flush can tell transport from refusal                                        |
| `lib/stores/useGamesStore.ts`                     | `batch(gameId, actions)`; delete `undo`                                                                      |
| `lib/stores/useGameStatesStore.ts`                | drop the `undo` row mapping                                                                                  |
| `supabase/functions/game-service/index.ts`        | mirror `apply.ts`; `handleBatch` + `commitLocalActions`; collapse 13 handlers; delete undo machinery         |
| `supabase/migrations/…_drop_game_states_undo.sql` | drop the column — **applied last**                                                                           |
| `dev/check-catan-apply.ts`                        | **new** — reducer behavior + the fold/truncate property                                                      |

## Checks

- `dev/check-catan-apply.ts` — for each reducer: applying it to a validated state
  produces what the handler produced; **fold-then-truncate equals fold-of-prefix**
  (the property undo rests on); a rejected action leaves the working state
  untouched.
- The drift check that matters: a batch the client's fold accepted is accepted by
  the server's fold. Same code both sides, so this is really a test that the
  mirror is in step — assert the two files' reducer sections stay identical the
  way the other mirrored rules are checked.
- `npm run check`, `npm run format`, every `dev/check-catan-*.ts`.
- Manual: a turn that builds three things and undoes two; a bank trade between
  two builds; a queue interrupted by an opponent's `post_placement` action; a
  flush with the network off, restored mid-backoff; a queued winning build,
  undone, re-made, then flushed by End turn.

## Deploy

Edge function **before** the client, and the migration last:

- _New server, old client:_ the old client never sends `batch`; every handler it
  uses is untouched. It also still sends `undo`, so **the column must survive
  until the new client is out** — that's why the migration goes last, not with
  the edge deploy.
- _Old server, new client:_ `batch` is an unknown action; every turn's work would
  fail to send. Client must not go first.

Sequence: `npm run edge` → ship client → confirm no old clients are live →
`npm run migrate` → `npm run types`.

## Out of scope

- Persisting a queue across app restarts (locked decision 4).
- Auto-flush on a deadline (locked decision 4).
- Any change to which actions are undoable — `UNDOABLE_ACTIONS` keeps its exact
  membership, only its meaning changes.
- Multi-turn undo, or undoing a flushed batch.
