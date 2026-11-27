# Undoable End Turn

Let a player who just ended their turn take it back — returning the floor to
them — until the next player has acted. Once the next player makes their first
real move, the window closes.

## The core finding: this is NOT the local queue

The existing undo (`.claude/specs/local-action-queue.md`,
`reversible-dev-cards.md`) rests on one property: an undoable action is **never
sent** until a barrier, so undo is a local `slice(0, -1)` and opponents see
nothing until the flush. **End turn cannot work that way.** The moment a player
ends their turn, the next player must _see_ it is their turn in order to act —
so end turn has to be committed to the server immediately. A move that's already
on the server can't be unwound by popping a local list.

So this is a **separate, server-side, cross-turn undo** that runs _parallel_ to
the local queue, not an extension of it. `apply.ts` / `UNDOABLE_ACTIONS` /
`LocalAction` are untouched; end turn is not a `LocalAction`. (The task was
framed as "extend the same mechanism"; the honest answer is that end turn is the
one undoable moment that is fundamentally a server action, so it gets its own
small mechanism that mirrors the _spirit_ — take-backable until the next barrier
— without joining the queue.)

A time-delayed "soft send" (hold end turn for N seconds, show Undo, then send)
was rejected: it would delay the next player too, which contradicts "the next
player can start while I can still undo."

## Model

`handleEndTurn` already commits the turn (phase→`roll`/`special_build`,
`current_turn`→next, `round`++, resets the outgoing player's per-turn flags,
appends `turn_ended`). We add:

1. **A snapshot** written in the same `end_turn` write, recording exactly what
   is needed to reverse it.
2. **`undo_end_turn`** — a new edge action + client store call that restores the
   snapshot, gated on the window still being open.
3. **Window close** — the snapshot is cleared by the next real move (see
   "What closes the window").
4. **UI** — the ender sees an Undo affordance while the snapshot names them.

### Snapshot shape (compact, not the whole board)

`handleEndTurn` only ever changes four columns, and within `players` only the
outgoing seat `meIdx`. So the reversal record is small:

```ts
type EndTurnUndo = {
	by: number // seat that ended; current_turn restores to this
	prevPhase: Phase // the { kind:'main', roll, trade } we left
	prevPlayer: PlayerState // players[by] before the flag resets
	prevRound: number // round before the ++  (== round - 1)
	eventsLen: number // games.events length before `turn_ended` was pushed
}
```

Stored on a new nullable `game_states.end_turn_undo` jsonb column. Compact so the
realtime payload stays lean (it rides every board broadcast until the window
closes — a transient `PlayerState` + a `Phase`, not a second full board).

Reverse = `players[by] = prevPlayer; phase = prevPhase; round = prevRound;
current_turn = by; end_turn_undo = null`, and remove the one `turn_ended` event
at index `eventsLen` (splicing that single element, not truncating — a honk or
avarice discard that landed in the window sits after it and also changed state,
so its log line stays).

> Verified against `handleEndTurn` (index.ts ~7286): only `phase`, `players[meIdx]`,
> `round`, `current_turn` change, plus the one appended `turn_ended`. The investor
> payout is deferred to the incoming roll, not applied here, so nothing else moves.

### What closes the window ("next player acts")

Proposal: **the snapshot is cleared by the next committed move by anyone.**
Mechanically, clear `end_turn_undo` centrally in `serve`'s post-action hook (next
to `refreshDeadline`, under the same lease) for every successful action **except**
`end_turn` itself (it just wrote the snapshot) and `undo_end_turn`, and except the
move-neutral set already exempted from the deadline (`honk`, `send_message`,
`avarice_discard`, `clear_timeout`). So:

- Next player rolls / confirms a gambler roll / plays through special build /
  flushes a pre-roll batch → window closes. ✓
- A honk, a chat message, or an avarice discard during the window → window stays
  open (consistent with how those are treated everywhere else as non-moves).
- `undo_end_turn` → restores and self-clears.

`undo_end_turn` _also_ re-checks under the lease that `end_turn_undo` is present
and names the caller, and that the live `current_turn`/phase still match the
post-end-turn position — belt and braces against a racing move that cleared it.

### Edge: `handleUndoEndTurn`

Gates: game active; `end_turn_undo` present and `.by === meIdx`
(`currentPlayerIndex` is null off-turn, so resolve the seat via
`player_order.indexOf(me)` like the forfeit setters); live state still matches
the snapshot's post-position. Then write the reversed columns + clear, append no
new event (we popped `turn_ended`), and notify nobody (the floor returns to the
caller, who is right here). Mirror the "whole columns under the lease" pattern.

### Client

- `useGamesStore.undoEndTurn(gameId)` → `{ action: 'undo_end_turn', game_id }`.
- `gameScreenContext`: `canUndoEndTurn = !!serverState?.endTurnUndo &&
serverState.endTurnUndo.by === meIdx && !isSpectator`, and `onUndoEndTurn`
  (flush-free — nothing is queued; just the network call + spinner). Read off
  `serverState`, not the projection.
- Surface it as a labelled control (not the silent in-turn arrow) wherever the
  ender sees the "waiting on <next player>" status — `StatusBanner` (HUD) and the
  classic `TopArea` status line. **Exact placement + label to confirm.**

## Autopilot / timeout

A forfeited/timed-out seat's `end_turn` goes through `handleEndTurn` and writes a
snapshot like any other, but nobody undoes it and the next move clears it — no
special-casing needed. The pending window never affects the deadline (the clock
is already on the next actor).

## Server mirror note

`end_turn_undo` is pure column I/O in the edge function — there is no `apply.ts`
rule to mirror, and `_shared/phase.ts` / `pendingSeats` are unaffected (the
window doesn't change who the game waits on; `current_turn` has already moved).

## Locked decisions (confirmed with user)

1. **Server-side separate mechanism** (above) — a compact snapshot on
   `game_states` + an `undo_end_turn` action, parallel to the local queue.
2. **What closes the window**: the next committed _move_ by anyone (central
   clear in `serve`). The move-neutral set (`honk`, `send_message`,
   `avarice_discard`, `clear_timeout`) keeps it open.
3. **UI**: a labelled "Undo end turn" button in the ender's waiting-status
   surface (HUD `StatusBanner` + classic `TopArea`), distinct from the silent
   in-turn undo arrow.
4. **Special build (5-6p)**: offer undo uniformly — until someone acts — whether
   end turn opened a `special_build` phase or went straight to the next roll.

## Checks / deploy

- `npm run check`, `npm run format`.
- Edge first (`npm run edge`), then OTA — the client's `undo_end_turn` is
  rejected by an old server (unknown action), and a new server is harmless to an
  old client (never calls it). New migration for the `end_turn_undo` column.
- Patch note: player-facing ("You can now undo ending your turn until the next
  player moves.").

## Files (draft)

| File                                                    | Change                                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `supabase/migrations/*`                                 | add nullable `game_states.end_turn_undo` jsonb                                                                     |
| `supabase/functions/game-service/index.ts`              | write snapshot in `handleEndTurn`; `handleUndoEndTurn`; central clear in `serve`; dispatch case; `loadGame` select |
| `lib/stores/useGamesStore.ts`                           | `undoEndTurn` action; `end_turn_undo` on the state row type                                                        |
| `lib/game/gameScreenContext.tsx`                        | `canUndoEndTurn`, `onUndoEndTurn`                                                                                  |
| `lib/game/hud/StatusBanner.tsx`, `lib/game/TopArea.tsx` | the Undo affordance                                                                                                |
| `lib/catan/CLAUDE.md` / `lib/game/CLAUDE.md`            | document the parallel mechanism                                                                                    |
| `lib/patchNotes/patch-notes.json`                       | entry                                                                                                              |
