# Age: voluntary discard (generalize avarice's escape valve)

Give the **Curse of Age** the same voluntary-discard affordance the **Curse of
Avarice** already has, by generalizing avarice's single-curse mechanism into one
curse-agnostic "voluntary discard" shared by both curses. Prerequisite reading:
`.claude/specs/avarice-voluntary-discard.md` (the mechanism and the per-game
lock it introduced — unchanged here).

Two curses never apply to one player, so a single gate that accepts either curse
is safe. Age gains nothing else: it still caps spend at six cards/turn
(`canSpendUnderAge`); the discard is a parallel, independent affordance.

## Rule (both curses)

A player under `avarice` **or** `age` may discard any cards from their hand,
**minimum 2 per discard** (`VOLUNTARY_MIN_DISCARD`), at any time in an active
game, on anyone's turn. It never changes phase, turn, pending seats, the move
clock, or `cardsSpentThisTurn` (discarding is not spending).

Allowed phases (identical to avarice): every active phase after initial
placement **except `discard`** (would stale the owed count) and **`steal`**
(would let the victim dump the card being stolen). Not allowed in
`select_bonus`, `initial_placement`, `game_over`.

Curse card gain (age): add clarification "You may discard two or more cards at
any time." (same wording avarice already carries).

## Approach: generalize, keep legacy wire names working

Rename avarice's internals to generic `voluntary*` names; the gate widens from
`curse === 'avarice'` to `curse === 'avarice' || curse === 'age'`. Introduce a
generic `voluntary_discard` action and `voluntary_discarded` event. **The legacy
`avarice_discard` action and `avarice_discarded` event stay recognized** at
every boundary so in-flight device drafts and historical `games.events` rows
still work.

### Rules layer (`lib/catan/`, mirrored in the edge function)

- `curses.ts`: `AVARICE_MIN_DISCARD` → `VOLUNTARY_MIN_DISCARD` (still 2);
  `AVARICE_DISCARD_PHASES`/`isAvariceDiscardPhase` →
  `VOLUNTARY_DISCARD_PHASES`/`isVoluntaryDiscardPhase` (same phase table);
  `avariceDiscardBlocked` → `voluntaryDiscardBlocked`, gate changed to accept
  `avarice` or `age` (error string: "only an avarice or age curse may
  discard").
- `apply.ts`: `applyAvariceDiscard` → `applyVoluntaryDiscard` (unchanged body —
  reads the renamed gate/const, emits `voluntary_discarded`). Dispatch `case
'voluntary_discard'`.
- `types.ts`: `LocalAction` arm `{ action: 'voluntary_discard'; discard:
ResourceHand }`; `UNDOABLE_ACTIONS` entry `'avarice_discard'` →
  `'voluntary_discard'`. The compile-time `_QueueCoversUndoable` keeps the two
  in step.

### Legacy device drafts

`useLocalDraftStore` persists `LocalAction[]` per game on-device. A queued
`avarice_discard` from a build shipped before this change would no longer match
the union when rehydrated. Normalize on read: map any persisted
`{ action: 'avarice_discard' }` entry to `{ action: 'voluntary_discard' }` when
the draft store loads (single `.map` in the rehydration/selector path). Keeps
the `apply.ts` switch to one generic case. (Low-stakes — a voluntary discard is
only queued on the player's own turn and a draft is dropped when turn/phase
moves — but cheap to get right.)

### Store (`lib/stores/useGamesStore.ts`)

- `avariceDiscard(gameId, discard)` → `voluntaryDiscard(gameId, discard)`,
  sending `{ action: 'voluntary_discard', ... }`.
- `GameEvent` union: add `{ kind: 'voluntary_discarded'; player; count; at }`.
  **Keep `avarice_discarded`** in the union so `describeEvent` still types old
  rows.

### UI

- `DiscardPanel.tsx` `VoluntaryDiscardPanel`: import `VOLUNTARY_MIN_DISCARD`;
  take a `curseTitle: string` prop and render "{curseTitle}: discard 2 or more
  cards at any time." so the hint reads "Curse of Age: …" or "Curse of
  Avarice: …". No other change (composer already caps at the whole hand).
- `gameScreenContext.tsx`: rename `avariceDiscardOpen`/`showAvariceDiscard`/
  `canAvariceDiscard`/`onAvariceDiscard`/`onAvariceDiscardPress`/the store
  selector to `voluntary*`. `showVoluntaryDiscard` gate: curse is `avarice` or
  `age`, and `isVoluntaryDiscardPhase(phase.kind)`. `canVoluntaryDiscard`:
  `voluntaryDiscardBlocked(gameState, meIdx) === null`. Queue-vs-send logic
  (own turn queues + undoable; off-turn / `post_placement` sends immediately) is
  unchanged. Expose the acting player's curse title for the panel.
- `BottomArea.tsx`: consume the renamed fields; pass `curseTitle`. Button copy
  stays "Discard".
- `ActionLog.tsx` `describeEvent`: add a `case 'voluntary_discarded'` rendering
  "{who} chose to discard N cards" (same text as the legacy case). **Keep the
  `avarice_discarded` case** for old rows. Add `voluntary_discarded` to the
  same filter groups (`robber`, `bonuses`) `avarice_discarded` sits in.

### Edge function (`supabase/functions/game-service/index.ts`)

Mirror every rename above: `AVARICE_MIN_DISCARD`/`AVARICE_DISCARD_PHASES`/
`avariceDiscardBlocked`/`applyAvariceDiscard`/`handleAvariceDiscard` →
`VOLUNTARY_*`/`voluntaryDiscardBlocked`/`applyVoluntaryDiscard`/
`handleVoluntaryDiscard`, with the gate widened to `avarice || age`. Plus the
backward-compat seams:

- `parseLocalAction`: accept **both** `'voluntary_discard'` and legacy
  `'avarice_discard'`, each → `{ action: 'voluntary_discard', discard }` (so a
  legacy action riding in a `batch` still folds).
- Top-level body routing: `VoluntaryDiscardBody` with `action:
'voluntary_discard'`; route **both** the new and legacy single-action bodies
  to `handleVoluntaryDiscard`.
- `TIMEOUT_NEUTRAL_ACTIONS`: include both `'voluntary_discard'` and
  `'avarice_discard'` (off-turn discards must not refresh the deadline or clear
  the caller's timed-out flag).

`_shared/gameLock.ts`: only a doc-comment reference to the avarice spec — leave
it, or point it at this spec too. No logic there.

Deploy with `npm run edge` (rules change — doesn't reach real games until
deployed; this session won't deploy unless asked).

## Docs

- `lib/catan/CLAUDE.md`: the avarice-escape-valve notes (`robber.ts` line, the
  local-action-queue "`avarice_discard` is the one member with no turn gate"
  bullet) → describe the generic voluntary discard shared by avarice **and**
  age; reference this spec.
- `supabase/functions/CLAUDE.md`: if it names `avarice_discard`, update to the
  generic action.

## Patch notes

One player-facing entry (per the project rule), e.g. "The Curse of Age can now
voluntarily discard cards at any time, like the Curse of Avarice."

## Checks

- `dev/check-catan-curses.ts`: add age coverage mirroring avarice — allowed vs
  blocked phases, min-2, afford, off-turn accepted, a non-cursed/other-curse
  player rejected. Keep the avarice cases.
- `dev/check-catan-apply.ts`: queue-truncation property still holds with the
  renamed action.
- `npm run check` + `npm run format` at the end.
