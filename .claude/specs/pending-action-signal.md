# Pending-action signal: one source of truth

## Problem

"Is this game waiting on me?" is answered two different ways today.

**In-game** it is answered honestly, by `pendingSeats(phase, currentTurn)` in
`lib/catan/timeout.ts` — an exhaustive switch over `Phase['kind']` that returns
every seat the game is actually waiting on. `discard` returns the seats that
still owe cards, `select_bonus` returns the seats whose `hand.chosen` is null,
`special_build` returns the queue head. `game-service` mirrors it and treats it
as the authority for move timeouts, deadline stamps, and warning pushes.

**Outside the game** — the Games list dot, the header tab-strip badge, the
app-icon badge, and `_notify`'s server-computed push badge — it is answered by
`isMyTurn(game, meId)`, which can only read `games.current_turn`, because the
games list never loads `game_states`. That proxy is wrong in three known ways:

- `current_turn` is held `null` for the whole simultaneous `select_bonus` phase,
  so nobody reads as waiting there (the reported bug).
- During `special_build` it has already advanced to the next roller, so the seat
  actually on the clock gets no dot.
- Any parallel sub-phase — `discard`, `post_placement`, `curio_pick` — names the
  roller rather than the players who owe an action. A player who owes a discard
  gets a push but no dot and no badge.

The rule is not the problem; the data locality is. `phase` lives on
`game_states`, which `lib/catan/gameContext.tsx` fetches on mount of the game
screen and tears down on exit. Nothing is preloaded.

## Approach

Load full `game_states` rows for every active game into a store, and derive the
signal everywhere from `pendingSeats`. One source of truth, and the cached rows
make opening a game warm rather than a load.

Mirror the same derivation in `_notify` so the badge a push carries agrees with
the badge the app computes.

### Not in scope: moving `current_turn` to `game_states`

_(Done as a follow-up — see `.claude/specs/current-turn-on-game-states.md`.)_

`games` is otherwise identity + roster + config + log; `current_turn` is live
progress and conceptually belongs on `game_states` beside `phase`. It lives on
`games` because that is the only row the list has — the constraint this change
removes. Moving it is a follow-up (migration + every `game.current_turn !==
meIdx` guard in `game-service` + the timeout sweep's queries), deliberately
separated so this change stays reviewable. Nothing here should make that move
harder: the new derivation takes the turn pointer as an argument rather than
reading it off a specific row.

## Design

### 1. `lib/stores/useGameStatesStore.ts` (new)

An auto-loaded user store (`lib/stores/CLAUDE.md` §2) holding raw `game_states`
rows keyed by game id.

```ts
type GameStatesStore = {
	byId: Record<string, BoardState | undefined> // undefined = known-absent row
	loaded: Record<string, true> // ids whose fetch has resolved
	loadForUser: () => Promise<void>
	watch: (gameId: string) => void // ad-hoc, for non-active games
	unwatch: (gameId: string) => void
	clear: () => void
}
```

`BoardState` is `Omit<GameState, 'config' | 'colors'>` — the shape `gameContext`
already derives via `rowToState`. That helper moves here; `gameContext` keeps
the join with the games row's `config`/`colors` that completes a `GameState`.

**Which games — downstream of `useGamesStore`.** The id set is always
`activeGames.map(g => g.id)`, never a query of its own. The store subscribes to
`useGamesStore` and re-syncs whenever that set changes, which covers the cold
start (`activeGames` lands `undefined` → populated), a game starting or ending
over realtime, and a game leaving the active tab.

`spectatableGames` are **not** preloaded — only games the user is seated at. A
spectated game is loaded on demand through `watch`.

It is _also_ registered in `autoLoadedStores`, for one reason: the foreground
resync. `loadAllUserStores` runs on every background → foreground transition and
is what re-creates channels after the OS closed the socket. When the id set
hasn't changed the subscription above fires nothing, so without a registry entry
the store would hold a dead channel. Its `loadForUser` therefore means "refetch
what I hold and rebuild my channel", and takes its ids from the games store as
always. The two mechanisms are disjoint: the subscription owns _which_ games,
the registry owns _freshness and the socket_.

`clear()` drops every row and removes the channel, per the registry contract.

**Realtime.** One channel, `uniqueTopic('game_states_rtu')`, carrying one
`game_id=eq.…` binding per held game rather than a single `in.(…)` filter —
identical server-side narrowing without depending on an operator whose
`postgres_changes` support is easy to get wrong. The channel is rebuilt when the
id set changes (a game ends, a new one starts, a spectated game is watched) and
unconditionally on `loadForUser`, since a foregrounded socket is dead even when
the ids are right. Refetch from the `subscribe()` status callback on
`SUBSCRIBED`, per the store contract.

Scoping the subscription to our own ids matters: RLS would also admit every
friend's watchable game, and `postgres_changes` ships the **whole row** — it
cannot project columns — so an unfiltered channel would stream full board blobs
for games the user is not playing.

**Partial payloads.** `isPartialStateRow` moves here from `gameContext` and keeps
its current behavior: a payload missing the big jsonb columns triggers a re-read
of that row rather than being applied. (Unlike `games`, an omitted column here is
the whole board.)

**Foreground resync cost.** A full refetch of every active state on every
foreground is the main cost of caching whole rows, so `loadForUser` reads
`game_id, updated_at` for the active ids first and full-fetches only the rows
whose `updated_at` moved past what the store holds. Cold start fetches
everything. The same two-step is what a channel rebuild uses, so a foreground
with nothing new costs one narrow query.

**Own-action resync.** `onGameMutated(gameId)` (`lib/gameSync.ts`) re-reads that
one row, so a player never waits on realtime to see their own move.

### 2. `lib/catan/gameContext.tsx`

Stops owning the `game_states` row. It calls `watch(gameId)` on mount /
`unwatch` on unmount, reads `byId[gameId]` from the store, and deletes its
`fetchState`, its `game_state:` channel, and its local `isPartialStateRow`. Its
`games`-row fetch and channel stay exactly as they are.

Two behaviors to preserve:

- `ready` must be true immediately when the store already holds the row — that
  is the warm open. The state-loaded half of `ready` becomes
  `loaded.has(gameId)`, which is already true for a preloaded game.
- The board must not blank between games. Today `setBoardState(undefined)` on
  `gameId` change is what forces the loading state; with a cache, a preloaded
  game renders straight away and an unloaded one shows loading until `watch`
  resolves.

A cached row can be seconds stale if realtime dropped while the app was
backgrounded. `watch` refetches on entry and the channel refetches on
`SUBSCRIBED`, so the screen renders immediately and corrects on arrival — the
same trade the games list already makes.

### 3. The derivation

`isMyTurn(game, meId)` in `useGamesStore` is replaced by a phase-aware pair.
Home is `lib/catan/timeout.ts`, beside `pendingSeats`, since it is the same rule
expressed in user ids:

```ts
export function pendingUserIds(
	playerOrder: string[],
	phase: Phase | undefined,
	currentTurn: number | null
): string[]
```

With no phase (state not loaded yet — cold start, or a game whose row failed to
fetch) it falls back to today's `current_turn` answer rather than to "nobody".
A cold start must not clear a badge a push set correctly, which is the same
reason `useAppBadge` treats `activeGames === undefined` as `null`.

`isMyTurn` stays exported as a thin wrapper taking the state so the three call
sites read the same way:

- `app/(app)/games.tsx` — the per-row dot
- `lib/catan/GameTitle.tsx` — the header tab badge
- `lib/notifications/badge.ts` — the app-icon count

Each now selects the phase for its game from `useGameStatesStore`. Note the
semantics widen correctly: during `discard` or `post_placement` several players
are legitimately dotted at once.

### 4. Server mirror

`badgeCounts` in `supabase/functions/_notify/index.ts` currently selects
`player_order, current_turn`. It gains the embed:

```ts
.select('player_order, current_turn, game_states(phase)')
```

and computes the same `pendingSeats`. PostgREST returns only `phase` from the
embedded row, so the query stays small.

`pendingSeats` and the `Phase` type move out of `game-service/index.ts` into
`supabase/functions/_shared/phase.ts`, imported by both functions — `_notify` is
already imported by `game-service`, so the pattern is established. One copy per
runtime is the floor: the client's copy in `lib/catan/types.ts` /
`timeout.ts` remains a hand-maintained mirror across the Expo/Deno boundary
(`supabase/functions/CLAUDE.md` §Type-checking).

`npm run check:edge` must pass before `npm run edge`.

### 5. The missing push when bonus selection resolves

`handlePickBonus` sent no notification when the last pick flipped the phase to
`initial_placement`, so the first placer learned it from the badge or not at
all — the one phase change that didn't tell the next actor. It now sends
`your_turn` to seat 0, skipped when the last picker _is_ seat 0 (they're looking
at the screen they just acted on).

The move-timeout sweep re-enters this handler like any other, so a seat auto-
picked for by the sweep goes down the same path. One narrow consequence, not
worth special-casing: a player who timed out, was auto-picked last, and sits at
seat 0 gets no push — they still get the dot and badge this change fixes, and
the sweep re-stamps the deadline anyway.

## Verification

- 3-player bonus game: all three see the dot at deal; picking clears only your
  own; the last pick advances the phase and the dot follows `current_turn`.
- Roll a 7 with two players over the limit: both are dotted, each clears on
  submit, the roller keeps the dot for `move_robber`.
- Special build: the builder holds the dot, not the next roller.
- App-icon badge matches the list's dot count, and a push received while
  backgrounded stamps the same number.
- Open a preloaded active game: board renders with no loading state.
- Open a spectated game (not preloaded): loads as before.
- Background for a few minutes while another player acts, foreground: dots and
  board are correct.
- The last player to pick a bonus: everyone else's clients advance to placement,
  and seat 0 gets a `your_turn` push unless they were that last picker.

## Docs to update

- `lib/stores/CLAUDE.md` — the new store and its channel scoping.
- `lib/catan/CLAUDE.md` — `gameContext` no longer owns the state row.
- `supabase/functions/CLAUDE.md` — the badge paragraph's "same
  null-during-bonus-selection / lags-during-special-build approximations" is
  exactly what this removes.
- The `isMyTurn` doc comment's "approximate in two known ways" goes away.

## Follow-ups (deliberately not here)

1. ~~**Move `current_turn` to `game_states`**~~ — done, see
   `.claude/specs/current-turn-on-game-states.md`. That change also removed the
   `current_turn` fallback described under "The derivation" above: the pointer
   moved onto the same row as the phase, so an unloaded game has nothing to fall
   back to and `useAppBadge` holds the badge instead of guessing.
