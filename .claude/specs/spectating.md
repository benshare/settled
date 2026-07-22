# Spectating

Let a game be opened up to watchers. A spectator-enabled game becomes visible to
anyone who is friends with at least one of its players; they get a read-only
board with the action log, the chat, and nothing else.

Three pieces:

1. **Config** — an "Allow spectators" toggle on create-game, carried on
   `GameConfig` and denormalized onto `games` so RLS can read it.
2. **Discovery** — a "Watch" section on the Play tab listing spectatable games
   that include at least one friend.
3. **The spectator view** — `app/game/[id].tsx` in read-only mode, plus a
   watcher-presence indicator visible to everyone in the game.

---

## 1. Config

### `GameConfig.spectators: boolean`

Added to `lib/catan/types.ts`:

- `DEFAULT_CONFIG.spectators = true`. New games are watchable unless the
  creator turns it off.
- `parseGameConfig`: `typeof src.spectators === 'boolean' ? … : DEFAULT_CONFIG.spectators`
  — the usual defensive read.
- `summarizeGameConfig`: surfaces `'Spectators disabled'` when it differs from
  the default (i.e. when false).

`parseGameConfig`'s `true` default applies only to configs built in memory (the
create-game form). Every stored row carries the key: the migration that moved
`config` onto `games` pinned any row that lacked it to `false`, so a game that
never opted in is not watchable and its summary says so.

### Create-game UI

A `CompactToggleRow` in the "Game settings" `CollapsibleSection`, placed after
"Friendly robber":

- icon `eye`
- title `Allow spectators`
- description `Let friends of any player watch this game.`

Wired exactly like `honk` / `friendlyRobber`: local `useState` seeded from
`savedDefaults.settings.spectators`, included in the `currentDefaults` dirty
comparison, in the `config` object sent to `createRequest`, and in the saved
game-defaults payload. The server-side default on `profiles.game_defaults`
(migration `20260423130000_profile_game_defaults.sql` shape) gets the same key.

### `games.config`

`GameConfig` is immutable game metadata — written once when the game is created,
never mutated — so it lives on the `games` row beside `participants` and
`status`, not on the board-state row.

It started out on `game_states.config`, which forced a denormalized
`games.spectators` boolean: a policy on `games` cannot subquery `game_states`,
whose own select policy subqueries `games`, and PostgreSQL rejects that pair as
infinitely recursive. Migration `20260724120000_game_config_on_games.sql` moved
the column and dropped the boolean.

```sql
alter table public.games
    add column config jsonb not null default '{}'::jsonb;

create index games_spectators_status_idx
    on public.games (status) where (config ->> 'spectators')::boolean;
```

Both jsonb operators are immutable, so the partial index predicate is legal.

Written once, by `handleRespond` in `game-service`, which passes the request's
config through whole rather than re-deriving fields from it. That matters: while
the flag was denormalized it had to be copied field-by-field at insert time, and
a stale edge deploy silently dropped the copy — every game created in that
window had `config.spectators` true and the column false, so nothing was
watchable. One source of truth removes the failure mode rather than guarding it.

---

## 2. Access control (RLS)

### Definition of a spectator

`is_game_spectator(g public.games)` — inlined into each policy rather than a
function, to keep the planner honest:

```sql
g.spectators
and not (auth.uid() = any (g.participants))
and exists (
    select 1 from public.friends f
    where (f.user_id_a = auth.uid() and f.user_id_b = any (g.participants))
       or (f.user_id_b = auth.uid() and f.user_id_a = any (g.participants))
)
```

The `friends` subquery is itself under `friends_select_party`, which permits
exactly the rows where `auth.uid()` is a party — which is all this query asks
for, so the policy composes without needing `security definer`.

**Status is deliberately not part of the access rule.** A game that completes
while someone is watching must not yank the row out from under them mid-render;
the status filter lives in the _listing_ query instead (§3).

### Policies

Three new `for select` policies — additive, alongside the existing
participant policies (PostgreSQL ORs multiple permissive policies):

| table           | policy                           | rule                                                                                     |
| --------------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| `games`         | `games_select_spectator`         | the predicate above, on the row itself                                                   |
| `game_states`   | `game_states_select_spectator`   | `exists (select 1 from public.games g where g.id = game_states.game_id and <predicate>)` |
| `game_messages` | `game_messages_select_spectator` | same shape, on `game_messages.game_id`                                                   |

`game_chat_reads` needs nothing — it is already self-scoped
(`auth.uid() = user_id`), and a spectator writes only their own row.

### Hidden information

`game_states.players` carries every player's resources and dev cards in one
row. Participants can already read all of it; the privacy of a hand is a client
rendering convention, not a storage boundary. **Spectators inherit exactly that
posture** — no worse than a participant, no better. Making hands genuinely
private is a separate, much larger change (per-player projections or a
server-rendered view) and is explicitly out of scope here.

---

## 3. Discovery — the Play tab

### Store

`useGamesStore` gains `spectatableGames: Game[] | undefined`.

The existing active-games query already returns the new rows for free — with the
spectator policy in place, `select * from games where status in ('placement',
'active')` now returns both games I play in and games I may watch. Partition the
result client-side rather than issuing a second query:

```ts
const rows = activeRes.data ?? []
const activeGames = rows.filter((g) => g.participants.includes(userId))
const spectatableGames = rows.filter((g) => !g.participants.includes(userId))
```

- The completed-games query gets `.contains('participants', [userId])` added, so
  a spectator's `completeGames` (which backs the History tab) is unchanged —
  finished games they merely watched do not land in their history.
- Participant ids from `spectatableGames` are added to the `profilesById` fetch
  set alongside the existing ones.
- **Dev-profile filter**: in `!__DEV__` builds, drop any spectatable game with a
  participant whose profile has `dev === true`. This is a listing that surfaces
  people the viewer may never have met (a friend's co-players), so per the
  `lib/stores/CLAUDE.md` rule it filters. Games the viewer plays in are never
  filtered.
- `handleGameChange` (realtime) must route an INSERT/UPDATE into the right list
  by the same participant test, and drop a game from `spectatableGames` when its
  status leaves `placement`/`active`. The existing swap/remove/update branches
  are generalized to operate on whichever list holds the id.
- `clear()` resets `spectatableGames` to `undefined`.

### UI

A third section on `app/(app)/play.tsx`, below **Invites** and **Active**:

```
WATCH
[👁]  alice, bob, +2                    ›
```

- Heading `Watch`, same `sectionHeading` style.
- `SpectateRow`, structurally a copy of `GameRow` with the `eye-outline` icon
  in place of `game-controller-outline`. Names are every participant's username
  (never "me" — the viewer is not in the game). More than three participants
  collapse to `a, b, +N`.
- Sorted by `created_at` desc, like the other lists.
- The section renders only when non-empty. `showEmpty` is unchanged — an empty
  Watch list is not "no games yet".
- Tapping routes to `/game/{id}`, the same destination as a player's row.

---

## 4. The spectator view

### `isSpectator` in `gameContext`

`GameContextValue` gains `isSpectator: boolean`, derived from
`game.participants.includes(user.id)` — false while `game` is undefined. Every
consumer reads it from context rather than re-deriving, so the game screen and
the chat cannot disagree about who is watching.

`GameProvider`'s `storeGame` lookup also consults `spectatableGames` so a
spectator's first paint is seeded from the store rather than waiting on
`fetchGame`.

`meIdx` is already `-1` for a spectator (`player_order.indexOf` misses) — the
existing `meIdx >= 0` guards do most of the work. `selfVP` for a `-1` index is
never read: `displayVP` maps `i === meIdx` which no index satisfies, so a
spectator sees `publicVP` for everyone. Verify `publicVP`/`selfVP` computation
in `gameContext` does not index by a viewer seat (it does not today).

### What a spectator sees

Kept:

- `PlayerStrip` (with `meIdx={-1}` — no "you" highlight), including tapping a
  player for `PlayerDetailOverlay`, which is already public-info-only.
- The board itself, fully rendered, **non-interactive**: no vertex/edge/hex
  press handlers, no build-tool highlighting.
- `BoardLegend`, `ActionLog`, `ChatButton` / `ChatPanel`.
- The new watcher indicator (§5).
- `GameOverOverlay` when `status === 'complete'` — a spectator who is present
  at the end sees the recap. `FinalScoreButton` likewise.
- A top status line (`styles.statusWrap` / `styles.statusLine`) naming what the
  table is waiting on, since a spectator has no bottom bar to read it from:
    - placement: `Alice is placing a settlement`
    - bonus selection: `Players are choosing bonuses`
    - roll / main: `Alice's turn`
    - special build: `Bob is taking an extra build`
    - sub-phases (discard, robber, trades, all set-2/3 picks): `Waiting on Alice`

    This is a single helper, `spectatorStatus(game, gameState, profilesById)`, in
    `app/game/[id].tsx` next to `PlacementHeader`. It replaces
    `PlacementHeader` for spectators (that component is `meIdx`-aware and phrases
    everything relative to the viewer).

Removed entirely — every one of these is gated behind a new `!isSpectator` (in
addition to whatever gate it already has):

- `ResourceHand`, `DevCardHand`, `KnightTapBar`, and the whole bottom stack.
- `MainLoopBar`, `SpecialBuildBar`, `ConfirmBar`, the placement action bar,
  `TradePanel`, `TradeBanner`.
- `BonusSelection` / the bonus pane float.
- Every overlay and picker (`MagicianPickOverlay`, `ScoutPickOverlay`,
  `CurioPickOverlay`, `SpecialistDeclareOverlay`, `ForgerPickOverlay`,
  `AccountantPicker`, `MonopolyPicker`, `YearOfPlentyPicker`, `InvestPicker`,
  `ForgerMovePicker`, the haunt/fence placement flows, …). Their conditions all
  test membership in a pending list or `meIdx` equality, so a `-1` index already
  excludes a spectator — the explicit `!isSpectator` is belt-and-braces and
  documents intent.
- Honk: `canHonk` is called with `meIdx`; the button lives in `MainLoopBar` /
  `SpecialBuildBar`, both of which are gone. No server change needed —
  `handleHonk` already rejects a non-participant.
- The steal animation and other self-referential effects (`meIdx` guards).

The `!isSpectator` gates are added at the render sites, not by early-returning a
separate spectator component tree: the board, strip, log, and chat are the same
components with the same props, and forking them would guarantee drift.

### Notifications

A spectator gets no `your_turn` / `trade` pushes — the notification targets are
built from `player_order` server-side and a spectator is not in it. Nothing to
change.

---

## 5. Watcher presence

Ephemeral, via a Supabase Realtime **Presence** channel — no table, no
heartbeat writes, and it self-clears on disconnect, which is exactly the
semantics of "who is looking right now".

### Mechanism

In `gameContext`, a third channel alongside the `games` and `game_states` ones:

- topic `uniqueTopic(\`watchers:${gameId}\`)`, with
`config: { presence: { key: user.id } }`.
- **Everyone in the game joins** — players so they can see the count,
  spectators so they can too.
- **Only spectators `track()`.** A player subscribes and reads without
  tracking, so the count is watchers, not attendance.
- `presence` `sync` / `join` / `leave` events recompute
  `watcherIds: string[]` from `channel.presenceState()`, exposed on
  `GameContextValue`.
- Same realtime debts as the other two channels: `uniqueTopic`, torn down and
  re-created on `resyncNonce` (foreground), `track()` re-issued from the
  `SUBSCRIBED` status callback.

Presence is best-effort by construction. A dropped socket under-counts until the
next foreground; that is acceptable for a decorative indicator and is why this
is not a DB table.

### UI

A fourth floating button in the board container's button column, below
`ChatButton` — `top: spacing.sm + 3 * (32 + spacing.xs)`, matching the existing
`BUTTON_INSET` progression:

- `WatcherButton` in a new `lib/catan/Watchers.tsx`: an `eye` icon with a count
  badge styled like the chat unread badge. Hidden entirely when
  `watcherIds.length === 0`, so a game nobody is watching is visually unchanged.
- Tapping opens `WatcherList`, a plain centered `Modal` (`lib/modules/Modal`) —
  board-independent content, so per the `lib/catan/CLAUDE.md` overlay rule it
  does not need to be minimizable. Lists each watcher's `Avatar` + username,
  resolved from `profilesById`.
- Watcher profiles are not necessarily in `profilesById` (a friend-of-a-player
  the viewer has never met). `Watchers.tsx` fetches any missing ids on first
  render of the list, reusing the "fetch profiles we don't have" pattern in
  `useGamesStore`. Extract that into a store action
  `ensureProfiles(ids: string[])` and use it from both places rather than
  writing a second copy.

---

## 6. Chat

Spectators are full participants in the thread: they can read and send, and
their messages push the players.

### Server — `handleSendMessage`

Today: `if (!participants.includes(me)) return err(403, 'not a participant')`.

Becomes: participant **or** spectator. A new helper mirrors the RLS predicate on
the service role:

```ts
async function isSpectator(admin, game, me): Promise<boolean> {
	if (!game.spectators) return false
	if (game.participants.includes(me)) return false
	const { data } = await admin
		.from('friends')
		.select('user_id_a, user_id_b')
		.or(`user_id_a.eq.${me},user_id_b.eq.${me}`)
	const friendIds = new Set(
		(data ?? []).map((r) =>
			r.user_id_a === me ? r.user_id_b : r.user_id_a
		)
	)
	return game.participants.some((p) => friendIds.has(p))
}
```

The `select` on `games` in `handleSendMessage` widens to
`id, participants, spectators`.

### Server — `notifyChat`

Unchanged in shape: targets are still `participants` minus the sender minus
anyone currently reading. A spectator's message therefore pushes every player
who is not looking at the thread, which is the chosen behavior.

**Spectators receive no chat pushes.** They are not enumerable server-side
(presence is ephemeral and `game_chat_reads` rows would only cover spectators
who had already opened the panel once, and would then keep pushing them
indefinitely after they stopped watching). Watching is a foreground activity;
in-app realtime delivery covers it. Called out here so it reads as a decision
rather than an oversight.

### Client

- `ChatProvider` mounts for spectators unchanged. The read cursor / presence
  heartbeat writes work as-is under the self-scoped `game_chat_reads` policies.
  The unread badge works as-is.
- **Spectator messages are labeled.** No schema change: a sender is a spectator
  iff `!game.participants.includes(message.sender)`. `GameChat` takes the
  participant list (already available via `useGame()`) and renders a small
  `Watching` chip next to the sender name on the first message of a run — the
  same place the name is rendered, so grouped runs are labeled once.
- Sender profiles for spectators are fetched via the same
  `ensureProfiles(ids)` store action introduced in §5, so an unknown spectator
  does not render as `'Player'`.

---

## 7. Files touched

**Migrations** — `<ts>_spectating.sql` added the three spectator select policies
and updated the `profiles.game_defaults` default with `spectators: true`.
`20260724120000_game_config_on_games.sql` then moved `config` from
`game_states` to `games`, rebuilt the policies against `games.config`, and
dropped the `games.spectators` column it had needed.

**Rules / types**

- `lib/catan/types.ts` — `GameConfig.spectators`, `DEFAULT_CONFIG`,
  `parseGameConfig`, `summarizeGameConfig`.

**Edge function** — `supabase/functions/game-service/index.ts`

- `handleRespond`: write `spectators` onto the `games` insert from the config.
- `handleSendMessage`: participant-or-spectator authorization + the
  `isSpectator` helper.
- Config parse mirror (wherever `parseGameConfig`'s server copy lives).

**Stores**

- `lib/stores/useGamesStore.ts` — `spectatableGames`, the partition in
  `loadForUser`, `.contains('participants', …)` on the completed query,
  `handleGameChange` routing, `clear()`, and the new `ensureProfiles` action.

**UI**

- `app/(app)/create-game.tsx` — the toggle.
- `app/(app)/play.tsx` — the Watch section + `SpectateRow`.
- `lib/catan/gameContext.tsx` — `isSpectator`, `watcherIds`, the presence
  channel, `spectatableGames` in the store lookup.
- `app/game/[id].tsx` — the `!isSpectator` gates, `spectatorStatus`, the
  non-interactive board, `WatcherButton` mount.
- `lib/catan/Watchers.tsx` — new: `WatcherButton` + `WatcherList`.
- `lib/catan/GameChat.tsx` — the `Watching` chip + `ensureProfiles`.

**Docs** — `lib/catan/CLAUDE.md` (spectator view rules, presence channel,
`isSpectator` on the context), `lib/stores/CLAUDE.md` (the spectatable-games
partition and its dev-profile filter).

## 8. Verification

- `npm run migrate`, then `npm run types`, then `npm run edge`.
- `npm run check` and `npm run format`.
- The Catan check scripts are unaffected (no rules change), but
  `dev/check-catan-*.ts` still runs clean since `GameConfig` gained a
  defaulted field.
- Manual: two accounts that are friends, a third that is not. Friend sees the
  game under Watch and can open it; non-friend's Play tab and direct
  `/game/{id}` both come back empty. Spectator's board has no bottom bar, no
  taps, a live action log, and a working chat whose messages appear tagged to
  the players. The eye badge shows 1 to both players and the spectator.
