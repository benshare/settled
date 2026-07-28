# Notification deep linking

A correctness pass over what happens when a push notification is tapped. The
push side (who gets notified, what the copy says, the badge) is already right
and is out of scope — this is only about where the tap lands.

Prior art: `.claude/specs/notifications.md` (the original build),
`.claude/specs/game-chat.md` (the `chat=1` param).

## The five defects

### 1. A honk tap does nothing

`lib/notifications/links.ts` and `supabase/functions/_notify/index.ts` each
declare their own `NotificationKind` union, and they have drifted: `honk`
exists server-side but not client-side. `resolveNotificationLink` therefore
falls through to `default: return null` and the tap is swallowed — even though
the server passes a perfectly good `gameId`.

### 2. The routing listener dies after a push-launched session

`useNotificationRouting()` is mounted in `app/(app)/_layout.tsx`. Its cold-start
branch calls `router.replace('/game/x')`, which swaps the `(app)` group out of
the root stack — unmounting `AppLayout` and with it the response listener. From
that point on, every notification tap in the session is dead.

This is the same trap `useAppBadge` already documents and avoids by living in
the root layout (`lib/notifications/badge.ts`).

### 3. Back is a dead button after a push-launched session

The same `replace` empties the root stack: `index` → (redirect) `(app)` →
(replace) `game/[id]`, with nothing beneath. `Nav`'s chevron calls
`router.back()`, which no-ops. The user is stranded on the game screen — the tab
bar isn't rendered on this route, so there is no other way out.

### 4. The cold-start response replays

`getLastNotificationResponseAsync()` keeps returning the launching response for
the life of the process, and `addNotificationResponseReceivedListener` also
fires for it. So a single tap can navigate twice (once via `navigate`, once via
`replace`), and any later remount of the hook yanks the user back to a
notification they dealt with minutes ago.

`expo-notifications` ships the fix: `clearLastNotificationResponse()`.

### 5. `game_invite` lands on the list, not the invite

The payload carries no id at all — there is no game yet, only a `game_requests`
row — so the link resolves to `/games`. `/game/request/[id]` exists and is the
screen that can actually accept or decline.

## Decisions

- **`game_invite` deep links to `/game/request/[id]`.** The server starts
  sending the request id. No fallback logic is added: that screen already
  renders "This invite is no longer available." when the request isn't in the
  store, which is a correct and legible landing for an invite that was resolved
  elsewhere.
- **Back from a deep-linked game returns to the Games list.** Achieved by
  navigating on top of the tab group instead of replacing it, which means the
  cold-start branch has to wait until the group is actually mounted (below).

## Changes

### `lib/notifications/links.ts`

- Add `'honk'` to `NotificationKind`, in the `game_id` group.
- Add `request_id?: string` to `NotificationData`.
- `game_invite` → `/game/request/${request_id}` when present, `/games`
  otherwise. The fallback covers pushes queued by an older server build.
- Add a comment naming `supabase/functions/_notify/index.ts` as the union's
  twin, since drift between the two is what caused defect 1.

### `lib/notifications/responses.ts`

Rewrite around a single funnel. Both sources — the live listener and the
cold-start read — feed one `accept(response)` function, which:

1. Drops the response if its `notification.request.identifier` has already been
   handled this session (defect 4). Modelled on `determineNextResponse` in
   `expo-notifications`' own `useLastNotificationResponse`.
2. Calls `Notifications.clearLastNotificationResponse()` so a later mount can't
   replay it.
3. Resolves the link and parks it in `pending` state.

A second effect drains `pending` once the router is **ready**, where ready is
`segments.length > 0 && segments[0] !== '(auth)'`.

That one check covers everything. `useSegments()` reads expo-router's module
store through `useSyncExternalStore` rather than a navigation context, so unlike
`useRootNavigationState()` — which calls `useNavigation()` and throws outside a
route — it is safe to call from the root layout. It returns `[]` for exactly the
two states we must not navigate in: before the navigator has produced any state
(where `getNavigateAction`'s `store.assertIsReady()` would throw), and on
`index`, whose path is `/`, where the auth redirect would clobber us. `(auth)`
then holds the tap through login.

This is what makes a plain `router.navigate` safe on cold start (defects 3 and
4): the tab group is already underneath by the time we move, so Back works, and
there is no redirect left to race.

Parking rather than dropping also means a tap that arrives while signed out is
honoured after sign-in, rather than silently lost.

Use the non-deprecated sync `getLastNotificationResponse()` /
`clearLastNotificationResponse()` (SDK 57 deprecated the `Async` pair).

`router.navigate` for both paths, for the reason already in the file: it updates
the params of a game screen that's already on top instead of stacking a second
copy behind the chevron.

### `app/_layout.tsx` / `app/(app)/_layout.tsx`

Move `useNotificationRouting()` from `AppLayout` to `RootNav`, beside
`useAppBadge()` and above the `LoadingScreen` early return (defect 2). It has to
be called unconditionally; the readiness gate inside the hook is what holds the
navigation until the tree can take it.

`ensurePermissionAndRegister` **stays** in `(app)` — it is about being signed in
and inside the app, not about routing.

### `supabase/functions/_notify/index.ts`

- Add `requestId?: string` to `NotifyTarget`, emitted as `data.request_id`,
  alongside the existing `gameId` → `data.game_id`.

### `supabase/functions/game-service/index.ts`

- `handleProposeGame`'s `game_invite` targets pass `requestId: data.id` — the
  `game_requests` row it just inserted.

Deploy with `npm run edge`.

## Out of scope

- The push side: who is notified, gating, copy, badge counts.
- Web. Every module here has a `.web` twin that imports nothing; the twins are
  unchanged.
- Universal links / `expo-linking` URL handling. This is only about
  notification taps.
- Notifications for a game the viewer can no longer see. `GameProvider`'s "Game
  not found." is the correct landing and needs no special-casing.

## Verification

Native dev build (push does not work in Expo Go — see `lib/notifications/push.ts`).

1. **Honk** — from another account, honk the viewer. Tap. Lands on that game.
2. **Cold start, then a second tap** — force-quit, tap a `your_turn` push. Lands
   on the right game; Back returns to the Games list. Without leaving the game
   screen, have a second notification arrive for a _different_ game and tap it —
   the screen switches games. (This is the case that is entirely broken today.)
3. **Chat, cold** — force-quit, tap a chat push. Lands on that game with the
   panel open.
4. **Chat, warm, same game** — sit on game A with chat closed. Tap a chat push
   for A. The panel opens.
5. **Chat, warm, other game** — sit on game A. Tap a chat push for B. Switches
   to B with the panel open.
6. **Chat twice** — after 4, close the panel, tap a second chat push for the
   same game. The panel re-opens (the `chat=1` one-shot in `app/game/[id].tsx`
   is what makes this work).
7. **Invite** — invite the viewer from another account. Tap. Lands on
   `/game/request/[id]` with Accept / Decline. Resolve the invite elsewhere
   first and tap a stale one: "This invite is no longer available."
8. **No replay** — after 2, background and foreground the app repeatedly. It
   must not re-navigate to the launching notification.
9. **Signed out** — sign out, force-quit, tap a push, sign in. Lands on the
   notification's target after login rather than dropping it.
