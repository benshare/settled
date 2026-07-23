# Stores

Two kinds of stores live here.

## 1. Bespoke stores

Loaded explicitly by routes that need the result before they can proceed — e.g. `login.tsx`, `verify.tsx`, `set-username.tsx` all `await useProfileStore.loadProfile()` before deciding where to route. These pre-(app) flows can't rely on the auto-load registry, which only runs once the user enters `(app)`.

## 2. Auto-loaded user stores

Registered in `index.ts`. Loaded once when a user enters `(app)`, cleared on sign out. Use this for any store whose data is scoped to a signed-in user and whose load can be fire-and-forget — failure is non-fatal, and the screen using the data is responsible for its own empty/loading state.

`useStatsStore` is the plainest example: it selects the caller's `game_results` rows (per-game summaries the edge function writes on completion — see `.claude/specs/stats.md`) and deliberately keeps **no realtime channel**. Rows only appear when a game ends, and the foreground resync below already refetches on every return to the app, which is also the path back from a game that just finished.

A single store can serve both roles: `useProfileStore` registers in `autoLoadedStores` for in-(app) screens (so `state.profile` is always populated on cold start) _and_ exposes `loadProfile` for the pre-(app) routes that need to await it.

### Adding an auto-loaded store

1. Create `useMyStore.ts` with a zustand store. Give it a `loadForUser(userId)` action and a `clear()` action.
2. In the same file, export a registration object:

    ```ts
    import type { AutoLoadedStore } from './index'

    export const myStoreRegistration: AutoLoadedStore = {
    	name: 'my',
    	loadForUser: (userId) => useMyStore.getState().loadForUser(userId),
    	clear: () => useMyStore.getState().clear(),
    }
    ```

3. Import and add it to `autoLoadedStores` in `index.ts`.

`app/_layout.tsx` calls `loadAllUserStores(user.id)` on mount; `account.tsx` calls `clearAllUserStores()` on sign out.

## Realtime is best-effort — resync on foreground

While the app is backgrounded the OS suspends the JS thread and closes the
WebSocket, and Supabase realtime does **not** replay events on reconnect. Every
`postgres_changes` event emitted during that window is lost. A store that
subscribes once at load and then trusts its channel will silently drift (this is
how a player kept seeing a pending game invite for a game that had already
started).

So `app/_layout.tsx` also calls `loadAllUserStores(user.id)` from
`useAppForeground` (`lib/appState.ts`) on every background → foreground
transition. This works because `loadForUser` refetches _and_ re-creates its
channels — keep both properties when writing a new store:

- `loadForUser` must be idempotent and safe to call repeatedly.
- It must not wipe its data back to `undefined` on entry (set a `loading` flag
  instead), or a resync will flash every consumer into its loading state.
- It must `removeChannel` any existing channel before subscribing a new one, or
  a resync leaks a channel per foreground.
- **It must name that channel with `uniqueTopic()` (`lib/realtime.ts`), never a
  bare string.** A socket holds one channel per topic, and `removeChannel` is
  async — on a socket that died in the background its `leave` may never land at
  all. Rejoining the same topic in that window is refused by the server, and
  `.subscribe()` has nowhere to report it, so realtime goes quiet for the rest of
  the session. (This is exactly how a robber placement appeared to fail: the move
  succeeded server-side, the board never advanced, and the retry was rejected as
  out-of-phase.)

Any component that subscribes to its own channel outside a store (e.g.
`GameProvider`) owes the same debt: refetch and re-subscribe from
`useAppForeground`.

Two further guards, because none of the above is worth trusting on its own:

- **Refetch from the `subscribe()` status callback on `SUBSCRIBED`.** The fetch
  and the join race each other, so an event landing between the fetch's snapshot
  and the join reaches nobody. Reading once the channel is actually live closes
  that gap — on the first join and on every automatic rejoin after a drop.
- **Never make a player wait on realtime to see their own move.** Every
  game-service call goes through `callGameService` in `useGamesStore`, which
  pings `lib/gameSync.ts` on success; `GameProvider` re-reads the rows it just
  changed. The edge function's 200 already confirmed the write — the channel is
  not the only path to the result. This is a re-read, not an optimistic update.

`lib/appState.ts` also force-bounces the realtime socket
(`disconnect()` → `connect()`) on foreground, because React Native doesn't
reliably surface the close and supabase-js will otherwise keep rejoining a dead
one.

## Spectatable games share the active-games query

With the spectator RLS policies in place (see `.claude/specs/spectating.md`), `select * from games where status in ('placement','active')` returns two different things: games the user is seated at, and games they're merely allowed to watch. `loadForUser` issues one query and partitions the rows by `participants.includes(userId)` into `activeGames` / `spectatableGames`; `handleGameChange` routes realtime rows by the same test, which is why the store keeps `meId`.

Two consequences that are easy to get wrong:

- **The completed-games query needs `.contains('participants', [userId])`.** Without it, every finished game the user only watched lands in their History.
- **`spectatableGames` is a first-contact surface** — it shows a friend's co-players, who the viewer may never have met — so it filters dev profiles in production per the rule below. Games the user is seated at are never filtered.

`spectatableGames` is everything the viewer _may_ watch; the header tab strip shows only games they're _actively_ watching, kept in `profiles.spectating` (a `uuid[]` on the profile row, owned by `useProfileStore` — `startSpectating` / `stopSpectating` / `pruneSpectating`, all optimistic). `useGamesStore` cross-references it in two places so a spectated game that ends can't linger as a stale tab: `handleGameChange` calls `stopSpectating` when a watched game goes `complete`/is deleted, and `loadForUser` calls `pruneSpectating(spectatableGame ids)` to catch games that ended while the app was closed. Both are best-effort — the tab disappears for free regardless, since `useSwitchableGames` intersects `spectating` with `spectatableGames` (which already drops completed games).

## Dev-flagged profiles

`profiles.dev` is a boolean column (default `false`) used to mark users that only exist for local/dev testing — see `dev/seed-test-users.mjs`, which sets it to `true`. **In production builds, every user-facing query that returns or searches profiles must filter these out.** Non-`__DEV__` clients should never show a dev user to a real user.

The convention:

1. Gate the filter on `!__DEV__` (a React Native / Metro compile-time constant — `true` in dev builds, `false` in production).
2. For direct profile queries, add `.eq('dev', false)` when the gate is true (see `useFriendsStore.search`).
3. For queries that embed profiles via joins, it's simpler to fetch and post-filter client-side (`profile.dev === true` → drop the row). See `useFriendsStore.loadForUser`.
4. Self-loading the current user's own profile is never filtered — you are who you are.
5. Username-uniqueness checks are never filtered either: dev users still reserve usernames (the DB unique index is the real guard).
6. **Filter from searches, not from specific lookups.** If a query surfaces profiles a user could meet for the first time (user search, friend suggestions, invitable lists) — filter it. If a query dereferences ids the user is already connected to (game participants, past messages, existing friends' profile data), do not filter — hiding a dev user they're already entangled with breaks the UI more than it protects.

Any new store or query that surfaces profiles to the end user needs to follow this. If you're unsure whether a query counts as "user-facing", the default is yes — filter it.
