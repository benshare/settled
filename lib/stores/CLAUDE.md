# Stores

Two kinds of stores live here.

## 1. Bespoke stores

Loaded explicitly by routes that need the result before they can proceed — the pre-`(app)` flows (`login.tsx`, `verify.tsx`, `set-username.tsx` all `await useProfileStore.loadProfile()`), which can't rely on the auto-load registry that only runs once inside `(app)`.

## 2. Auto-loaded user stores

Registered in `index.ts`, loaded once when a user enters `(app)`, cleared on sign out. Use for any store whose data is user-scoped and whose load is fire-and-forget (failure non-fatal; the screen owns its own empty/loading state). `useStatsStore` is the plainest example, and deliberately keeps **no realtime channel** — `game_results` rows appear only when a game ends, and the foreground resync below already refetches on every return to the app.

`useStatsStore` holds two slices, both read-only and both settling their own failure so one can't blank the other: `results`, the reader's own `game_results` rows (RLS-scoped to games they sat at), and `cardStats`, **global** per-bonus/curse counts across everybody's games. The second reads the `card_stats` view rather than the table — widening the table's select policy would expose other people's individual scores, whereas a view of counts exposes nothing recoverable. See `.claude/specs/card-global-stats.md`; the view also excludes dev profiles, which is the aggregate analogue of the rule below.

A single store can serve both roles: `useProfileStore` registers for auto-load _and_ exposes `loadProfile` for the pre-`(app)` routes.

### `useGameStatesStore` is downstream of `useGamesStore`

It holds the `game_states` row for every game the viewer is seated at, so that (a) the "waiting on you" signal can be derived honestly rather than guessed from a turn pointer, and (b) opening one of those games renders warm. See `.claude/specs/pending-action-signal.md`; the parts that bite:

- **Its id set is `activeGames`, never a query of its own.** It subscribes to `useGamesStore` and re-syncs when that set changes — cold start, a game starting, a game ending. It is _also_ registered for auto-load, purely for the foreground resync: when no ids have moved the subscription fires nothing, and the store would sit on a dead channel. So the subscription owns _which_ games and the registry owns _freshness and the socket_. The two run in parallel on a cold start; it simply holds nothing until the games store's load lands.
- **The channel is bound per id, and that narrowing is not optional.** RLS also admits every friend's watchable game, and a `postgres_changes` payload is the whole row (it cannot project columns), so an unfiltered subscription would stream full boards for games the viewer isn't playing. Rebuilding on every id change is the price.
- **A resync reads `updated_at` before it reads rows.** Board rows are large and most foregrounds find nothing new, so a stamp query decides what to pull. A game that was never loaded skips the stamp pass — it would only add a round trip in front of a fetch we already need.
- **Games not in `activeGames` come in through `watch`/`unwatch`** (refcounted, called by `GameProvider`) — a spectated or finished game, plus the freshness check when opening any game.

### Adding an auto-loaded store

1. Create `useMyStore.ts` with a zustand store, a `loadForUser(userId)` action and a `clear()` action.
2. In the same file, export an `AutoLoadedStore` registration object (`name` + `loadForUser` + `clear` delegating to the store).
3. Import and add it to `autoLoadedStores` in `index.ts`.

`app/_layout.tsx` calls `loadAllUserStores(user.id)` on mount; `account.tsx` calls `clearAllUserStores()` on sign out.

## Realtime is best-effort — resync on foreground

While the app is backgrounded the OS closes the WebSocket, and Supabase realtime does **not** replay missed events on reconnect. A store that subscribes once and then trusts its channel silently drifts. So `app/_layout.tsx` also calls `loadAllUserStores(user.id)` from `useAppForeground` (`lib/appState.ts`) on every background → foreground transition. That works only because `loadForUser` refetches _and_ re-creates its channels — keep all four properties when writing a store:

- **Idempotent and safe to call repeatedly.**
- **Must not wipe data to `undefined` on entry** (set a `loading` flag instead), or a resync flashes every consumer into its loading state.
- **Must `removeChannel` any existing channel before subscribing**, or a resync leaks one channel per foreground.
- **Must name that channel with `uniqueTopic()` (`lib/realtime.ts`), never a bare string.** A socket holds one channel per topic and `removeChannel` is async; on a socket that died in the background, rejoining the same topic is refused by the server with nowhere to report it, and realtime goes quiet for the session. (This is how a robber placement appeared to fail: the move succeeded, the board never advanced, the retry was rejected as out-of-phase.)

Any component that subscribes outside a store (e.g. `GameProvider`) owes the same debt. Three further guards:

- **A realtime UPDATE payload can be missing columns — never apply one wholesale.** Postgres omits unchanged TOASTed columns, so once a jsonb column outgrows the TOAST threshold every write that doesn't touch it delivers a row without it. On `games` that column is `events`, and the writes that leave it alone are routine (the deadline stamp, the timeout warning bump), so the partial payload is the _common_ case. `isPartialGameRow` is the test; both subscribers (store and `GameProvider`) **merge the payload onto the row they already hold** rather than re-reading (an omitted column is an unchanged one, so the merge is exact). `game_states` re-reads instead (`isPartialStateRow` in `useGameStatesStore`), because there the omitted columns are the whole board. Applying such a row as-is empties `game.events` for a beat — enough to make the game screen's animation cursors re-seed at zero and replay every animation in the game.
- **Refetch from the `subscribe()` status callback on `SUBSCRIBED`.** The fetch and the join race, so an event landing between the fetch's snapshot and the join reaches nobody. Reading once the channel is live closes that gap, on first join and every automatic rejoin.
- **Never make a player wait on realtime to see their own move.** Every game-service call goes through `callGameService`, which pings `lib/gameSync.ts` on success and re-reads the changed rows. The edge function's 200 already confirmed the write. This is a re-read, not an optimistic update.

`lib/appState.ts` also force-bounces the socket (`disconnect()` → `connect()`) on foreground, because React Native doesn't reliably surface the close and supabase-js will otherwise keep rejoining a dead one.

## Spectatable games share the active-games query

With the spectator RLS policies in place (see `.claude/specs/spectating.md`), `select * from games where status in ('placement','active')` returns both games the user is seated at and games they may merely watch. `loadForUser` issues one query and partitions the rows by `participants.includes(userId)` into `activeGames` / `spectatableGames`; `handleGameChange` routes realtime rows by the same test (hence the store keeps `meId`). Two things that are easy to get wrong:

- **The completed-games query needs `.contains('participants', [userId])`,** or every finished game the user only watched lands in their History.
- **`completeGames` holds both endings.** A whole-table end-vote gives `status = 'canceled'` (no winner, contributes nothing to stats) and shares History with a completed game, so the query is `.in('status', ['complete', 'canceled'])` and every status test routes on the exported **`isFinished(status)`**, never `=== 'complete'` — an equality check leaves a canceled game looking playable and a spectator holding a stale header tab.
- **`spectatableGames` is a first-contact surface** (it shows a friend's co-players, who the viewer may never have met), so it filters dev profiles in production per the rule below. Games the user is seated at are never filtered.

`spectatableGames` is everything the viewer _may_ watch; the header tab strip shows only games they're _actively_ watching, kept in `profiles.spectating` (owned by `useProfileStore`, all optimistic). `useGamesStore` cross-references it so a spectated game that ends can't linger as a stale tab (`handleGameChange` stops spectating on complete/delete; `loadForUser` prunes games that ended while the app was closed). Both are best-effort — `useSwitchableGames` intersects `spectating` with `spectatableGames` (which already drops completed games), so the tab disappears regardless.

## Profile columns are listed per store

`PROFILE_COLS` is declared separately in `useProfileStore`, `useFriendsStore` and `useGamesStore`, and all three must select the **same** set — each constructs a full `Profile` row, so a column added to the table must be added to all three or the two that missed it fail to typecheck. Only `useProfileStore` ever writes profile fields (`updateColorPrefs`, optimistic with rollback); the other two fetch them purely to build `Profile` objects.

## Dev-flagged profiles

`profiles.dev` marks users that exist only for local/dev testing (see `dev/seed-test-users.mjs`). **In production builds, every user-facing query that returns or searches profiles must filter these out** — non-`__DEV__` clients should never show a dev user to a real user. The convention:

1. Gate the filter on `!__DEV__` (a Metro compile-time constant).
2. Direct profile queries add `.eq('dev', false)`; queries that embed profiles via joins fetch and post-filter client-side.
3. **Filter from searches, not from specific lookups.** A query that surfaces profiles a user could meet for the first time (user search, friend suggestions, invitable lists) is filtered; a query that dereferences ids the user is already connected to (game participants, past messages, existing friends) is not — hiding a dev user they're already entangled with breaks the UI more than it protects. Self-loads and username-uniqueness checks are never filtered.

Any new query that surfaces profiles needs to follow this. If you're unsure whether a query counts as user-facing, the default is yes — filter it.
