# Notifications

Push notifications via Expo Push. The server half lives in `supabase/functions/_notify/` — read `supabase/functions/CLAUDE.md` alongside this.

- `push.ts` — permission flow, token registration, the foreground handler.
- `permissions.ts` — the OS permission status, re-read whenever the account screen focuses.
- `prefs.ts` — the `notification_prefs` JSONB blob on `profiles`. Parsing mirrors `parseGameDefaults`: silent fallback on shape drift.
- `badge.ts` — the app-icon count. See the file's own header for why it's the root layout and not `(app)`.
- `links.ts` — pure: payload → `Href`.
- `responses.ts` — when it is safe to actually go there.

## Every module has a `.web` twin that imports nothing

Not a no-op wrapper around the SDK — the twins do not import `expo-notifications` at all. Merely importing it on web runs its device-push-token auto-registration side effect, which registers a listener the web build can't honour and warns on every page load. The native `Platform.OS === 'web'` guards stay as the second line of defence. A new module here that touches the SDK needs a twin.

## Deep linking

Two files, split on purpose: `links.ts` decides **where** a tap goes and is a pure function of the payload; `responses.ts` decides **when** the app is able to go there.

- **`NotificationKind` is a twin of the union in `supabase/functions/_notify/index.ts`.** Drift means the `default` branch swallows the tap silently.
- **`useNotificationRouting` belongs in the root layout**, for the same reason as `useAppBadge` plus one of its own: a deep link puts `/game/[id]` on top of the tab group, so a hook mounted under `(app)` can lose its listener and stop handling every tap after the first.
- **Navigate, never replace.** `navigate` targets the divergent state by dynamic path, so a tap for a different game updates the params of the game screen already on top instead of stacking a second copy — and it leaves the tab group underneath, so Back out of a deep-linked game reaches the Games list rather than an empty stack.
- **A tap is parked, not fired on arrival.** `router.navigate` throws (`store.assertIsReady`) before the navigator has state, and loses to `index`'s auth redirect while that's still resolving. `responses.ts` holds the resolved link until `useSegments()` is non-empty and outside `(auth)` — one check that covers both, and which incidentally honours a tap that arrived while signed out once the user is through login. `useSegments` is safe to call from the root layout because it reads the module store; `useRootNavigationState` is not, because it calls `useNavigation()`.
- **Responses are deduped and cleared.** The native layer hands the launching response back for the life of the process, and the listener may deliver it too. `responses.ts` dedupes on `notification.request.identifier` and calls `clearLastNotificationResponse()`, or one tap navigates twice and a later mount re-navigates to a notification dealt with minutes ago.

`chat_message` resolves to `/game/[id]?chat=1`. That param is a **one-shot request, not screen state** — `app/game/[id].tsx` clears it as soon as the panel has been told to open, so dismissing chat and tapping a second notification for the same game re-opens it. Leaving the param set would mean the second tap changes nothing to react to.
