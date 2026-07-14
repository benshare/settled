# Stores

Two kinds of stores live here.

## 1. Bespoke stores

Loaded explicitly by routes that need the result before they can proceed — e.g. `login.tsx`, `verify.tsx`, `set-username.tsx` all `await useProfileStore.loadProfile()` before deciding where to route. These pre-(app) flows can't rely on the auto-load registry, which only runs once the user enters `(app)`.

## 2. Auto-loaded user stores

Registered in `index.ts`. Loaded once when a user enters `(app)`, cleared on sign out. Use this for any store whose data is scoped to a signed-in user and whose load can be fire-and-forget — failure is non-fatal, and the screen using the data is responsible for its own empty/loading state.

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

Any component that subscribes to its own channel outside a store (e.g.
`GameProvider`) owes the same debt: refetch and re-subscribe from
`useAppForeground`.

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
