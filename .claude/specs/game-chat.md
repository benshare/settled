# Game chat

An in-game chat thread. A third floating button over the board opens a
translucent message panel covering the play area; sending a message pushes a
notification to the other players whose title is the **sender's username** and
whose body is the **message text**.

## Behaviour

While viewing a game, a chat button sits in the third floating slot at the
top-right of the board (below `BoardLegend` and `ActionLog`). It carries a
numeric unread badge. Tapping it opens the conversation:

- 90% opaque panel with a margin on all sides, so the board stays faintly
  visible behind it
- **contained within the play area** — it covers the board and the bottom
  action bars, but not the screen header, which stays visible and tappable
- newest-at-bottom message history, scrolled to the bottom on open
- a text input pinned to the bottom, above the keyboard
- tapping the scrim outside the panel closes it

Sending a message notifies every other participant, unless they currently have
the chat open. The thread stays fully open after the game completes — post-game
banter is the point.

## Decisions

| Question                         | Answer                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| Scope of a thread                | Per game, participants only. No DMs, no spectators.                                             |
| Unread indicator                 | Numeric count, from a server-side `last_read_at` per (game, user).                              |
| Suppress push when chat is open? | Yes — via a `last_read_at` heartbeat, not a presence channel.                                   |
| Notification gate                | New `chatMessage` pref, defaulted on, with its own toggle in the account Notifications section. |
| After the game completes         | Chat stays fully open; pushes keep firing.                                                      |
| Android notification icon        | **Out of scope.** Left as-is (see "Notification icon" below).                                   |
| Chat messages in the action log? | No. Separate table; `games.events` stays focused on committed game actions.                     |

### Notification icon

The user's requirement is "the notification should still have the Settled logo".

On **iOS this is automatic** — the OS always renders the app icon next to a
notification, and there is nothing to configure. Since the app is iOS-first
(`npm run build:native` targets iOS only), this requirement is already met.

On **Android** a notification needs a separate white-on-transparent silhouette,
and none exists (`assets/images/` has only `icon.png`, `favicon.png`,
`splash-icon.png`; `app.json` lists `expo-notifications` as a bare string plugin
with no `icon`/`color` config). Android therefore shows a generic default today
— for **every** notification kind, not just chat. Fixing that is a separate
asset+config task and is deliberately **not** part of this spec.

## Data model

One migration: `supabase/migrations/<ts>_game_chat.sql`.

### `game_messages`

```sql
create table public.game_messages (
    id uuid primary key default gen_random_uuid(),
    game_id uuid not null references public.games(id) on delete cascade,
    sender uuid not null references public.profiles(id) on delete cascade,
    body text not null check (char_length(body) between 1 and 500),
    created_at timestamptz not null default now()
);

create index game_messages_game_id_created_at_idx
    on public.game_messages (game_id, created_at);

alter table public.game_messages enable row level security;

-- Read: participants of the game only. Mirrors the game_states select policy.
create policy "game_messages_select_participant" on public.game_messages
    for select to authenticated
    using (
        exists (
            select 1 from public.games g
            where g.id = game_messages.game_id
              and auth.uid() = any (g.participants)
        )
    );

-- No insert/update/delete policies: writes go through game-service
-- (service role), per the edge-function convention.

alter publication supabase_realtime add table public.game_messages;
```

The 500-char cap is enforced in three places — the DB check, the edge function,
and `maxLength` on the input — so a bad client can't write an unbounded row.

### `game_chat_reads`

Doubles as the unread cursor **and** the "currently reading" presence signal.
One table, no realtime, no presence channel.

```sql
create table public.game_chat_reads (
    game_id uuid not null references public.games(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    last_read_at timestamptz not null default now(),
    primary key (game_id, user_id)
);

alter table public.game_chat_reads enable row level security;

create policy "game_chat_reads_select_self" on public.game_chat_reads
    for select to authenticated using (auth.uid() = user_id);

create policy "game_chat_reads_insert_self" on public.game_chat_reads
    for insert to authenticated with check (auth.uid() = user_id);

create policy "game_chat_reads_update_self" on public.game_chat_reads
    for update to authenticated
    using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

This is the one table the client writes to directly. It is deliberately not
routed through an edge function: the row is self-scoped, RLS-guarded, carries no
game rules, and the heartbeat would otherwise mean a function invocation every
15s per open panel.

### `notification_prefs`

```sql
update public.profiles
set notification_prefs = notification_prefs || jsonb_build_object('chatMessage', true);

alter table public.profiles
    alter column notification_prefs set default jsonb_build_object(
        'gameInvite', true,
        'yourTurn', true,
        'trade', true,
        'friendRequest', true,
        'chatMessage', true
    );
```

Existing rows are backfilled and the column default is widened. `parseNotificationPrefs`
already defaults a missing key to `true`, so the backfill is belt-and-braces
rather than load-bearing.

After writing the migration, **stop and show the user the full SQL.** The user
runs `npm run migrate`, then `npm run types`.

## Suppression + unread, precisely

`CHAT_PRESENCE_MS = 30_000` — shared constant, duplicated into the edge function
(same duplication rule as `lib/catan/`).

**Client heartbeat.** While the panel is open, `ChatProvider` upserts
`last_read_at = now()`:

- on open
- every 15s on an interval (half the presence window, so a heartbeat can be
  missed entirely without a false "away")
- on close

**Unread count** = messages with `created_at > last_read_at` and `sender !== me`.
Computed client-side from the already-loaded message list, so it needs no extra
query and updates the instant a realtime INSERT lands.

**Server suppression.** At send time the edge function loads `game_chat_reads`
for the game and drops any recipient whose `last_read_at` is newer than
`now - CHAT_PRESENCE_MS`. The sender is always dropped.

The failure modes are both benign and asymmetric in the right direction: a user
who force-quits with the panel open gets no push for up to 30s (they will see
the badge on return), and a user whose heartbeat is delayed gets one redundant
banner. Neither loses a message.

## Client

### `lib/catan/chatContext.tsx` (new)

A context provider, not prop-drilling, because two separate components need the
same subscribed data: the floating button needs the unread count, and the panel
needs the message list.

```ts
export type ChatMessage = {
	id: string
	game_id: string
	sender: string
	body: string
	created_at: string
}

type ChatValue = {
	messages: ChatMessage[] | undefined // undefined = loading (store convention)
	unreadCount: number
	open: boolean
	setOpen: (open: boolean) => void
	send: (body: string) => Promise<{ error: string | null }>
	sending: boolean
}

export function ChatProvider({
	gameId,
	children,
}: {
	gameId: string
	children: React.ReactNode
})
export function useChat(): ChatValue
```

Mounted inside `GameProvider` in `app/game/[id].tsx` so it sits above both
consumers.

It owes the **same realtime debt as every other subscriber** — see
`lib/stores/CLAUDE.md`, which is load-bearing here:

- name the channel with `uniqueTopic('game_chat')`, never a bare string
- `removeChannel` any existing channel before subscribing a new one
- refetch from the `subscribe()` status callback on `SUBSCRIBED`, closing the
  race between the initial fetch and the join
- refetch + re-subscribe from `useAppForeground` (via a `resyncNonce`, matching
  `gameContext.tsx`)
- a monotonic `seq` ref to discard out-of-order fetch responses
- never reset `messages` to `undefined` on a resync — a resync must not flash the
  panel into its loading state

Fetch: last 100 messages, `order('created_at', { ascending: false }).limit(100)`,
reversed for display. No pagination in v1 (see Out of scope). Realtime INSERTs
are appended, de-duplicated by `id` — the row may arrive from both the channel
and a refetch.

Sender profiles are **not** fetched here. `[id].tsx` already loads
`profilesById` for the participants, and chat is participants-only, so every
sender is already resolvable. The provider takes no profile dependency.

### `lib/catan/GameChat.tsx` (new)

Exports **two** components, mounted at different levels of the game screen —
`ChatButton` and `ChatPanel`. Both read `useChat()`, so splitting them costs no
prop-drilling. Follows the `ActionLog` file's conventions: static light `colors`
import (game chrome is theme-independent), `Ionicons`, `StyleSheet.create`.

**Floating button.** Third slot in the established stacking convention:

```ts
top: spacing.sm + 2 * (32 + spacing.xs),
right: spacing.sm,
width: 32, height: 32, borderRadius: 16, zIndex: 4,
```

Icon `chatbubble-outline`. When `unreadCount > 0`, an absolutely-positioned badge
sits on the top-right of the circle: min-width 16, `borderRadius: 8`, background
`colors.error`, white `font.xs` text, showing `unreadCount > 9 ? '9+' : count`.

Rendered as a sibling of `ActionLog` inside the board `Animated.View` in
`[id].tsx`, under the same `gameState && !inBonusSelection` gate.

**Panel.** An absolutely-positioned view (inset 0) mounted at the **play-area
root** — the `bodyRoot` `View` in `[id].tsx`, as its last child — **not** a
`Modal` and **not** inside the board container.

The mount point is the whole point of the design:

- inside the board container it would cover only the board, leaving the action
  bars sticking out below it
- as a `Modal` it would cover the entire screen including the header, which is
  what we explicitly don't want — the chat is contained within the play area

At `bodyRoot` it covers the board and the bars while leaving the screen header
visible and tappable. `zIndex: 10` puts it above the bars.

**Vertical anchor.** The panel's top edge lines up with the floating buttons,
i.e. `spacing.sm` inside the board container. But the panel is mounted a level
up, and the board container's offset within `bodyRoot` shifts with the
`PlayerStrip` and the placement header — so it can't be a constant. `[id].tsx`
measures it (`onLayout` on the board `Animated.View`, storing
`nativeEvent.layout.y` in `boardTop`) and passes it down as `topOffset`; the
panel renders at `topOffset + BUTTON_INSET`. `BUTTON_INSET` is the shared
`spacing.sm` that also positions slot 0, so the two can't drift.

The scrim has **no top padding** for the same reason — the panel's top edge *is*
the anchor line, and padding there would push it back below the buttons it is
meant to line up with. Horizontal and bottom margins stay at `spacing.md`.

```tsx
if (!open) return null

return (
	<Pressable style={styles.scrim} onPress={close}>
		<KeyboardAvoidingView
			behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
			style={styles.fill}
		>
			<Pressable style={styles.panel} onPress={() => {}}>
				{/* header / list / composer */}
			</Pressable>
		</KeyboardAvoidingView>
	</Pressable>
)
```

The inner `Pressable` with a no-op `onPress` is what swallows taps so they don't
reach the scrim — the same trick `ConfirmModal` and `PlayerDetailOverlay` use.

Styling notes, since this overlay deliberately departs from the usual modal look:

- `scrim`: `position: 'absolute'` inset 0, `padding: spacing.md` (the requested
  margin), `zIndex: 10`, and a **much lighter scrim than the usual
  `rgba(0,0,0,0.55)`** — `rgba(0,0,0,0.15)`. The panel itself is the translucent
  element; a heavy scrim on top of it would defeat seeing the board.
- `panel`: `flex: 1`, `borderRadius: radius.md`, `borderWidth: 1`,
  `borderColor: colors.border`, and `backgroundColor: PANEL_BG` — a module-level
  constant holding `colors.card` at **90%** alpha. Declared as an explicit
  constant with a comment rather than inlined, because the 0.9 is a product
  requirement and not an arbitrary style value.

Because this is no longer a `Modal`, it does **not** get `onRequestClose` — the
Android hardware back button won't close the panel. Consistent with the other
non-`Modal` overlays in `lib/catan/`, and moot on an iOS-first app.

`KeyboardAvoidingView` is required, not optional: the input is bottom-pinned and
would otherwise sit under the iOS keyboard.

**Message list.** An `inverted` `FlatList` over the reversed message array —
this gives newest-at-bottom, sticks to the bottom as messages arrive, and
avoids the manual `scrollToEnd` dance.

Each row:

- own messages: right-aligned, accent-tinted bubble, no name label
- others: left-aligned bubble, username label above in the sender's seat color
  (`playerColors[seatIndex]`, resolved through `player_order`, matching how
  `ActionLog` colors its dots)
- a relative timestamp is **not** shown in v1 (see Out of scope)

Empty state: "No messages yet." in `colors.textMuted`, matching `ActionLog`'s.

**Input row.** `TextInput` (`maxLength={500}`, `multiline`, `returnKeyType="send"`)
plus a send `Pressable`. Per the project's form convention the send affordance is
**disabled until the field is non-empty** — `body.trim().length > 0` — and uses
`cursor-default` styling when disabled, never a forbidden cursor. Focus ring /
outline is disabled, as elsewhere in the app.

On send: clear the input optimistically, call `send()`, and on failure restore
the text and surface the propagated error message inline (not a generic string)
— per the error-handling convention.

### `lib/stores/useGamesStore.ts`

Add the action, reusing the existing helper so the success path pings
`lib/gameSync.ts` like every other mutation:

```ts
async sendMessage(gameId: string, body: string) {
	return callGameService(
		{ action: 'send_message', game_id: gameId, body },
		"Couldn't send message"
	)
}
```

### `lib/notifications/prefs.ts`

Add `chatMessage: boolean` to `NotificationPrefs`, `true` to
`DEFAULT_NOTIFICATION_PREFS`, and the matching defensive branch in
`parseNotificationPrefs`.

### `lib/notifications/links.ts`

Add `'chat_message'` to `NotificationKind`. Route it to the game **with the chat
already open** — tapping a message notification should land you in the
conversation, not merely on the board:

```ts
case 'chat_message':
	return d.game_id ? (`/game/${d.game_id}?chat=1` as Href) : '/play'
```

`app/game/[id].tsx` reads `chat` off `useLocalSearchParams()` and opens the panel
on mount when it is `'1'`.

### `app/(app)/account.tsx`

A fourth row in the existing `NotificationsSettings` subcomponent, labeled
**"Chat messages"**, bound to `chatMessage`. No structural change — it follows
the same row/`Switch`/save-on-toggle pattern as the three existing toggles, and
inherits their disabled-when-permission-not-granted behaviour.

## Server

### `supabase/functions/_notify/index.ts`

Three changes.

1. `Kind` += `'chat_message'`; `PrefKey` += `'chatMessage'`.

2. **Per-target title.** `title` is currently hardcoded to `'Settled'` for every
   message. Chat is the first kind that needs the sender's name in the title, so
   add an opt-in field rather than a free-form string (the username is already
   resolved in `usernameById`, so a `titleOverride` string would force the caller
   into a duplicate lookup):

    ```ts
    export type NotifyTarget = {
    	// …existing fields
    	titleFrom?: 'app' | 'sender' // default 'app' → 'Settled'
    	bodyOverride?: string // used by chat_message to carry the message text
    }
    ```

    In the build loop:

    ```ts
    const title =
    	t.titleFrom === 'sender' ? (senderName ?? 'Settled') : 'Settled'
    const body = t.bodyOverride ?? renderBody(t, senderName)
    ```

    The `senderName ?? 'Settled'` fallback matters: a deleted or unreadable
    profile must not produce a notification titled `undefined`.

3. `renderBody` gets a `case 'chat_message'` returning `'Sent you a message.'`.
   It is unreachable in practice (chat always passes `bodyOverride`) but the
   switch is exhaustive over `Kind` and TypeScript will demand it.

**Body truncation.** `bodyOverride` is truncated to 150 chars with an ellipsis
before being sent. A 500-char message would otherwise be shipped in full to Expo
and silently clipped by the OS at an arbitrary point.

### `supabase/functions/game-service/index.ts`

New action in the dispatch switch. **No rules mirroring is needed** — chat
touches nothing in `lib/catan/`, so this is the rare game-service addition that
does not incur the duplicate-the-rules-layer debt.

```ts
type SendMessageBody = { action: 'send_message'; game_id: string; body: string }
```

`handleSendMessage(admin, me, body)`:

1. Validate `body.body` is a string; `trim()` it; reject empty or >500 chars
   (`400`).
2. Load the `games` row. Reject `404` if missing, `403` if
   `!participants.includes(me)`. **No status check** — chat stays open on
   completed games.
3. Insert into `game_messages`. Return `{ ok: true, id }`.
4. Queue the fan-out:

```ts
EdgeRuntime.waitUntil(notifyChat(admin, game, me, text))
```

`notifyChat` reads `game_chat_reads` for the game, builds the recipient list as
`participants` minus the sender minus anyone `last_read_at` within
`CHAT_PRESENCE_MS`, and calls `sendNotifications` with one target each:

```ts
{
	userId,
	kind: 'chat_message',
	gate: 'chatMessage',
	gameId: game.id,
	senderProfileId: me,
	titleFrom: 'sender',
	bodyOverride: text,
}
```

Deployed with `npm run edge`.

## Out of scope

- Direct messages / any chat outside a game.
- Pagination or infinite scroll beyond the most recent 100 messages.
- Editing, deleting, or reacting to messages.
- Typing indicators and read receipts (the presence signal exists, but is not
  surfaced in the UI).
- Attachments, images, emoji picker, link previews, rich text.
- Per-message timestamps in the UI.
- Moderation, muting an individual player, or reporting.
- The Android notification icon asset (see "Notification icon" above).
- Web push. Chat pushes are native-only, like every other kind — web users see
  messages live in-app via realtime.

## Verification

There are no pure rules to check, so this feature adds no `dev/check-*.ts`
script. It is verified by `npm run check` plus a manual pass:

1. Two accounts in one game; send both directions; both see messages live.
2. Badge increments for the recipient while the panel is closed, and clears on
   open.
3. Recipient with the panel open gets **no** push; with the app backgrounded gets
   one titled with the sender's username and bodied with the message text.
4. Toggling "Chat messages" off in account settings stops the pushes.
5. Tapping a chat notification cold-starts into that game with the panel open.
6. Background the app mid-conversation, send from the other account, foreground —
   the resync pulls the missed messages.
