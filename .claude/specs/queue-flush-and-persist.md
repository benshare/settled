# Queue flush acknowledgement and draft persistence

Two fixes to the local action queue (`.claude/specs/local-action-queue.md`).

## 1. "Some moves were undone" after a successful flush

### Cause

`flushQueue` removes the sent actions from the queue only when the `batch` HTTP
response returns. The edge function writes `game_states` _before_ the `games`
row and before responding, so the realtime row usually arrives first. The queue
is then folded onto a board that already contains it; the first re-applied
build fails (spot occupied), the rebase effect truncates and toasts "The board
changed before they were sent." The response lands a beat later and everything
looks right — hence "the actions execute, I just see the error".

Second path to the same symptom: a batch that committed but whose response was
lost is retried byte-identical, refused (the moves are already on the board),
and parks `rejected` with the queue double-projected.

### Fix: a batch id the row carries back (confirmed with user)

- `PlayerState.lastBatchId?: string` (client type + edge mirror). Stored on the
  seat rather than in a column: written in the same update as the batch, arrives
  in the same realtime payload, needs no migration, and is per-seat so parallel
  `post_placement` flushes can't clobber each other.
- Wire: `{ action: 'batch', game_id, actions, batch_id? }`. Optional, so the
  current client keeps working against the new server.
- `commitLocalActions(…, batchId?)`: if `players[me].lastBatchId === batchId`,
  return `ok` without applying (**idempotent retry**). Otherwise fold, stamp
  `lastBatchId` on the acting seat, write. Single-action handlers pass none.

Client (`gameScreenContext.tsx`):

- The queue splits in two: `queue` (unsent, undoable) and
  `inFlight: { id, actions, acked } | null` (handed to the server, not undoable —
  a batch that may have landed can't be taken back).
- **Reflected** = `serverState.players[meIdx].lastBatchId === inFlight.id`.
  Projection folds `[...(reflected ? [] : inFlight.actions), ...queue]`, so the
  board never double-applies or flickers whichever of response/realtime wins.
- When the row reflects the batch, `inFlight` clears (and a parked `retrying`
  flush resolves to idle).
- Rebase truncation is suppressed while an unreflected batch is in flight; it
  otherwise cuts only `queue`.
- `flushQueue`: (re)sends an unacked `inFlight` with its same id, then moves
  any `queue` into a new `inFlight` and sends that. 2xx → `acked`. 4xx → the
  server refused it, so it definitely didn't land: actions return to the front
  of `queue`, `rejected`. Transport failure → retry the same id (now safe).

## 2. Unsent moves lost when the app closes

Reverses locked decision 4 of the queue spec. **Device-local persistence**
(confirmed with user) of both the action queue and the placement draft.

- New `lib/stores/useLocalDraftStore.ts`: `byGame[gameId]` in memory, written
  through to `authStorage` (`lib/supabase.ts` — SecureStore on native,
  localStorage on web; already in the native build, so OTA-safe). Key
  `settled.draft.<userId>.<gameId>`; empty drafts delete the key. Registered as
  an auto-loaded store for the user id and sign-out clear.
- Holding drafts per game also fixes a latent bug: today the queue is one piece
  of provider state that survives a header tab switch, so game A's queue is
  folded onto game B.
- Draft shape:
  `{ queue: { anchor, actions, inFlight }, placement: { anchor, entries, pickLast } }`.
- **Anchors.** Queue anchor = `${round}:${currentTurn}:${phase.kind}` of the
  server row, refreshed on every write; placement anchor = the existing
  `placementKey`. When the screen attaches to a game (mount, tab switch, disk
  restore) a draft whose anchor doesn't match the current row is discarded —
  otherwise a bank trade queued on a turn you were timed out of would replay on
  your next one. A reflected `inFlight` is dropped and skips the anchor check
  (the batch itself moved the phase). Discarding a non-empty draft notifies:
  "Unsent moves discarded — the game moved on before they were sent."
- Live rebasing while attached is unchanged (fold + truncate).

## Deploy

Edge first (`npm run edge`), then OTA the client. No migration. Old client +
new server: no `batch_id`, behaves as today. New client + old server: the
server ignores `batch_id`, so the client never sees reflection — `inFlight`
would never clear, so the edge must go first.

## Files

| File                                       | Change                                                   |
| ------------------------------------------ | -------------------------------------------------------- |
| `lib/catan/types.ts`                       | `PlayerState.lastBatchId`                                |
| `supabase/functions/game-service/index.ts` | mirror type; `batch_id` idempotency + stamp              |
| `lib/stores/useGamesStore.ts`              | `batch(gameId, actions, batchId)`                        |
| `lib/stores/useLocalDraftStore.ts`         | **new** — per-game drafts, write-through                 |
| `lib/stores/index.ts`                      | register it                                              |
| `lib/game/gameScreenContext.tsx`           | `inFlight`, reflection, flush rewrite, drafts from store |
| CLAUDE.md files, queue spec                | decision 4 reversed; ack mechanism                       |
