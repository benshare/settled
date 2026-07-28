# Chat typing indicator

Show, inside an open chat panel, who else is currently composing a message: a
small bubble of animated dots preceded by the typers' avatars.

Builds directly on `.claude/specs/game-chat.md` — read that first for the panel's
geometry, the provider's realtime debts, and the read-cursor/presence
arrangement. This spec adds one ephemeral channel and one UI row; it touches no
table, no migration, and no edge function.

## 1. Behaviour

- While the chat panel is open, a typing row sits **pinned between the message
  list and the composer** (it does not scroll with the list).
- The row shows the avatars of everyone _else_ currently typing in this game,
  followed by a chat-bubble containing three dots that wave up and down.
- The viewer never sees themself in the row.
- When nobody else is typing, the row is absent entirely — no reserved height,
  no placeholder. The list grows back into the space.
- Spectators count. They can send into this thread, so they can be shown typing,
  with no seat colour and no `watching` tag (the row carries no text at all).
- Typers are identified by avatar only — no names, no "is typing…" copy.

### Who is "typing"

The viewer is typing when **all** of:

1. their chat panel is open, and
2. the composer's draft is non-empty (after trim), and
3. fewer than `TYPING_IDLE_MS` (4 s) have passed since their last keystroke.

They stop being typing the moment any of those stops holding — including on
send (which clears the draft), on close, on app background, and on leaving the
game screen.

The idle rule is deliberate: a half-typed draft abandoned mid-sentence would
otherwise pin the indicator on indefinitely. A keystroke after the idle timer
has fired starts typing again.

## 2. Transport: an ephemeral presence channel

`chat_typing:<gameId>`, a Supabase Presence channel keyed by user id — the same
shape as `watchers:<gameId>` in `gameContext.tsx`, and for the same reason:
**typing is state that must disappear when a client vanishes**, and presence is
the only mechanism here that cleans up after a dropped socket without a
server-side sweep. A broadcast-heartbeat scheme would need every client to
expire every other client on a timer, and would leave the indicator stuck for
one interval after a crash.

Rules, mirroring the existing presence block:

- Named with `uniqueTopic()` (`lib/realtime.ts`), never a bare string.
- Torn down and re-created on `resyncNonce` (the existing `useAppForeground`
  counter in `ChatProvider`) — the socket is closed while backgrounded and
  realtime replays nothing.
- `sync` / `join` / `leave` all recompute the roster from
  `channel.presenceState()`.
- `track()` is issued from the `SUBSCRIBED` status callback so it survives an
  automatic rejoin, exactly as `watchers` does.

### The channel is subscribed only while the panel is open

Unlike `watchers`, this channel is joined on open and left on close. The
indicator has no closed-panel surface (see §1), so a viewer with the panel shut
has nothing to do with the roster — and a game screen that idles with chat
closed shouldn't hold a fourth channel open. Closing therefore also implicitly
stops the viewer from being tracked.

Consequence, and it is fine: two people with chat closed do not see each other
type. Neither has a place to show it.

### track / untrack, not a payload flag

Presence is used as a set: a user in `presenceState()` _is_ typing. The viewer
calls `channel.track({})` when they start and `channel.untrack()` when they
stop, rather than tracking a `{ typing: boolean }` payload. Tracking everyone
who has chat open and filtering on a flag would mean a presence event on every
open/close for a state nobody reads.

`track`/`untrack` are only issued on a transition (the effect keys off a boolean
`typing`), so a fast typist emits at most one `track` per typing burst — not one
per keystroke.

## 3. Provider changes — `lib/catan/chatContext.tsx`

Two additions to `ChatContextValue`:

```ts
// User ids of everyone except the viewer currently typing in this game.
typingIds: string[]
// Called by the composer on every keystroke; a no-op once the panel is closed.
noteTyping: (draftNonEmpty: boolean) => void
```

Implementation notes:

- `typingIds` is derived from `presenceState()` with the viewer's own id
  filtered out, so the value handed to consumers is already "other people".
- `noteTyping(true)` sets a `typing` state true and (re)arms a
  `TYPING_IDLE_MS` timer that sets it false. `noteTyping(false)` clears the
  timer and sets it false immediately — an emptied composer stops typing at
  once rather than after the idle window.
- `typing` is forced false whenever `open` goes false, so a close can't leave a
  tracked presence behind.
- `send()` does not need its own hook: the composer clears the draft and calls
  `noteTyping(false)` in the same turn.
- Cleared on a `gameId` change alongside `messages` / `lastReadAt`.
- `TYPING_IDLE_MS` lives next to `CHAT_PRESENCE_MS`. It is unrelated to it —
  the read cursor's heartbeat is about notification suppression, this is about
  an animation — so the two are separate constants with separate comments.

## 4. UI — `lib/catan/GameChat.tsx`

### `TypingRow` (new local subcomponent)

Rendered by `ChatPanel` between `<ChatBody>` and the error line / `ChatComposer`.
Returns `null` when `typingIds` is empty.

Layout, left-aligned to match an incoming message row:

```
(◕)(◕)  ┌───────┐
        │ • • • │
        └───────┘
```

- **Avatars** — `Avatar` from `lib/modules/Avatar.tsx` at 20 px, overlapping by
  ~6 px (negative `marginLeft` on all but the first), capped at
  `MAX_TYPING_FACES = 3` with a `+N` chip beyond that. Same treatment
  `GameTitle.tsx` uses for its tab faces; the cap exists because the panel is
  narrow.
- **Bubble** — reuses the incoming-message `styles.bubble` (card background,
  border, `radius.md`, `shadow.bar`) so it reads as a message being composed,
  with tighter vertical padding since it holds dots rather than text.
- The row uses the same horizontal padding as `listBody` so the avatars line up
  with the message column, plus a small vertical padding of its own. No top
  border or divider — it is content, not chrome.

### Profiles

A typer may be a spectator whose profile was never in the participant cache, so
`TypingRow` (or `ChatPanel` alongside its existing message-sender pass) calls
`useGamesStore.ensureProfiles(typingIds)`. Without this every typer renders as
the `?` fallback avatar.

### The dot animation

Three dots, `4 px` diameter, `colors.textMuted`, `spacing.xs`-ish gap, each
driven by a reanimated `translateY` that loops up and down with a per-dot phase
offset so the group reads as a travelling wave rather than three synchronised
bounces.

- Reanimated 4 (`react-native-reanimated`, already a dependency and already used
  in this file for the keyboard lift).
- Per dot: `withDelay(index * STAGGER, withRepeat(withSequence(up, down), -1))`,
  ~`600 ms` per full cycle with `STAGGER ≈ 130 ms`, easing in/out, amplitude
  ~3 px.
- The animation is mounted only while the row is (i.e. while someone is
  typing), so there is no always-running timer behind a closed panel.
- Each dot is its own tiny component so the three shared values don't have to be
  built in a loop inside `TypingRow`'s body (hooks in a loop).

### The keyboard geometry is unaffected

The panel is a flex column whose list has `flex: 1`; adding a fixed-height row
above the composer shortens the list rather than the panel. The scrim
translate + `marginTop` shrink logic in `ChatPanel` is untouched.

## 5. Out of scope

- Any closed-panel surface for typing (no dot on the chat button, no floating
  preview).
- Names or "is typing…" text.
- A typing signal in push notifications.
- Persisting anything — no table, no migration, no edge-function change.
- Typing indicators anywhere outside per-game chat.

## 6. Files touched

| File                        | Change                                                                       |
| --------------------------- | ---------------------------------------------------------------------------- |
| `lib/catan/chatContext.tsx` | typing presence channel, `typingIds`, `noteTyping`, `TYPING_IDLE_MS`         |
| `lib/catan/GameChat.tsx`    | `TypingRow` + `WaveDot`, wired into `ChatPanel`; composer calls `noteTyping` |
| `lib/catan/CLAUDE.md`       | document the third channel and the new row                                   |
