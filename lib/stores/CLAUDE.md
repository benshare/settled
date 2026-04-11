# Stores

Two kinds of stores live here.

## 1. Bespoke stores

Loaded by the screens that need them. `useProfileStore` is the only one today. It's outside the auto-load registry because routing (`verify.tsx`, `set-username.tsx`) depends on its load completing at specific moments.

## 2. Auto-loaded user stores

Registered in `index.ts`. Loaded once when a user enters `(app)`, cleared on sign out. Use this for any store whose data is scoped to a signed-in user and whose load can be fire-and-forget — failure is non-fatal, and the screen using the data is responsible for its own empty/loading state.

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

`app/(app)/_layout.tsx` calls `loadAllUserStores(user.id)` on mount; `account.tsx` calls `clearAllUserStores()` on sign out.

## Dev-flagged profiles

`profiles.dev` is a boolean column (default `false`) used to mark users that only exist for local/dev testing — see `dev/seed-test-users.mjs`, which sets it to `true`. **In production builds, every user-facing query that returns or searches profiles must filter these out.** Non-`__DEV__` clients should never show a dev user to a real user.

The convention:

1. Gate the filter on `!__DEV__` (a React Native / Metro compile-time constant — `true` in dev builds, `false` in production).
2. For direct profile queries, add `.eq('dev', false)` when the gate is true (see `useFriendsStore.search`).
3. For queries that embed profiles via joins, it's simpler to fetch and post-filter client-side (`profile.dev === true` → drop the row). See `useFriendsStore.loadForUser`.
4. Self-loading the current user's own profile is never filtered — you are who you are.
5. Username-uniqueness checks are never filtered either: dev users still reserve usernames (the DB unique index is the real guard).

Any new store or query that surfaces profiles to the end user needs to follow this. If you're unsure whether a query counts as "user-facing", the default is yes — filter it.
