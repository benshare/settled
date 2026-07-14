# Realtime resync on app foreground

## Problem

A player received the "game is starting" push notification, but when they opened
the app the game invite still showed one player as pending and no game appeared
in their list. Force-quitting and relaunching the app fixed it.

### Root cause

When the last invitee accepts, `handleRespond` in
`supabase/functions/game-service/index.ts` does three things: INSERT the `games`
row, DELETE the `game_requests` row, then send the push notifications. Clients
learn about the first two **only** through the two realtime channels created in
`useGamesStore.loadForUser` (`game_requests_rtu`, `games_rtu`).

Those channels are subscribed exactly once — when `loadAllUserStores` runs on
sign-in / app launch. Nothing in the app ever re-subscribes or refetches:

- There is no `AppState` listener anywhere in the codebase.
- The only other `loadForUser` call is inside `respond`, i.e. only for the user
  who is doing the accepting.
- No pull-to-refresh on `play.tsx`.

So: the affected player's app was backgrounded (which is _why_ they got a push
at all) → the OS suspended the JS thread and the WebSocket closed → the `games`
INSERT and `game_requests` DELETE were emitted while they were disconnected →
Supabase realtime has no replay on reconnect, so those events are gone → the
player foregrounded the app, which does not remount `(app)/_layout`, so
`loadForUser` never ran again → the store still held the stale request (one
pending) and no game. Force-quitting forced a cold start, which re-ran
`loadAllUserStores`.

The same hole exists mid-game: `GameProvider` fetches `game_states` once on
mount and then relies on its channels. Background the app during another
player's turn and the board stays stale until the screen is unmounted and
re-entered.

Contributing factor: `lib/supabase.ts` does not wire
`supabase.auth.startAutoRefresh()` / `stopAutoRefresh()` to `AppState`, which
the Supabase React Native docs require. Without it, a session that expires while
backgrounded can leave realtime unable to rejoin with a valid JWT even after the
socket reconnects.

## Approach

Realtime is a best-effort transport, not a source of truth. Any time the socket
could have been down, the client must re-read state from the database rather
than assume it kept up. The one moment we can reliably detect that in a mobile
app is the background → foreground transition.

Add a small foreground-resync layer, and have every subscribed surface hook into
it:

1. `lib/appState.ts` — a single module-level `AppState` listener plus a
   `useAppForeground(cb)` hook.
2. Auto-loaded stores re-run `loadForUser` on foreground (which refetches _and_
   tears down / re-subscribes their channels).
3. `GameProvider` refetches the `games` + `game_states` rows and re-subscribes
   its two channels on foreground.
4. `lib/supabase.ts` wires auth auto-refresh to `AppState` per the Supabase RN
   docs.

## Detail

### 1. `lib/appState.ts` (new)

```ts
export function useAppForeground(cb: () => void): void
```

- One module-level `AppState.addEventListener('change', …)`, registered lazily on
  first subscriber. Listeners kept in a `Set`.
- Fire **only** on `background → active`. iOS reports `inactive` for transient
  states (notification-center pull, app-switcher peek, incoming call banner)
  where the socket is still alive; resyncing on those would spam queries. Track
  the previous state in a module-level variable seeded from
  `AppState.currentState`.
- Before notifying listeners, `await supabase.auth.getSession()`. In supabase-js
  v2 this refreshes an expired token, so the resync (and any channel rejoin that
  follows) runs with a valid JWT. Errors here are swallowed — a resync attempt
  with a stale token is still better than no resync.
- The hook keeps the callback in a ref so consumers don't need a stable
  `useCallback` identity to avoid resubscribing.

RN Web maps `AppState` onto `visibilitychange`, so this works on web too. No
platform gate.

### 2. Store resync

`app/_layout.tsx` (`RootNav`) already calls `loadAllUserStores(user.id)` when
`user?.id` changes. Add alongside it:

```ts
useAppForeground(() => {
	if (user?.id) loadAllUserStores(user.id)
})
```

No changes needed inside the stores: `loadForUser` in both `useGamesStore` and
`useFriendsStore` already removes and recreates its channels at the end, and
neither wipes its data to `undefined` at the start (they only set
`loading: true`), so a resync produces no loading flicker. `useProfileStore` has
no channel; reloading it is one cheap query and keeps the registry uniform.

### 3. `lib/catan/gameContext.tsx`

Currently:

- effect A: subscribes to `games` UPDATE for this id, seeding `liveGame` from
  the store.
- effect B: fetches `game_states` once, then subscribes to its changes.

Both channels are dead after a background, and neither refetches. Change:

- Add `const [resyncNonce, setResyncNonce] = useState(0)` and
  `useAppForeground(() => setResyncNonce((n) => n + 1))`.
- Add `resyncNonce` to both effects' dep arrays so they tear down and re-create
  their channels on foreground.
- Effect A additionally fetches the `games` row (`select('*').eq('id', gameId)`)
  and sets `liveGame` from it, so the game row is refreshed and not just
  re-subscribed. This also removes the current dependency on the store having
  the game (the `if (storeGame && !liveGame)` seeding effect stays as a fast
  path so there is no flash before the fetch lands).
- Effect B's existing fetch already re-runs when the effect re-runs — nothing to
  add beyond the dep.
- Do not reset `gameState` / `stateLoaded` to their empty values on a resync
  re-run — only on a `gameId` change. Otherwise foregrounding flashes the board
  back to its loading state. `setStateLoaded(false)` must therefore move into a
  `gameId`-only guard, or the loading flag must not be reset when the refetch is
  a resync.

### 4. `lib/supabase.ts`

Per the Supabase React Native docs, add a module-level listener (native only —
web tabs don't suspend timers the same way and `startAutoRefresh` is the
default there):

```ts
if (isNative) {
	AppState.addEventListener('change', (state) => {
		if (state === 'active') supabase.auth.startAutoRefresh()
		else supabase.auth.stopAutoRefresh()
	})
}
```

This is deliberately a separate listener from `lib/appState.ts` — it must react
to _every_ state change (including `inactive`), not just the
`background → active` edge, and it must not depend on React.

## Out of scope

- **Resync on socket reconnect (network change while foregrounded).** Losing
  Wi-Fi and falling back to cellular while the app is open drops the same events
  and is not covered by a foreground hook. The fix would be to resync on channel
  `SUBSCRIBED` after a rejoin. Left out to keep this change tight; the reported
  bug is the background case.
- **Pull-to-refresh on `play.tsx`.** Considered as a manual escape hatch; the
  user opted for the automatic resync only.
- **Event replay / catch-up.** No attempt to reconstruct missed realtime events;
  we re-read current state instead.

## Verification

`npm run check` plus a manual pass on a device/simulator with two accounts:

1. Account A creates a game invite for account B.
2. B opens the app (invite shows pending), then backgrounds it.
3. A accepts (or, in a 3-player game, the last invitee accepts) so the game is
   created and the request row is deleted while B is backgrounded.
4. B foregrounds the app **without force-quitting**: the invite should
   disappear and the new game should appear in the Play list. (Before this
   change, B keeps showing the stale invite.)
5. With a game open on B's phone, background it, have A take a turn, foreground
   B: the board should reflect A's move without leaving the screen.
