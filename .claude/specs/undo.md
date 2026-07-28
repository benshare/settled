# Undo (one step)

A small back arrow in the game screen's bottom area that reverses the player's
own last action — but only for actions that are **solo and information-free**.
Rolling, buying/playing a dev card, and anything involving another player are
never undoable: the act of doing them reveals something, so unwinding them
would leak.

Scope: **one step back**. There is at most one undo snapshot per game at any
time, and it is destroyed by the next action of any kind.

## 1. What is undoable

```
build_road          build_settlement    build_city      build_super_city
bank_trade          liquidate           invest          buy_carpenter_vp
tap_knight          place_fence_token   place_explorer_road
```

Deliberately **not** undoable: `roll` / `confirm_roll` / `reroll_dice` /
`ritual_roll` (dice), `buy_dev_card` / `play_dev_card` / `confirm_scout_card`
(reveals a card), every trade action other than `bank_trade` (another player is
involved), `discard` / `move_robber` / `steal` / `claim_curio` /
`pick_forger_target` / `cast_magic` (robber + reaction chains), `end_turn`,
`end_special_build`, `shepherd_swap`, `move_forger_token`,
`set_specialist_resource`, `set_haunt_spots`, `pick_bonus`, `place_settlement` /
`place_road` / `choose_last_settlement` (initial placement — the snake order and
starting-resource grant make a rollback its own feature).

## 2. Mechanism: snapshot, not inverse

Undo restores a **snapshot of the `game_states` row taken before the action**,
rather than computing an inverse. The rules surface is far too wide for
inverses to be trustworthy — a single road build can move Longest Road, consume
a fence token, apply a smith cost swap, a bricklayer alt cost, or an age-curse
spend counter. Restoring the prior row gets all of it for free and can't drift
as bonuses are added.

### Storage

New nullable column, migration `20260728120000_game_undo.sql`:

```sql
alter table public.game_states add column undo jsonb null;
```

No RLS change — the existing `game_states` select policy already covers
participants and spectators, and the snapshot contains nothing they can't
already read from the live row.

Shape (`UndoSnapshot` in `lib/catan/types.ts`, mirrored in the edge function):

```
action     the undoable action's name
player     seat index that acted — only they may undo
at         ISO, when the snapshot was taken
eventsLen  games.events length BEFORE the action
state      the mutable game_states columns as they were, under their column
           names: vertices, edges, players, phase, robber, ports,
           fence_tokens, dev_deck, largest_army, longest_road, round
```

`hexes` and `variant` are omitted — nothing mutates them. `games.current_turn`
is omitted because **no undoable action touches it** (only `end_turn` and the
setup paths write that column); if that ever stops being true the snapshot has
to grow to cover it.

### Write / invalidate, in `serve`

The snapshot is maintained in one place — the request dispatcher — so no
handler has to know undo exists:

- **Undoable action**: read the `game_states` row + `games.events` length
  _before_ dispatching. If the handler returns 2xx, write the snapshot into
  `game_states.undo`.
- **Any other action** except `send_message`: after a successful dispatch,
  `update game_states set undo = null where game_id = ? and undo is not null`.
  The `is not null` guard means the common case matches zero rows, so it costs
  no row version and emits no realtime event.
- **`send_message`** is exempt — chat touches neither `game_states` nor
  `games.events`, so it can't invalidate anything.

`honk` is _not_ exempt: it appends to `games.events`, and undo truncates that
array by length, so a honk that survived would be truncated away. Losing undo
to a honk requires a full minute of idling first.

Cost: one extra read + one extra write on an undoable action; one no-op
statement on everything else.

The baseline read and the handler's own write aren't in one transaction, so two
undoable actions from the same seat landing simultaneously could snapshot the
same pre-state and make one undo step back two. The client's `submitting` flag
already serializes a seat's actions, and the payoff — wrapping every handler in
a transaction — isn't worth it for an affordance this small.

### Restore (`undo` action)

`handleUndo` validates, then restores:

1. `game.status === 'active'` (a game-winning build is not undoable — the phase
   is `game_over` and the client shows no arrow either).
2. A snapshot exists and `snapshot.player === meIdx`.
3. Write `{ ...snapshot.state, undo: null }` to `game_states`.
4. Truncate `games.events` to `snapshot.eventsLen`.

The undone action's log entry **disappears entirely** — the road never existed.
Nothing is logged in its place.

### Why a single global slot is enough

`post_placement` is a parallel phase, so two players can both take an undoable
action. The second one's snapshot overwrites the first's, and since the
snapshot carries `player`, the first player's arrow disappears. "Go back one
step" is a property of the game, not of a seat.

## 3. UI

`GameState.undo?: UndoSnapshot | null`, mapped in `gameContext.rowToState`, so
availability is read straight off the row every client already syncs. No
derivation from the event log — that would drift from the server's rule.

`gameScreenContext` exposes:

```ts
canUndo =
	!!gameState.undo &&
	gameState.undo.player === meIdx &&
	!isSpectator &&
	!inGameOver &&
	(phase.kind === 'main'
		? isMyActiveTurn
		: phase.kind === 'special_build'
			? isMySpecialBuild
			: phase.kind === 'post_placement')
onUndo() // useGamesStore.undo(gameId), through the shared `submitting` flag
```

The phase branch is asking one question — _does this seat hold the floor right
now?_ — and the answer isn't `current_turn` in every phase. During
`special_build` the acting builder is `phase.queue[0]` while `current_turn` has
already advanced to the next roller, so the test there is `isMySpecialBuild`.

`UndoButton` lives in `gameScreenShared.tsx`, since two of its three placements
are in `BottomArea` and one is in `TopArea`:

- **`main` phase** — an icon-only 52pt square button (Ionicons `arrow-undo`,
  secondary-Button chrome) immediately left of **End turn** in `MainLoopBar`'s
  action row.
- **`post_placement`** — the same button on its own row above the hand, since
  `MainLoopBar` doesn't render outside `roll`/`main`. This is what makes the
  fencer/explorer placements undoable at all.
- **`special_build`** — immediately left of **Done building** in
  `SpecialBuildBar`. A build during a special-build slot is otherwise exactly
  as undoable as a main-phase one: the server already snapshots it, nothing
  re-drains the queue mid-slot (only `end_turn` and `end_special_build` call
  `drainSpecialBuildQueue`), so the builder keeps the floor — and the arrow —
  until they press Done.

Deliberately still no arrow during `road_building`: the two free roads come
from a dev card that has already been revealed, so the phase is left alone. The
snapshot the server writes for the second free road does surface once the phase
resumes to `main`, which re-enters `road_building` with one road left if used.
That leaks nothing, so it stands.

## 4. Files

| File                                               | Change                                                |
| -------------------------------------------------- | ----------------------------------------------------- |
| `supabase/migrations/20260728120000_game_undo.sql` | new `game_states.undo` column                         |
| `lib/catan/types.ts`                               | `UndoSnapshot`, `GameState.undo`                      |
| `lib/catan/gameContext.tsx`                        | map `row.undo`                                        |
| `lib/stores/useGamesStore.ts`                      | `undo(gameId)` action                                 |
| `lib/game/gameScreenContext.tsx`                   | `canUndo`, `onUndo`                                   |
| `lib/game/gameScreenShared.tsx`                    | `UndoButton`                                          |
| `lib/game/BottomArea.tsx`                          | `main` + `post_placement` placements                  |
| `lib/game/TopArea.tsx`                             | `special_build` placement                             |
| `supabase/functions/game-service/index.ts`         | `UNDOABLE_ACTIONS`, snapshot in `serve`, `handleUndo` |

Deploy: `npm run migrate` → `npm run types` → `npm run edge`.
