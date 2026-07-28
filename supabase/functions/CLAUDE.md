# Supabase Edge Functions

Deno runtime, deployed with `supabase functions deploy <name>`. These run server-side with the service role available via `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`.

## Conventions

- **One function per subsystem, `action`-dispatched.** `game-service` handles every write to the games subsystem — `respond`, `roll`, etc. New game operations become new cases in the `switch (body.action)`. Grow this before spinning up a second function.
- **Authenticate the caller via their JWT.** Read the `Authorization` header, hand it to a regular (anon-key) client, call `auth.getUser()` to get the user id. All other reads/writes use the service-role admin client. Return 401 if the caller is not authenticated.
- **Writes bypass RLS.** Functions use the service-role key, so tables they mutate don't need client-writable RLS policies. Keep select policies permissive enough for the app's real-time and read paths; drop the insert/update/delete policies that exist only to support `security invoker` SQL RPCs.
- **Background tasks via `EdgeRuntime.waitUntil(promise)`** — runs after the HTTP response returns. Use for delayed work (e.g. the 3s setup finalizer) so the caller isn't held open. Make the work idempotent (re-read state, guard on expected precondition) in case the function runs twice.
- **Best-effort side writes must not fail the action.** When a game completes, `commitActionWrite` also summarizes it into `game_results` (final points, placement, bonus/curse — the Stats tab's source, since `game_states` is live-shaped and can't be rescored later). That write only logs on failure: the game is already over, the caller is owed its 200, and `dev/backfill-game-results.ts` can rebuild any missing row. Same shape for any future derived-data write.
- **`commitActionWrite` is the only place a game ends.** Its `opts` bag covers the two non-victory endings: `gameFields` merges extra columns into the games update (`forfeits` / `end_votes`), `byForfeit` stamps the `game_results` rows, and `canceled` sets `status = 'canceled'` **and skips the results write entirely** — a canceled game contributing nothing to stats is enforced by never writing the summary, not by filtering later. It also skips an empty `game_states` update, since a declaration that doesn't end the game touches only the games row and PostgREST rejects an empty PATCH body. New endings belong here rather than in a hand-rolled write, so the state → games → results ordering stays in one place.
- **`set_forfeit` / `set_end_vote` are idempotent setters, not four verbs.** Each takes `{ game_id, on }`; a re-send that matches the stored array returns 200 without writing, logging or notifying. Both accept `status in ('placement','active')` — the whole in-progress window — and resolve the caller's seat with `player_order.indexOf`, **not** `currentPlayerIndex`, which returns null for the entire (simultaneous) bonus-selection phase. Neither declaration has any mechanical effect; see the forfeiting section of `lib/catan/CLAUDE.md`.
- **Error shape.** Reply with `{ ok: false, error: string }` and an appropriate HTTP status. The client store surfaces a generic user-facing message — the edge function's error strings are for logs.
- **CORS is required for web callers.** Handle `OPTIONS` preflight with `Access-Control-Allow-Origin/Headers/Methods` and add the same `Access-Control-Allow-Origin` to every response. Native clients don't care, but the web app calls through the browser's fetch which enforces CORS.

## Notification copy

`_notify`'s `sendNotifications` titles every push `'Settled'` and generates the body from the kind. Two opt-in escapes exist for kinds that don't fit that mould, both used by `chat_message`:

- `titleFrom: 'sender'` — title becomes the sender's username (falling back to `'Settled'` if the profile can't be read, so a title is never `undefined`). It's a flag rather than a title string because `sendNotifications` already resolves usernames; a string param would force callers into a duplicate lookup.
- `bodyOverride` — ships arbitrary text instead of generated copy. Truncated to `MAX_BODY_CHARS` (150) so a 500-char chat message isn't clipped by the OS at an arbitrary point.

A target with no `gate` is ungated and always sends (the honk, plus the four forfeit/end-game kinds — rare and consequential enough not to earn a preference toggle). **A new kind must be added to `lib/notifications/links.ts` too**, or its tap resolves to `null` and does nothing.

## Deep-link payload

Each push carries a `data` blob of `{ kind, game_id?, request_id? }`, and that is the entire contract with the client's `resolveNotificationLink` (`lib/notifications/links.ts`). Two rules follow:

- **`NotificationKind` here and in `links.ts` are twins.** Adding a kind server-side without adding it to the client union sends it to that switch's `default`, which returns `null` — the notification arrives, and tapping it does nothing at all. This is exactly how `honk` shipped broken.
- **A kind that names something must carry its id.** Anything about a game passes `gameId`; `game_invite` passes `requestId` instead, because at that point there is only a `game_requests` row — it deep-links to `/game/request/[id]`, the screen that can accept or decline. A kind with no id falls back to a list screen, which is a worse landing than the tap deserves.

## The app-icon badge

Every push carries a `badge`, and it is **not** a notification count — it's the recipient's number of in-progress games whose `current_turn` names them, the same "your turn" signal the Games list shows as a per-row dot (`isMyTurn` in `lib/stores/useGamesStore.ts`; `badgeCounts` is the server mirror, and inherits the same `null`-during-bonus-selection and lags-during-special-build approximations). It rides every kind, not just `your_turn`, so a chat message or friend request also corrects a badge that drifted while the app was closed — and a user with nothing waiting gets an explicit `0`, which is what clears the icon.

This only works because every `sendNotifications` call sits after its write has committed (inside `EdgeRuntime.waitUntil`), so the `games` rows it counts already reflect the action the push is announcing. A caller that ever notifies _before_ committing would badge the pre-action count.

The client sets the same number from `useGamesStore` while the app is running (`useAppBadge`, mounted in the **root** layout — see the note in `lib/notifications/badge.ts` about why not `(app)`), which is what clears the badge the moment you take your turn without waiting for a push. It re-applies on every foreground as well as on change, since a push that landed while we were backgrounded set the badge from a count the store never saw.

## Env

Deno reads `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` from the function's environment (Supabase auto-provides these at deploy time).

## Type-checking

`tsconfig.json` excludes `supabase/functions` — we don't want Expo's TS config checking Deno-style imports. Edge function type errors surface at deploy time via `supabase functions deploy`.
