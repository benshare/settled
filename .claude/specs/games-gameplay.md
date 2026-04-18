# Games — first pass at real gameplay

Turn the placeholder "games" feature (see `games.md`) into a minimal working dice game. The purpose of this pass is to stand up the moving parts we'll need for every future game: a backend game service, shared game state, realtime subscriptions, per-turn actions, and an end condition. The dice game itself is intentionally trivial.

## The game

- After every invited player accepts the invite, the game enters **setup** state for 3 seconds. During setup, a random player order is chosen. Then status flips to **active**.
- In active state, one player's turn is live at a time. Turn is tracked as an integer index into a `player_order uuid[]`. Everyone sees whose turn it is.
- When it is your turn, you tap **Roll**. Backend generates a random integer 1–6, adds it to your score, advances the turn, and appends a roll event to the game log.
- First player to reach a total score ≥ 10 ends the game. Status flips to **complete** and `winner` is set to that player's index.
- All players subscribe to the game row via a Supabase realtime channel. UI reflects score, whose turn it is, and a scrolling feed of action reports (e.g. "Alice rolled a 4"), derived from the events log.

## Scope

In scope:

- New `game-service` Supabase Edge Function with an `action` discriminator. Actions in this pass: `respond`, `roll`. (`finalize_setup` runs internally, not from clients.)
- Schema additions to `games`: `player_order uuid[]`, `current_turn int`, `scores int[]`, `winner int`, `events jsonb[]`, and `'setup'` as a valid status.
- `respond` action replaces the current `respond_to_game_request` SQL RPC. It updates the invited array, and when everyone has accepted, inserts the game row in `'setup'` state and kicks off the 3-second setup finalizer (background task inside the same function invocation).
- `roll` action reads current state, advances turn, appends events, and (if the roller hits ≥ 10) transitions to `'complete'`.
- Realtime subscription on the active/complete game detail screen: subscribes to the specific game row, updates local copy on every change, and renders new events as action reports.
- Updated game detail UI: setup state, active state (players in a circle, scores, Roll button on your turn), complete state (winner callout), and the action report feed.
- Removal of the "Mark complete" button — games end automatically.

Out of scope:

- A dedicated game-events table. Events live in `games.events jsonb[]`.
- Reconnect/backfill logic beyond what Supabase realtime gives us. If a client loses the channel, the next focus-load re-reads the row.
- Any game beyond this one dice game. The service is structured to grow; additional actions belong to follow-up specs.
- Moving `propose_game` or `complete_game` into the service (complete_game becomes unused and is removed; propose_game stays a SQL RPC for now).
- Presence / "player is online" indicators.
- Animations beyond the minimum needed to make setup → active feel intentional.

## Design decisions (locked in)

1. **All mutating game logic lives in one Edge Function `game-service`**, dispatched by an `action` field on the request body. This replaces the "RPC per operation" pattern for anything game-state-shaped. Per-game RLS remains read-only (party-only select); writes go through the function using the admin (service-role) client, which bypasses RLS. Keeping mutations in one function gives us a single place to evolve shared concerns like event logging and turn advancement.

2. **`respond` action is the only write path for game-request responses.** Clients call `supabase.functions.invoke('game-service', { body: { action: 'respond', request_id, accept } })` instead of the old RPC. The function authenticates the caller from the forwarded JWT, loads the request with the admin client, mutates it, and — if all invitees have now accepted — inserts the `games` row and schedules the setup finalizer as a background task (see decision 4). The old SQL function `respond_to_game_request` is dropped; `propose_game` and `complete_game` stay for now but `complete_game` becomes unused and is dropped too (see decision 11).

3. **Accept that materializes the game navigates the caller to the game screen.** `respond` returns `{ ok: true, game_id?: string }`. When `game_id` is present, the accepting client replaces the current route with `/game/<game_id>` instead of going back to Play. Other participants don't need routing — their Play/History "Active" sections already show the new game (via store reload on focus); tapping the row takes them to `/game/<id>` which renders whichever state (setup/active/complete) the row is in.

    **The accepting user's HTTP call returns as soon as the DB mutation is complete.** The 3-second setup delay happens inside the same function invocation, but in a background task using `EdgeRuntime.waitUntil(...)` so the caller isn't held open. The client doesn't block on setup; it navigates to the game screen, subscribes to realtime, and sees the `'setup' → 'active'` transition as it happens.

4. **Setup finalizer: `delay(3000)` then randomize.** Inside `EdgeRuntime.waitUntil`, the service imports `delay` from Deno std (`https://deno.land/std/async/delay.ts`) and waits 3 seconds. Then it re-reads the row (to confirm it's still in `'setup'`; idempotent guard), shuffles `participants` into `player_order`, initializes `scores` to a zero-filled array of the same length, sets `current_turn = 0`, appends a `setup_complete` event, and updates status to `'active'`. If the row is no longer `'setup'` (e.g. the function was invoked twice), it no-ops.

5. **`roll` action is the second game-service action.** It takes `{ action: 'roll', game_id }`. The function loads the row, verifies: caller is a participant, status is `'active'`, and `player_order[current_turn] === caller`. On any of those checks failing it returns 400. Otherwise it rolls 1–6 using `crypto.getRandomValues`, mutates `scores[current_turn] += roll`, appends a `roll` event, and then either flips to `'complete'` (if the new score ≥ 10, setting `winner = current_turn` and appending a `game_complete` event) or advances `current_turn = (current_turn + 1) % player_order.length`. Single update statement to keep it atomic.

6. **Parallel arrays for player state, not a jsonb map.** `player_order uuid[]` and `scores int[]` stay index-aligned for the life of the game. `current_turn` and `winner` are both integer indices into these arrays. Matches the user's preference and keeps the representation compact. A future feature that needs per-participant metadata (joined_at, last_move_at) is the moment we migrate to a `game_participants` table; this pass is not that moment.

7. **Events log is `events jsonb[]` on the games row**, appended via `events = events || array[...]::jsonb[]`. Each event is a tagged object. Kinds in this pass:
    - `{ kind: 'setup_complete', at: iso_timestamp }`
    - `{ kind: 'roll', player_index: int, value: int, new_score: int, at: iso_timestamp }`
    - `{ kind: 'game_complete', winner_index: int, at: iso_timestamp }`

    Clients render events by switching on `kind`. New kinds require only a renderer, no schema change. Keeping the log on the row means a single realtime channel (`postgres_changes` on that row) delivers both state and events — no second subscription needed.

8. **Status gains `'setup'` as a valid value.** `check (status in ('setup', 'active', 'complete'))`. New rows inserted via the respond action start as `'setup'` with `player_order=[]`, `scores=[]`, `current_turn=null`, `winner=null`, `events='{}'::jsonb[]`. The finalizer populates everything except `winner`. Columns are nullable where they don't apply yet: `current_turn` and `winner` are `int null`. `player_order` and `scores` are `not null default '{}'`.

9. **Realtime via `supabase.channel` + `postgres_changes` filter on `id=eq.<game_id>`.** Subscription lives in the game detail screen (`app/game/[id].tsx`). On every `UPDATE` payload, the screen replaces its local copy of the game with the new row. To compute "new events to surface as reports", it compares the length of the incoming `events` array to its previous length and takes the tail slice. This is simpler than tracking event ids and is safe because events are append-only.

    Channel teardown happens in the effect cleanup. One channel per screen mount; when the screen unmounts the channel is removed.

10. **Action-report feed is a bottom-docked list** with the most recent event at the bottom, auto-scrolling as events arrive. For this pass, keep it a plain scrolling `View` with the last N (say 20) events rendered; no fancy animations. We keep events on screen until the user leaves.

11. **"Mark complete" button is removed** from `app/game/[id].tsx`. Completion is now automatic when a player hits ≥ 10. The `complete_game` SQL RPC is dropped in the same migration. Store action `complete()` is removed.

12. **No changes to `propose_game` or `game_requests`.** Invite flow stays as-is. Only the response path changes (client calls edge function instead of SQL RPC). No schema change to `game_requests`.

13. **Store changes are additive.** `useGamesStore` keeps its shape but:
    - `Game` extends with the new columns via the regenerated `database-types.ts`.
    - `respond` action calls `supabase.functions.invoke('game-service', ...)` instead of `supabase.rpc('respond_to_game_request', ...)`. Same return shape.
    - `complete` action is removed.
    - A new (non-stored) helper, `rollDice(gameId)`, lives as a thin wrapper next to the store — or on the store if convenient — that invokes `game-service` with `action: 'roll'`. It does NOT reload the store on success; realtime delivers the update.
    - Setup/active/complete partitioning continues to work: `activeGames` now includes `'setup'` rows too (renamed conceptually to "in-progress" but the store field stays `activeGames` to minimize churn). Equivalent query: `.in('status', ['setup', 'active'])`. History's "Active" section continues to render this combined list.

14. **Randomness uses `crypto.getRandomValues`** in the edge function, not `Math.random`. This is already available in Deno and gives us a cryptographically seeded int in the 1–6 range via `(cryptoRandomUint32() % 6) + 1` with modulo-bias ignored for a 6-way split. Sufficient for this game.

15. **Game detail screen splits into three subtrees by status**: `setup` (spinner + "Starting soon…"), `active` (player circle + Roll button + event feed), `complete` (winner callout + final scores + event feed). One file, conditional rendering.

16. **Player circle layout.** Compute positions from the count: evenly-spaced angles around a circle of radius `R` centered in a fixed-height container. Each slot shows avatar + username + current score. The slot whose index equals `current_turn` gets a visible "your turn" style (border + accent color). Current user's own slot also carries a subtle "you" label. Implementation: absolute-positioned `View`s with computed `left`/`top` within a `relative` parent. No libraries.

17. **Roll button placement and gating.** Centered below the player circle. Enabled only when `status === 'active'` and `player_order[current_turn] === currentUserId`. Otherwise disabled with label like "Waiting for {username}…" or "Your turn!". On press, it calls the roll helper; the button briefly disables itself until the realtime update arrives (local `rolling` state flag cleared when the screen sees an events-length increase from a `roll` event it authored, or after a short timeout as a safety).

## Database migration

Single file: `supabase/migrations/<ts>_games_gameplay.sql`.

```sql
-- Add gameplay columns to games.
alter table public.games
    add column player_order uuid[] not null default '{}',
    add column current_turn int null,
    add column scores int[] not null default '{}',
    add column winner int null,
    add column events jsonb[] not null default '{}';

-- Expand status to include 'setup'.
alter table public.games drop constraint if exists games_status_check;
alter table public.games
    add constraint games_status_check
    check (status in ('setup', 'active', 'complete'));

-- Drop the old response RPC and the complete RPC — now handled by the edge function
-- (respond) or no longer needed (complete).
drop function if exists public.respond_to_game_request(uuid, boolean);
drop function if exists public.complete_game(uuid);
```

After writing, stop and show the user the full SQL. User runs `npm run migrate` then `npm run types`.

## Edge Function: `supabase/functions/game-service/index.ts`

### Shape

```ts
import { serve } from 'https://deno.land/std/http/server.ts'
import { delay } from 'https://deno.land/std/async/delay.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type Action =
	| { action: 'respond'; request_id: string; accept: boolean }
	| { action: 'roll'; game_id: string }
```

Entry: `serve(async (req) => { ... })`. Parse body, branch on `action`.

### Clients

- Admin client from `SUPABASE_SERVICE_ROLE_KEY` for all reads/writes.
- A second client initialized with the caller's `Authorization` header, used only to resolve `auth.uid()` via `getUser()`. Every action starts by authenticating the caller this way; if no user, return 401.

### `respond`

1. Authenticate caller; capture `me`.
2. Admin client: `select * from game_requests where id = ? ` — if missing, 404.
3. Find `me` in `invited[]`; if not present or already responded, 400.
4. Compute new `invited` array with `me`'s status set to `'accepted' | 'rejected'`.
5. If every invited entry is now `'accepted'`:
    - Build `participants = [proposer, ...invited[].user]` (preserve invited order).
    - Insert `games` row: `{ participants, status: 'setup' }`. Other gameplay columns take defaults.
    - Delete the `game_requests` row.
    - Schedule setup finalizer: `EdgeRuntime.waitUntil(finalizeSetup(newGameId))`.
    - Respond `{ ok: true, game_id: newGameId }`.
      Else:
    - Update `invited` on the request row.
    - Respond `{ ok: true }`.

### `finalizeSetup(game_id)`

1. `await delay(3000)`.
2. Admin select the game row; if `status !== 'setup'`, return (idempotent).
3. Shuffle `participants` (Fisher–Yates) into `player_order`.
4. `scores` = array of zeros, length `player_order.length`.
5. `events` = append `{ kind: 'setup_complete', at: new Date().toISOString() }`.
6. Update: `{ player_order, scores, current_turn: 0, events, status: 'active' }` where `id = game_id AND status = 'setup'` (guard against races).

### `roll`

1. Authenticate caller; capture `me`.
2. Admin select the game row; if missing, 404.
3. If `status !== 'active'`, 400 ('game not active').
4. If `player_order[current_turn] !== me`, 400 ('not your turn').
5. `roll = (new Uint32Array(crypto.getRandomValues(new Uint32Array(1)))[0] % 6) + 1`.
6. `newScores = [...scores]; newScores[current_turn] += roll`.
7. Append `{ kind: 'roll', player_index: current_turn, value: roll, new_score: newScores[current_turn], at: ... }` to events.
8. If `newScores[current_turn] >= 10`:
    - Append `{ kind: 'game_complete', winner_index: current_turn, at: ... }`.
    - Update: `{ scores: newScores, events, status: 'complete', winner: current_turn }`.
      Else:
    - `nextTurn = (current_turn + 1) % player_order.length`.
    - Update: `{ scores: newScores, events, current_turn: nextTurn }`.
9. Respond `{ ok: true }` (realtime carries the state change).

### Error shape

`{ ok: false, error: string }` with appropriate HTTP status (400, 401, 404). Store surfaces a generic "Couldn't ..." message to the user; no need to show raw error text.

## Store: `lib/stores/useGamesStore.ts` (diffs)

- `Game` type auto-updates from regenerated `database-types`.
- Change `respond` implementation body to:
    ```ts
    const { data, error } = await supabase.functions.invoke('game-service', {
    	body: { action: 'respond', request_id: requestId, accept },
    })
    if (error || !data?.ok) return { error: "Couldn't respond" }
    await get().loadForUser(meId)
    return { error: null }
    ```
- Remove `complete` action and its type entry.
- Add `rollDice(gameId: string): Promise<{ error: string | null }>`:
    ```ts
    const { data, error } = await supabase.functions.invoke('game-service', {
    	body: { action: 'roll', game_id: gameId },
    })
    if (error || !data?.ok) return { error: "Couldn't roll" }
    return { error: null }
    ```
    Does NOT reload the store — realtime delivers the update.
- Update the three parallel load queries so `activeGames` includes `'setup'` rows: `.in('status', ['setup', 'active'])`.

## UI

### `app/game/[id].tsx` (rewrite)

- Data source: `useGamesStore((s) => s.activeGames.concat(s.completeGames).find(g => g.id === id))`.
- On mount, subscribe to realtime:
    ```ts
    const channel = supabase
    	.channel(`game:${id}`)
    	.on(
    		'postgres_changes',
    		{
    			event: 'UPDATE',
    			schema: 'public',
    			table: 'games',
    			filter: `id=eq.${id}`,
    		},
    		(payload) => setLocalGame(payload.new)
    	)
    	.subscribe()
    return () => {
    	supabase.removeChannel(channel)
    }
    ```
    `localGame` is seeded from the store value and takes precedence when set. When `payload.new.events.length > prev.events.length`, slice the tail into an `events` render queue.
- Body:
    - `status === 'setup'`: centered "Starting soon…" text and a `Loader`.
    - `status === 'active'`: player circle (see decision 16) + Roll button (decision 17) + action report feed (decision 10).
    - `status === 'complete'`: winner callout (`"<username> won!"`), final scores list, action report feed.
- Back chevron stays in the header. No "Mark complete" button anywhere.

### Action report feed component

Inline subcomponent in `app/game/[id].tsx`. Takes `events: GameEvent[]` and `profilesById`. Renders the last 20 in order, each as a single line of text:

- `roll`: `"<username> rolled a <value> (<new_score>)"`
- `setup_complete`: `"Game started"`
- `game_complete`: `"<username> wins!"`

Rendered in a simple bordered box below the player circle / above the footer, with `textMuted` color and `sm` font. No timestamps for v1.

### Player circle component

Inline subcomponent in `app/game/[id].tsx` (extract to `lib/modules/` only if reused). Props: `playerOrder: string[]`, `scores: number[]`, `currentTurn: number | null`, `profilesById`, `meId`. Computes polar coordinates per slot and absolute-positions each slot around a center. Active-turn slot gets a highlighted border.

### `app/game/request/[id].tsx`

No UI changes beyond: the store's `respond` now hits the edge function instead of the RPC. The screen is unaware.

### Other screens

- `play.tsx` and `history.tsx`: no visible changes. "Active" continues to show `status in ('setup', 'active')` rows.

## File layout

```
supabase/
  migrations/
    <ts>_games_gameplay.sql                 (new)
  functions/
    game-service/
      index.ts                              (new)
lib/
  stores/
    useGamesStore.ts                        (edit: respond → invoke, drop complete, add rollDice, load filter)
app/
  game/
    [id].tsx                                (rewrite for setup/active/complete + realtime + roll + feed)
```

## Verification checklist (phase 2 done when all green)

- [ ] Migration adds `player_order`, `current_turn`, `scores`, `winner`, `events`; expands status; drops old RPCs. User ran `npm run migrate` then `npm run types`.
- [ ] `supabase/functions/game-service/index.ts` handles `respond` and `roll`, plus internal `finalizeSetup`. Authenticates via Authorization header; mutates via admin client.
- [ ] `respond` fully accepted → inserts games row in `'setup'` state, deletes request, schedules finalizer via `EdgeRuntime.waitUntil`.
- [ ] After 3 seconds the row flips to `'active'` with a shuffled `player_order`, zeroed `scores`, `current_turn = 0`, and a `setup_complete` event.
- [ ] `roll` enforces participant + status + turn checks. Rejects out-of-turn rolls with a 400.
- [ ] Score advance + turn advance are atomic (single update). Ending condition (`>= 10`) flips `status='complete'` and sets `winner` = the roller's index, also appends `game_complete` event.
- [ ] Realtime subscription on `app/game/[id].tsx` receives state + event updates. Action report feed shows new events as they arrive, in order.
- [ ] Roll button is disabled unless it is the current user's turn and status is `'active'`. All participants see whose turn it is.
- [ ] Game completes automatically at score ≥ 10; no manual complete button anywhere.
- [ ] `useGamesStore.respond` calls the edge function; `complete` is removed; `rollDice` added.
- [ ] Play / History screens unchanged in appearance; "Active" still shows setup + active rows.
- [ ] `npm run check` passes.
- [ ] `npm run format` run.
