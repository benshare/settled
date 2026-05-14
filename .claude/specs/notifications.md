# Notifications

Add push notifications (OS-level via Expo Push) for three kinds of events, with an in-app banner for foreground delivery, a settings section, and per-user preferences. Skipped entirely on web.

The three core events:

1. **`game_invite`** — someone invited you to a game.
2. **`your_turn`** — it's your turn in a game (placement or active phase).
3. **`friend_request`** — someone sent you a friend request.

Plus two ancillary triggers landed in v1 to round out the gameplay loop:

4. **`game_started`** — all invitees accepted; the game is starting. Sent to every participant. The first-player copy doubles as their `your_turn` push (no separate fire).
5. **`discard_required`** — a 7 was rolled and you owe a discard.
6. **`trade_proposed`** — another player proposed a trade to you.

## Scope

In scope:

- `expo-notifications` permission flow on first entry into `(app)` (and via a "Enable notifications" affordance in the new settings section if the user originally denied or it was never asked).
- `push_tokens` table: `(user_id, token, platform, updated_at)`, one row per (user, device) keyed by Expo push token.
- `notification_prefs` JSONB column on `profiles`, mirroring the existing `game_defaults` pattern. Defaults to all-on.
- `lib/notifications/` module: token registration, permission helpers, foreground handler, deep-link router, settings store.
- New `Notifications` section inside `account.tsx` between `Appearance` and `Sign out`.
- Server: a small shared `_notify.ts` module under `supabase/functions/` that builds Expo Push request bodies and posts them.
- `game-service` edge function: emit pushes at the six identified hand-off points via `EdgeRuntime.waitUntil`.
- New `friends-service` edge function: `send` action takes over the friend-request insert path so the server controls push timing. Accept / reject / cancel stay on their existing client paths (no push to send on those per the chosen scope).
- Deep-link routing: tapping a notification opens the relevant screen (`/play`, `/game/<id>`, or `/friends`).
- DB migration + types refresh.

Out of scope (deferred):

- Notifications for friend-request accepted/rejected, game-invite responses, game-completion.
- Quiet hours / scheduling.
- Notification categories with inline actions (e.g. accept/decline directly from the lockscreen).
- Sound/badge customization beyond Expo defaults.
- Email/SMS fallback.
- Web push (service worker, VAPID).
- Cleanup of stale tokens beyond the "delete on sign-out from this device" path.
- Localization.

## Design decisions (locked in)

1. **OS push + in-app banner.** `expo-notifications` `setNotificationHandler` returns `{ shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false }` so the system banner shows on foreground too. This keeps a single rendering path (the OS banner) rather than a custom in-app toast. No app-side banner component is built.

2. **`notification_prefs` as a JSONB column on `profiles`.** Same shape pattern as `game_defaults`. Three booleans for v1, defaulted on:

    ```ts
    type NotificationPrefs = {
    	gameInvite: boolean
    	yourTurn: boolean
    	friendRequest: boolean
    }
    ```

    `game_started`, `discard_required`, and `trade_proposed` all gate on `yourTurn` (they're all variants of "you have an action to take in a game"). This keeps the settings UI to three intuitive toggles instead of six. If the user later wants finer granularity, the column can be widened without a table refactor.

3. **`push_tokens` table, not a column.** Each user can have multiple devices. Schema:

    ```sql
    create table public.push_tokens (
        token text primary key,
        user_id uuid not null references public.profiles(id) on delete cascade,
        platform text not null check (platform in ('ios', 'android')),
        updated_at timestamptz not null default now()
    );
    create index push_tokens_user_id_idx on public.push_tokens (user_id);
    ```

    Primary key is `token` so a token migrating between users (rare — typically due to a re-install on a shared device) overwrites the prior owner via `upsert`. RLS allows a user to insert/update/delete their own rows; reads from the edge function use the service-role admin client.

4. **Token registration runs once per `(app)` mount, after permission is granted.** If permission is denied, no token call is made. If granted, we always call `getExpoPushTokenAsync()` (Expo returns the cached token cheaply) and upsert it. On sign-out, the current device's token is deleted (best-effort; failure does not block sign-out).

5. **Server triggers are inline in edge functions via `EdgeRuntime.waitUntil`.** Push fan-out happens after the response is sent. Errors are logged but never bubble back to the caller. Idempotency isn't needed for the push itself — Expo's API is fire-and-forget, and a duplicate push from a re-execution would be a minor annoyance, not a correctness issue. The triggers themselves are written as guards on observable state transitions, so an idempotent re-run that arrives at the same final state produces the same push set.

6. **"Action handoff" semantics for `your_turn`.** A push fires only when a player who **was not actionable just before** becomes actionable. The edge function never tracks an explicit `pending_actors` array on the games table — it derives the set from the transition itself. Concretely:

    | Action                                     | Who gets pushed                                                                                                                                |
    | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
    | `respond` final accept (`game_started`)    | All participants. The first-player slot gets the "game starting, you're up" copy; everyone else gets "game starting". No separate `your_turn`. |
    | `place_road` advances placement turn       | The next player_order entry.                                                                                                                   |
    | `place_road` ends placement → `roll` phase | First player in player_order. (Skipped if `post_placement` phase is entered, since the bonus resolution still goes to the same active player.) |
    | `end_turn`                                 | New `current_turn` player.                                                                                                                     |
    | `roll` → `discard` phase                   | Every player in `pending` keys (including the active player if they owe a discard). Kind = `discard_required`.                                 |
    | `propose_trade`                            | Every `to` index → resolved to user_id via `player_order`. Kind = `trade_proposed`.                                                            |

    Mid-turn phase transitions that keep responsibility on the same player (`discard → move_robber`, `move_robber → steal`, `steal → main`, etc.) emit **no** push.

7. **`game_started` doubles as `your_turn` for the first player.** Single push, copy reads e.g. "Game starting — you're up first." This avoids a 1-second double-push on the first player's device. The push payload's `kind` is `game_started` for everyone (not split) so deep-link routing is uniform; the active player just sees different body text.

8. **Friends path: only `send` moves to an edge function.** The `friends-service` Deno fn handles the `send` action (which inserts the row and fires the push). `accept` continues to call the `accept_friend_request` RPC; `reject` continues with a direct update; `cancel` continues with a direct delete. None of those three emit pushes in v1, so refactoring them through the edge function would be churn.

    Once the edge function owns `send`, the client-side `friend_requests_insert_sender` RLS policy can be dropped (the edge function uses the service role). Other policies stay; the receiver still needs to update/select rows directly.

9. **Tap routing via a notification `data` payload.** Each push carries `{ kind, ...params }`. `lib/notifications/links.ts` exposes a single `resolveNotificationLink(data)` returning the deep-link path. The root layout subscribes to `addNotificationResponseReceivedListener` and `getLastNotificationResponseAsync()` (cold start case).

    Routes:
    - `game_invite` → `/play`
    - `game_started` → `/game/<id>` (we have the id in the payload by then)
    - `your_turn`, `discard_required`, `trade_proposed` → `/game/<id>`
    - `friend_request` → `/friends`

10. **Skip on web.** All public functions in `lib/notifications/` early-return when `Platform.OS === 'web'`. The settings section also skips rendering in that case. Web users still get realtime updates inside the app; they just don't get OS pushes.

11. **Permission UX.** First-time permission is requested non-blockingly the first time the user is in `(app)` with notifications enabled in prefs (i.e., new sign-ups land in `(app)`, prefs default on, we ask once). If the OS returns "denied" or the user wants to re-enable later, the settings section shows a clear "Notifications disabled in system settings — open Settings" affordance using `Linking.openSettings()`. We don't pre-explain ("priming") in v1 — the system prompt is descriptive enough for this app's scope.

12. **Default copy** (centralized in `_notify.ts` server-side and `links.ts` client-side for deep-link routing; the two never disagree because copy lives only on the server):

    | kind               | title   | body                                          |
    | ------------------ | ------- | --------------------------------------------- |
    | `game_invite`      | Settled | `<proposer> invited you to a game.`           |
    | `game_started`     | Settled | `Game starting.` (1st-player suffix appended) |
    | `your_turn`        | Settled | `It's your turn.`                             |
    | `discard_required` | Settled | `You rolled a 7 — discard cards.`             |
    | `trade_proposed`   | Settled | `<proposer> proposed a trade.`                |
    | `friend_request`   | Settled | `<sender> sent you a friend request.`         |

    Titles are uniform ("Settled") so badges read sensibly; the action is in the body. Names come from a profile lookup at fan-out time.

## Database migration

Single file: `supabase/migrations/<ts>_notifications.sql`.

```sql
-- 1. Notification preferences on profiles, defaulted to all-on.
alter table public.profiles
    add column notification_prefs jsonb not null default jsonb_build_object(
        'gameInvite', true,
        'yourTurn', true,
        'friendRequest', true
    );

-- 2. push_tokens
create table public.push_tokens (
    token text primary key,
    user_id uuid not null references public.profiles(id) on delete cascade,
    platform text not null check (platform in ('ios', 'android')),
    updated_at timestamptz not null default now()
);

create index push_tokens_user_id_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

create policy "push_tokens_select_self" on public.push_tokens
    for select to authenticated
    using (auth.uid() = user_id);

create policy "push_tokens_insert_self" on public.push_tokens
    for insert to authenticated
    with check (auth.uid() = user_id);

create policy "push_tokens_update_self" on public.push_tokens
    for update to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "push_tokens_delete_self" on public.push_tokens
    for delete to authenticated
    using (auth.uid() = user_id);

-- 3. Drop the now-redundant friend_requests_insert_sender policy. The
--    friends-service edge function takes over inserts via the service role.
drop policy if exists "friend_requests_insert_sender" on public.friend_requests;
```

After writing the migration, **stop and show the user the full SQL**. User runs `npm run migrate` then `npm run types`. Claude does not run destructive DB commands.

## Types refresh

After `npm run types`, `lib/database-types.ts` will have:

- `push_tokens` Row/Insert/Update.
- `profiles.notification_prefs` typed as `Json`. We narrow with a `parseNotificationPrefs` helper in `useProfileStore` (mirroring `parseGameDefaults`).

## Client: `lib/notifications/`

New directory with three files. Public API is small.

### `lib/notifications/index.ts`

Re-exports the three things callers need:

```ts
export { ensurePermissionAndRegister } from './push'
export { resolveNotificationLink } from './links'
export {
	useNotificationPrefs,
	updateNotificationPrefs,
	DEFAULT_NOTIFICATION_PREFS,
	type NotificationPrefs,
} from './prefs'
```

### `lib/notifications/prefs.ts`

```ts
import type { Database } from '../database-types'

export type NotificationPrefs = {
	gameInvite: boolean
	yourTurn: boolean
	friendRequest: boolean
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
	gameInvite: true,
	yourTurn: true,
	friendRequest: true,
}

export function parseNotificationPrefs(raw: unknown): NotificationPrefs {
	if (!raw || typeof raw !== 'object') return DEFAULT_NOTIFICATION_PREFS
	const src = raw as Record<string, unknown>
	return {
		gameInvite:
			typeof src.gameInvite === 'boolean'
				? src.gameInvite
				: DEFAULT_NOTIFICATION_PREFS.gameInvite,
		yourTurn:
			typeof src.yourTurn === 'boolean'
				? src.yourTurn
				: DEFAULT_NOTIFICATION_PREFS.yourTurn,
		friendRequest:
			typeof src.friendRequest === 'boolean'
				? src.friendRequest
				: DEFAULT_NOTIFICATION_PREFS.friendRequest,
	}
}
```

The store action `updateNotificationPrefs(prefs)` lives in `useProfileStore` (next section), parallel to `updateGameDefaults`. There's no separate prefs hook — components read prefs via `useProfileStore((s) => parseNotificationPrefs(s.profile?.notification_prefs))`. `useNotificationPrefs` is a thin wrapper hook around exactly that, exported here so the import surface is clean.

### `lib/notifications/push.ts`

```ts
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { supabase } from '../supabase'

// Foreground delivery: let the OS banner render so we don't need an
// in-app toast component. No sound or badge.
Notifications.setNotificationHandler({
	handleNotification: async () => ({
		shouldShowBanner: true,
		shouldShowList: true,
		shouldPlaySound: false,
		shouldSetBadge: false,
	}),
})

// Tracked module-level so we don't ask twice in a single session.
let permissionAsked = false

/**
 * Idempotent. Asks for permission (once per session), reads the Expo push
 * token, and upserts it server-side. No-op on web, in simulators without
 * push support, or when the user denies. Safe to call on every (app) mount.
 */
export async function ensurePermissionAndRegister(
	userId: string
): Promise<void> {
	if (Platform.OS === 'web') return
	if (!Device.isDevice) return

	let status: Notifications.PermissionStatus = (
		await Notifications.getPermissionsAsync()
	).status

	if (status === 'undetermined' && !permissionAsked) {
		permissionAsked = true
		status = (await Notifications.requestPermissionsAsync()).status
	}
	if (status !== 'granted') return

	const projectId =
		Constants.expoConfig?.extra?.eas?.projectId ??
		Constants.easConfig?.projectId
	if (!projectId) return

	const tokenRes = await Notifications.getExpoPushTokenAsync({ projectId })
	const token = tokenRes.data
	if (!token) return

	const platform: 'ios' | 'android' =
		Platform.OS === 'ios' ? 'ios' : 'android'

	await supabase
		.from('push_tokens')
		.upsert(
			{
				token,
				user_id: userId,
				platform,
				updated_at: new Date().toISOString(),
			},
			{ onConflict: 'token' }
		)
}

/** Best-effort: delete this device's token row before sign-out. */
export async function deregisterCurrentToken(): Promise<void> {
	if (Platform.OS === 'web') return
	if (!Device.isDevice) return
	try {
		const projectId =
			Constants.expoConfig?.extra?.eas?.projectId ??
			Constants.easConfig?.projectId
		if (!projectId) return
		const { data } = await Notifications.getExpoPushTokenAsync({
			projectId,
		})
		if (!data) return
		await supabase.from('push_tokens').delete().eq('token', data)
	} catch {
		// Sign-out continues regardless.
	}
}
```

### `lib/notifications/links.ts`

```ts
import type { Href } from 'expo-router'

export type NotificationKind =
	| 'game_invite'
	| 'game_started'
	| 'your_turn'
	| 'discard_required'
	| 'trade_proposed'
	| 'friend_request'

export type NotificationData = {
	kind: NotificationKind
	game_id?: string
}

export function resolveNotificationLink(data: unknown): Href | null {
	if (!data || typeof data !== 'object') return null
	const d = data as NotificationData
	switch (d.kind) {
		case 'game_invite':
			return '/play'
		case 'game_started':
		case 'your_turn':
		case 'discard_required':
		case 'trade_proposed':
			return d.game_id ? (`/game/${d.game_id}` as Href) : '/play'
		case 'friend_request':
			return '/friends'
		default:
			return null
	}
}
```

## `useProfileStore` additions

Mirror `updateGameDefaults`:

- Re-export `notification_prefs` alongside `game_defaults` in `PROFILE_COLS` (it's a new column — supabase select gets it for free with `*`, but the file enumerates columns).
- New action: `updateNotificationPrefs(prefs: NotificationPrefs)` that calls `supabase.from('profiles').update({ notification_prefs: prefs })` and updates store state on success.
- Optional helper: `getNotificationPrefs()` returning `parseNotificationPrefs(profile?.notification_prefs)`. Probably nicer to inline in components — keep the store API small.

`PROFILE_COLS` is used in `useProfileStore`, `useFriendsStore`, and `useGamesStore`. All three need updating to include `notification_prefs`.

## Root layout & deep-link wiring

### `app/(app)/_layout.tsx`

After `loadAllUserStores(user.id)` succeeds:

```tsx
useEffect(() => {
	if (!user?.id) return
	ensurePermissionAndRegister(user.id)
}, [user?.id])

useEffect(() => {
	const sub = Notifications.addNotificationResponseReceivedListener(
		(resp) => {
			const link = resolveNotificationLink(
				resp.notification.request.content.data
			)
			if (link) router.push(link)
		}
	)
	// Cold-start case: the app was launched by tapping a notification.
	Notifications.getLastNotificationResponseAsync().then((resp) => {
		if (!resp) return
		const link = resolveNotificationLink(
			resp.notification.request.content.data
		)
		if (link) router.replace(link)
	})
	return () => sub.remove()
}, [router])
```

### `app/(app)/account.tsx` sign-out

Before `signOut()`:

```ts
await deregisterCurrentToken()
```

(Best-effort; never blocks sign-out.)

## Settings UI

New section inside `account.tsx`, between `Appearance` and the sign-out button. Skipped on `Platform.OS === 'web'`.

```tsx
<View style={styles.section}>
	<Text style={styles.sectionLabel}>Notifications</Text>
	<NotificationsSettings />
</View>
```

`NotificationsSettings` is a tiny in-file subcomponent (parallel to `ThemeSegmentControl`). Layout:

1. **Permission row.** Reads `Notifications.getPermissionsAsync()` on mount and on screen focus (`useFocusEffect`).
    - If `undetermined`: a row with label "Enable push notifications" and a primary "Enable" button → calls `ensurePermissionAndRegister(user.id)`.
    - If `denied`: a row labeled "Push notifications disabled" with a secondary "Open settings" button → `Linking.openSettings()`.
    - If `granted`: no extra row; the toggles below are active.

2. **Three toggle rows** (one per pref). Each row uses the existing `row` / `rowValue` style as the username row in `account.tsx`. On the right, a `Switch` from `react-native`. Tapping anywhere on the row toggles. Saves on toggle via `updateNotificationPrefs`. While saving, the row is disabled (cursor-default, lower opacity).

    Rows:
    - "Game invites" → `gameInvite`
    - "Your turn / game updates" → `yourTurn`
    - "Friend requests" → `friendRequest`

    If permission is not `granted`, toggles render but are visually disabled (opacity 0.5, no press response) — the user can still see their preferences but can't change them until they grant permission, since changes wouldn't take effect anyway.

The new subcomponent lives at the bottom of `account.tsx` per the existing base→leaves ordering convention.

## Friends path migration

### `lib/stores/useFriendsStore.ts`

Change `sendRequest`:

```ts
async sendRequest(meId, targetId) {
    const { data, error } = await supabase.functions.invoke('friends-service', {
        body: { action: 'send', target_id: targetId },
    })
    if (error || !data?.ok) {
        return { error: "Couldn't send request" }
    }
    return { error: null }
}
```

`meId` is still in the signature for store-internal convenience; the edge function reads the caller via JWT.

### `supabase/functions/friends-service/index.ts` (new)

Single action for now: `send`. Pattern matches `game-service`:

```ts
// friends-service: server-mediated mutations for the friends subsystem.
// Today: only `send` (insert a friend_requests row + queue a push). Grow this
// with new cases in the switch as more friend-side flows need server timing
// for notifications.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendNotifications } from '../_notify/index.ts'

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers':
		'authorization, x-client-info, apikey, content-type',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
	if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
	if (req.method !== 'POST') return json(405, { ok: false, error: 'method' })

	const auth = req.headers.get('Authorization')
	if (!auth) return json(401, { ok: false, error: 'no auth' })

	const anon = createClient(
		Deno.env.get('SUPABASE_URL')!,
		Deno.env.get('SUPABASE_ANON_KEY')!,
		{ global: { headers: { Authorization: auth } } }
	)
	const { data: userRes } = await anon.auth.getUser()
	const me = userRes?.user?.id
	if (!me) return json(401, { ok: false, error: 'unauthenticated' })

	const admin = createClient(
		Deno.env.get('SUPABASE_URL')!,
		Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
	)

	const body = await req.json().catch(() => null)
	if (!body || typeof body !== 'object')
		return json(400, { ok: false, error: 'bad body' })

	switch (body.action) {
		case 'send':
			return handleSend(admin, me, body.target_id)
		default:
			return json(400, { ok: false, error: 'unknown action' })
	}
})

async function handleSend(
	admin: SupabaseClient,
	me: string,
	targetId: unknown
) {
	if (typeof targetId !== 'string')
		return json(400, { ok: false, error: 'bad target' })
	if (targetId === me) return json(400, { ok: false, error: 'self' })

	// Insert. RLS doesn't apply (service role), so the 23505 path here is the
	// unordered-pair uniqueness index (catches pending or rejected duplicates).
	const { data, error } = await admin
		.from('friend_requests')
		.insert({ sender_id: me, receiver_id: targetId })
		.select('id')
		.single()
	if (error) {
		if (error.code === '23505') {
			return json(409, { ok: false, error: 'duplicate' })
		}
		return json(500, { ok: false, error: 'insert failed' })
	}

	// @ts-expect-error EdgeRuntime is a Deno global injected by Supabase.
	EdgeRuntime.waitUntil(
		sendNotifications(admin, [
			{
				userId: targetId,
				kind: 'friend_request',
				gate: 'friendRequest',
				senderProfileId: me,
			},
		])
	)

	return json(200, { ok: true, id: data.id })
}

function json(status: number, body: unknown) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...CORS, 'Content-Type': 'application/json' },
	})
}
```

(The `targetId` validity gets enforced by the foreign key — a bad uuid produces an insert error. Adding a separate profiles existence check is gold-plating.)

## Server: `supabase/functions/_notify/`

Shared helper module. Edge functions can import via the relative path (`../_notify/index.ts`). Deno's import resolution makes this straightforward.

### `_notify/index.ts`

```ts
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

type PrefKey = 'gameInvite' | 'yourTurn' | 'friendRequest'
type Kind =
	| 'game_invite'
	| 'game_started'
	| 'your_turn'
	| 'discard_required'
	| 'trade_proposed'
	| 'friend_request'

export type NotifyTarget = {
	userId: string
	kind: Kind
	gate: PrefKey
	senderProfileId?: string // used to fill in <sender>/<proposer> copy
	gameId?: string // included in deep-link payload
	firstPlayer?: boolean // game_started copy variant
}

/**
 * Resolves preferences + tokens, builds Expo Push messages, posts them in a
 * single request. Errors are logged but never thrown — push delivery is
 * fire-and-forget by design.
 */
export async function sendNotifications(
	admin: SupabaseClient,
	targets: NotifyTarget[]
): Promise<void> {
	if (targets.length === 0) return

	const userIds = Array.from(new Set(targets.map((t) => t.userId)))

	// 1. Load prefs + tokens in parallel.
	const [profilesRes, tokensRes, namesRes] = await Promise.all([
		admin
			.from('profiles')
			.select('id, notification_prefs')
			.in('id', userIds),
		admin
			.from('push_tokens')
			.select('user_id, token')
			.in('user_id', userIds),
		admin
			.from('profiles')
			.select('id, username')
			.in(
				'id',
				Array.from(
					new Set(
						targets
							.map((t) => t.senderProfileId)
							.filter(Boolean) as string[]
					)
				)
			),
	])

	if (profilesRes.error || tokensRes.error) {
		console.warn('[notify] load failed', profilesRes.error, tokensRes.error)
		return
	}

	const prefsById = new Map<string, Record<string, unknown>>()
	for (const row of profilesRes.data ?? []) {
		prefsById.set(
			row.id,
			(row.notification_prefs as Record<string, unknown>) ?? {}
		)
	}
	const tokensByUser = new Map<string, string[]>()
	for (const row of tokensRes.data ?? []) {
		const arr = tokensByUser.get(row.user_id) ?? []
		arr.push(row.token)
		tokensByUser.set(row.user_id, arr)
	}
	const usernameById = new Map<string, string>()
	for (const row of namesRes.data ?? []) {
		usernameById.set(row.id, row.username)
	}

	// 2. Build payloads.
	type ExpoMessage = {
		to: string
		title?: string
		body?: string
		data?: Record<string, unknown>
		sound?: 'default' | null
		priority?: 'default' | 'normal' | 'high'
	}
	const messages: ExpoMessage[] = []
	for (const t of targets) {
		const prefs = prefsById.get(t.userId) ?? {}
		if (prefs[t.gate] === false) continue // user opted out
		const tokens = tokensByUser.get(t.userId)
		if (!tokens || tokens.length === 0) continue
		const senderName = t.senderProfileId
			? (usernameById.get(t.senderProfileId) ?? 'Someone')
			: undefined
		const body = renderBody(t, senderName)
		const data: Record<string, unknown> = { kind: t.kind }
		if (t.gameId) data.game_id = t.gameId
		for (const token of tokens) {
			messages.push({
				to: token,
				title: 'Settled',
				body,
				data,
				priority: 'high',
			})
		}
	}
	if (messages.length === 0) return

	// 3. POST to Expo.
	try {
		await fetch(EXPO_PUSH_URL, {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Accept-Encoding': 'gzip, deflate',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(messages),
		})
	} catch (e) {
		console.warn('[notify] push send failed', e)
	}
}

function renderBody(t: NotifyTarget, sender: string | undefined): string {
	switch (t.kind) {
		case 'game_invite':
			return `${sender ?? 'Someone'} invited you to a game.`
		case 'game_started':
			return t.firstPlayer
				? "Game starting — you're up first."
				: 'Game starting.'
		case 'your_turn':
			return "It's your turn."
		case 'discard_required':
			return 'You rolled a 7 — discard cards.'
		case 'trade_proposed':
			return `${sender ?? 'Someone'} proposed a trade.`
		case 'friend_request':
			return `${sender ?? 'Someone'} sent you a friend request.`
	}
}
```

Notes:

- Expo Push accepts up to 100 messages per request; we're nowhere near that for any single trigger, so we don't bother chunking in v1.
- We don't inspect the Expo Push receipts (the 2-step receipt API). For v1 fire-and-forget is fine; stale tokens accumulate slowly and are addressed lazily next migration if it becomes a problem.

## Server: hooks in `game-service`

Six insertion points. All wrap their `sendNotifications` call in `EdgeRuntime.waitUntil(...)` and only fire after the DB writes succeed.

1. **`handleRespond`** (around line 2432, after the successful `game_started` path):

    ```ts
    EdgeRuntime.waitUntil(
    	sendNotifications(
    		admin,
    		participants.map((userId, i) => ({
    			userId,
    			kind: 'game_started',
    			gate: 'yourTurn',
    			gameId: inserted.id,
    			firstPlayer: playerOrder[0] === userId,
    		}))
    	)
    )
    ```

    No separate `your_turn` is fired — the first player's `game_started` body says "you're up first".

2. **`propose_game`** is a SQL RPC, not part of `game-service`. To send `game_invite` we have two options:
    - (a) Move `propose_game` into `game-service` as a new action.
    - (b) Add a trigger on `game_requests` that calls a tiny new edge function.

    **Pick (a).** It matches the existing convention; the SQL RPC is just a thin insert that's easy to port. The migration drops `public.propose_game`. The client `useGamesStore.createRequest` switches from `supabase.rpc('propose_game', ...)` to `supabase.functions.invoke('game-service', { body: { action: 'propose_game', ... } })`.

    After the insert, fan out `game_invite` to each invitee:

    ```ts
    EdgeRuntime.waitUntil(
    	sendNotifications(
    		admin,
    		invitedIds.map((userId) => ({
    			userId,
    			kind: 'game_invite',
    			gate: 'gameInvite',
    			senderProfileId: me,
    		}))
    	)
    )
    ```

3. **`handlePlaceRoad`** placement turn advance (around line 2705, after the `current_turn: next.currentTurn` update):

    ```ts
    const nextUserId = game.player_order[next.currentTurn]
    EdgeRuntime.waitUntil(
    	sendNotifications(admin, [
    		{
    			userId: nextUserId,
    			kind: 'your_turn',
    			gate: 'yourTurn',
    			gameId: game.id,
    		},
    	])
    )
    ```

    Placement-end transitions (when `next === null`) **do not** fire a separate push: that case enters either `post_placement` or `roll`, where the active player is still `current_turn = 0`. The `game_started` push already covered the first player.

4. **`handleRoll`** discard-phase entry (after the `nextPhase` is `kind: 'discard'`):

    ```ts
    const discardUserIds = Object.keys(pending).map(
    	(idxStr) => game.player_order[Number(idxStr)]
    )
    EdgeRuntime.waitUntil(
    	sendNotifications(
    		admin,
    		discardUserIds.map((userId) => ({
    			userId,
    			kind: 'discard_required',
    			gate: 'yourTurn',
    			gameId: game.id,
    		}))
    	)
    )
    ```

5. **`handleEndTurn`** (around line 3145, after `current_turn: nextTurn`):

    ```ts
    const nextUserId = game.player_order[nextTurn]
    EdgeRuntime.waitUntil(
    	sendNotifications(admin, [
    		{
    			userId: nextUserId,
    			kind: 'your_turn',
    			gate: 'yourTurn',
    			gameId: game.id,
    		},
    	])
    )
    ```

6. **`handleProposeTrade`** (around line 3861, after the trade is written):
    ```ts
    const toUserIds = to.map((idx) => game.player_order[idx])
    EdgeRuntime.waitUntil(
    	sendNotifications(
    		admin,
    		toUserIds.map((userId) => ({
    			userId,
    			kind: 'trade_proposed',
    			gate: 'yourTurn',
    			senderProfileId: me,
    			gameId: game.id,
    		}))
    	)
    )
    ```

## File layout

```
app/
  _layout.tsx              (no change — notification wiring lives at (app) layer)
  (app)/
    _layout.tsx            (ensurePermissionAndRegister + notification response listener)
    account.tsx            (new Notifications section + deregisterCurrentToken on sign-out)
lib/
  notifications/
    index.ts               (new — public re-exports)
    push.ts                (new — permission + token register/deregister + foreground handler)
    links.ts               (new — deep-link resolution)
    prefs.ts               (new — NotificationPrefs type + parser + defaults)
  stores/
    useProfileStore.ts     (add notification_prefs to PROFILE_COLS, updateNotificationPrefs)
    useFriendsStore.ts     (PROFILE_COLS update; sendRequest moves to friends-service)
    useGamesStore.ts       (PROFILE_COLS update; createRequest moves to game-service action)
supabase/
  functions/
    _notify/
      index.ts             (new — shared push fan-out)
    game-service/
      index.ts             (add propose_game action; 5 push insertion points)
    friends-service/
      index.ts             (new — send action)
  migrations/
    <ts>_notifications.sql (new)
```

## Verification checklist (phase 2 done when all green)

- [ ] Migration written; user runs `npm run migrate` then `npm run types`.
- [ ] `lib/database-types.ts` contains `push_tokens` and `profiles.notification_prefs`.
- [ ] `lib/notifications/*` files in place; `ensurePermissionAndRegister` called from `(app)/_layout.tsx`.
- [ ] First time entering `(app)` on a fresh install, the OS permission prompt appears. Allowing it inserts a row into `push_tokens`. Denying it leaves the table unchanged.
- [ ] Sign-out deletes this device's `push_tokens` row.
- [ ] Notifications settings section visible on iOS/Android, hidden on web. Toggles persist to `profiles.notification_prefs`. While the OS permission is `undetermined` or `denied`, the appropriate banner shows; toggles are visually disabled until permission is granted.
- [ ] `_notify/index.ts` deployed; `friends-service` deployed; `game-service` re-deployed.
- [ ] `game-service` has a `propose_game` action; `useGamesStore.createRequest` routes through it. SQL RPC `propose_game` dropped.
- [ ] Friend request push: user A sends a request to user B → user B receives a push on their device while the app is closed.
- [ ] Game invite push: A creates a game inviting B and C → B and C receive `game_invite`.
- [ ] Game start push: B and C both accept → all three (A, B, C) receive `game_started`. The first player_order entry's push reads "you're up first".
- [ ] Your-turn push: after a player ends turn, the next player_order user gets `your_turn` even if the app is closed.
- [ ] Discard push: on a 7 with multiple over-7 hands, each affected player gets `discard_required`.
- [ ] Trade push: trade proposed to two players → both receive `trade_proposed`. The proposer does not.
- [ ] Foreground delivery shows the system banner (no double-banner from a custom toast).
- [ ] Tap on a backgrounded `your_turn` notification opens `/game/<id>`. Tap on `friend_request` opens `/friends`. Tap on `game_invite` opens `/play`.
- [ ] Cold-start tap (app fully closed) opens the right route too via `getLastNotificationResponseAsync`.
- [ ] Toggling a pref off → server-side fan-out filters out that user's pushes for that kind.
- [ ] `npm run check` passes.
- [ ] `npm run format` run.

## Open questions (resolve before / during phase 2)

- **Username name source in `_notify`.** Currently I look up `senderProfileId` in `profiles` directly inside `sendNotifications`. If multiple triggers in a single call share the same sender, the existing in-call dedupe via `Set` covers it. Edge cases (deleted profile) fall back to "Someone". No action needed unless we see weirdness.

- **`updates.checkAutomatically: 'ON_LOAD'` interaction with cold-start notifications.** `app/_layout.tsx` runs an OTA update check before rendering `(app)`. If the user taps a notification and the cold start triggers an OTA reload, the `getLastNotificationResponseAsync` listener installed in the new bundle should still see the launch response (Expo persists it). Note for testing.
