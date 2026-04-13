# Games

Add a minimal games feature: a `games` table, a `game_requests` table, a create-game flow launched from the Play tab, two game detail views (pending and active), a pending-invite badge on the Play tab, and a History tab rewrite with Pending / Active / Complete sections.

This is intentionally a placeholder feature. There is no gameplay, scoring, turns, or chat — a game is just "a group of users who are playing together" and a completed game is just "... and now they're not". The architecture should leave room to grow each view later, but the v1 surface area is deliberately tiny.

## Scope

In scope:

- `games` table (`participants uuid[]`, `status text default 'active'`, `created_at`).
- `game_requests` table (`proposer uuid`, `invited jsonb[]` of `{user: uuid, status: 'pending' | 'accepted' | 'rejected'}`, `created_at`).
- RLS so each user only sees games / requests they're a party to.
- RPC `respond_to_game_request(request_id, accept)` that updates the current user's `invited[]` entry and, on full acceptance, inserts the `games` row atomically.
- RPC `complete_game(game_id)` that flips `status` to `'complete'` for a participant of the game.
- New zustand store `useGamesStore` (auto-loaded), holding `pendingRequests`, `activeGames`, `completeGames`, plus actions `createRequest`, `respond`, `complete`.
- Play tab: Create button top-right, a Pending-invites section, and an Active-games section. Each section renders only when non-empty.
- Play tab Ionicon gets a red dot when the user has any game_request where their `invited[]` entry is still `'pending'`.
- New `app/(app)/create-game.tsx` screen: friends list with a search bar to filter, multi-select, Create button that posts a game_request.
- New `app/game/[requestId].tsx` screen (pending game view): lists invited users with status, shows accept/reject if the current user is still pending AND no other user has rejected, otherwise info-only.
- New `app/game/[gameId].tsx` screen (active/complete game view): lists participants, Mark complete button for any participant if status is `'active'`. A completed game shows the same list with "Completed" instead of the button.
- History tab rewrite: three sections (Pending, Active, Complete), each shown only when non-empty. Each row: player usernames joined, plus `created_at` in a short readable format. Tapping navigates to the corresponding game view.

Out of scope:

- Any actual gameplay, turns, scores, moves.
- Editing a game request after it's proposed (cancelling, re-inviting).
- Removing or deleting complete games.
- Inviting non-friends. The create-game screen lists only the user's current friends.
- Realtime updates — screens re-fetch on focus, same as friends.
- Push notifications for invites.
- A "decline all" / bulk action.
- Pagination. For v1 we render everything.

## Design decisions (locked in)

1. **`games.participants` is a `uuid[]` array, no join table.** Enough for v1 since we never need to enforce FK integrity on participants (they're just profile ids we'll dereference client-side against the auto-loaded friends/profiles data). When the feature grows and we need per-participant metadata (score, turn, joined_at) we'll migrate to a `game_participants` join table.

2. **`games.status` is text with a CHECK constraint, not an enum.** We'll add `'active'` and `'complete'` now; an enum locks us into a migration dance every time we add a state. Use a simple `check (status in ('active', 'complete'))` that we can `alter` cheaply later.

3. **`game_requests.invited` is `jsonb` (an array of `{user, status}` objects).** Storing it as jsonb lets the entire state of a pending game live in one row with one round trip on both read and write. The trade-off is we can't FK-enforce user ids, but the proposer row has already validated them at insert time via the RPC and we're not letting arbitrary clients mutate the column directly.

4. **No status column on the game_requests row itself.** The "state" of a request is derived from its `invited[]` entries: all-`accepted` means it's time to create a game (done inside the RPC, so the row is deleted at that moment), any-`rejected` means the request is dead-but-visible. A `pending` request is one where every entry is still `'pending'` or `'accepted'` and nobody has rejected.

5. **Proposer is NOT in `invited[]`.** A separate `proposer uuid` column tracks them; they're implicitly accepted. When the last invited user accepts, the RPC creates the `games` row with `participants = [proposer, ...invited user ids]` and deletes the `game_requests` row. (The row being deleted on success is the simplest way to keep pending / active cleanly separated — there's no ambiguity about whether a request has been "converted".)

6. **Dead request = any invited user with `status='rejected'`.** Once that's true, the pending view still renders the request (spec: "once one player has rejected, remove the accept/reject option") but with an info-only state. The row is not deleted, so remaining users can still see who was invited and what happened. We accept that dead requests pile up forever in v1; cleanup is out of scope.

7. **Accept and reject both go through one RPC: `respond_to_game_request(request_id, accept boolean)`.** This keeps the "all accepted → create game" check atomic with the state mutation. Inside the function: load the row with `for update`, verify the current user is in `invited[]` with status `'pending'`, update their entry to `'accepted' | 'rejected'`, and if `accept = true` and every entry is now `'accepted'`, insert the `games` row + delete the request.

8. **`complete_game(game_id)` RPC**, mirroring the friends accept RPC. Any participant can call it; it verifies membership and that status is `'active'`, then sets status to `'complete'`. This could be a direct update with an RLS policy, but a function keeps the "who can complete" rule colocated with the "what state is legal" rule.

9. **Play badge = any request where the user's invited[] entry is still `'pending'` AND no one has rejected.** Rejected-but-alive requests don't badge (they're information, not action items). Derived client-side from `pendingRequests` in the store.

10. **One store, `useGamesStore`, auto-loaded.** It holds `pendingRequests` (with full invited state + proposer profile), `activeGames`, and `completeGames`. Load = three parallel queries. Follows the `useFriendsStore` pattern and registers in `lib/stores/index.ts`.

11. **Profile dereferencing.** We need usernames for every participant + every invited user across the three sections. The simplest working approach: on load, collect every user id referenced by any row, batch-fetch profiles in one query (`profiles.select().in('id', [...])`), and build a `profilesById` map in the store. Screens read from this map. Dev-flag filtering: we **do not** drop profiles that happen to be `dev = true`, because once a user is already a participant they're part of the user's real game history; hiding them would break the UI. Dev filtering only applies to the **create-game search**, which queries the friends list and filters client-side on `dev === false` in non-`__DEV__` builds. (Friends list is already dev-filtered at load, so reading from `useFriendsStore.friends` gives us correctness for free.)

12. **History and Play share the same underlying store data**, just different presentations. History renders pending/active/complete as rows; Play renders pending/active as sections with the Create button on top.

13. **Game detail routes live under `app/game/`**, not `app/(app)/game/`. They are full-screen views (back button top-left), not part of the tab bar. Matches the existing `app/send-request.tsx` pattern (sibling route outside the tab group). Use `app/game/request/[id].tsx` for pending view and `app/game/[id].tsx` for active/complete view to keep them unambiguous without needing disambiguation logic on the id.

14. **"Time created" formatting in History.** Use `toLocaleDateString()` with `{ month: 'short', day: 'numeric', year: 'numeric' }`. No time-of-day for v1 — it's noise for a placeholder history list. E.g., `"Apr 11, 2026"`.

15. **Participant list rendering.** Join usernames with commas, include the current user ("me, alice, bob"). Unknown user ids (profile missing) render as `"…"`. Truncate with `numberOfLines={1}` on the row.

## Database migration

Single file: `supabase/migrations/<ts>_games.sql`.

```sql
-- games: one row per game session
create table public.games (
    id uuid primary key default gen_random_uuid(),
    participants uuid[] not null,
    status text not null default 'active',
    created_at timestamptz not null default now(),
    check (status in ('active', 'complete')),
    check (array_length(participants, 1) >= 1)
);

create index games_participants_gin_idx
    on public.games using gin (participants);
create index games_status_idx
    on public.games (status);

alter table public.games enable row level security;

-- Party-only select: the current user must be in participants.
create policy "games_select_participant" on public.games
    for select to authenticated
    using (auth.uid() = any (participants));

-- No direct insert / update / delete from clients. All writes go through RPCs.

-- game_requests: a pending invitation to form a game
create table public.game_requests (
    id uuid primary key default gen_random_uuid(),
    proposer uuid not null references auth.users on delete cascade,
    invited jsonb not null,
    created_at timestamptz not null default now(),
    constraint game_requests_proposer_profiles_fkey
        foreign key (proposer) references public.profiles(id) on delete cascade,
    check (jsonb_typeof(invited) = 'array'),
    check (jsonb_array_length(invited) >= 1)
);

create index game_requests_proposer_idx on public.game_requests (proposer);

alter table public.game_requests enable row level security;

-- A user can see a request if they're the proposer or appear in invited[].user.
create policy "game_requests_select_party" on public.game_requests
    for select to authenticated
    using (
        auth.uid() = proposer
        or exists (
            select 1
            from jsonb_array_elements(invited) elem
            where (elem->>'user')::uuid = auth.uid()
        )
    );

-- No direct insert / update / delete from clients; all writes go through RPCs.

-- propose_game(invited_user_ids uuid[]): proposer inserts a new request
-- with invited[] = [{user, status: 'pending'}, ...].
create or replace function public.propose_game(invited_user_ids uuid[])
returns uuid
language plpgsql
security invoker
as $$
declare
    me uuid := auth.uid();
    inv jsonb;
    new_id uuid;
begin
    if me is null then
        raise exception 'not authenticated';
    end if;
    if invited_user_ids is null or array_length(invited_user_ids, 1) is null then
        raise exception 'must invite at least one user';
    end if;
    if me = any (invited_user_ids) then
        raise exception 'cannot invite yourself';
    end if;

    select coalesce(jsonb_agg(
        jsonb_build_object('user', u, 'status', 'pending')
    ), '[]'::jsonb)
    into inv
    from unnest(invited_user_ids) as u;

    insert into public.game_requests (proposer, invited)
    values (me, inv)
    returning id into new_id;

    return new_id;
end;
$$;

-- respond_to_game_request(request_id, accept)
-- Updates the current user's invited[] entry. If accept=true and every entry
-- is now 'accepted', insert the games row and delete the request.
create or replace function public.respond_to_game_request(
    request_id uuid,
    accept boolean
)
returns void
language plpgsql
security invoker
as $$
declare
    me uuid := auth.uid();
    r public.game_requests%rowtype;
    new_invited jsonb := '[]'::jsonb;
    elem jsonb;
    found_me boolean := false;
    all_accepted boolean := true;
    new_status text;
    participants uuid[];
    u uuid;
begin
    if me is null then
        raise exception 'not authenticated';
    end if;

    select * into r
    from public.game_requests
    where id = request_id
    for update;

    if not found then
        raise exception 'request not found';
    end if;

    new_status := case when accept then 'accepted' else 'rejected' end;

    for elem in select * from jsonb_array_elements(r.invited) loop
        if (elem->>'user')::uuid = me then
            if (elem->>'status') <> 'pending' then
                raise exception 'already responded';
            end if;
            found_me := true;
            new_invited := new_invited
                || jsonb_build_object('user', me, 'status', new_status);
        else
            new_invited := new_invited || elem;
            if (elem->>'status') <> 'accepted' then
                all_accepted := false;
            end if;
        end if;
    end loop;

    if not found_me then
        raise exception 'not invited';
    end if;

    if accept and all_accepted then
        -- Materialize the game.
        participants := array[r.proposer];
        for u in select (e->>'user')::uuid
                 from jsonb_array_elements(new_invited) e loop
            participants := array_append(participants, u);
        end loop;

        insert into public.games (participants) values (participants);
        delete from public.game_requests where id = request_id;
    else
        update public.game_requests
            set invited = new_invited
            where id = request_id;
    end if;
end;
$$;

-- complete_game(game_id): any participant can mark an active game complete.
create or replace function public.complete_game(game_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
    me uuid := auth.uid();
    g public.games%rowtype;
begin
    if me is null then
        raise exception 'not authenticated';
    end if;

    select * into g from public.games where id = game_id for update;
    if not found then
        raise exception 'game not found';
    end if;
    if not (me = any (g.participants)) then
        raise exception 'not a participant';
    end if;
    if g.status <> 'active' then
        raise exception 'game is not active';
    end if;

    update public.games set status = 'complete' where id = game_id;
end;
$$;
```

After writing the migration, stop and show the user the full SQL. User runs `npm run migrate` then `npm run types`.

## Types refresh

After `npm run types`, `lib/database-types.ts` will have:

- `games` Row/Insert/Update.
- `game_requests` Row/Insert/Update (with `invited` typed as `Json`).
- Functions: `propose_game`, `respond_to_game_request`, `complete_game`.

We'll define a local TS type for the decoded `invited` array in the store:

```ts
export type InvitedEntry = {
	user: string
	status: 'pending' | 'accepted' | 'rejected'
}
```

## State: `lib/stores/useGamesStore.ts`

### Shape

```ts
type Game = Database['public']['Tables']['games']['Row']
type GameRequestRow = Database['public']['Tables']['game_requests']['Row']

export type InvitedEntry = {
	user: string
	status: 'pending' | 'accepted' | 'rejected'
}

export type GameRequest = Omit<GameRequestRow, 'invited'> & {
	invited: InvitedEntry[]
}

type GamesStore = {
	pendingRequests: GameRequest[]
	activeGames: Game[]
	completeGames: Game[]
	profilesById: Record<string, Profile>
	loading: boolean

	loadForUser: (userId: string) => Promise<void>
	clear: () => void

	createRequest: (
		meId: string,
		invitedIds: string[]
	) => Promise<{ error: string | null }>
	respond: (
		meId: string,
		requestId: string,
		accept: boolean
	) => Promise<{ error: string | null }>
	complete: (
		meId: string,
		gameId: string
	) => Promise<{ error: string | null }>
}
```

### `loadForUser(userId)` implementation

Three parallel queries:

1. `pendingRequests`: `supabase.from('game_requests').select('*')`. RLS already filters to requests the user is party to.

2. `activeGames`: `supabase.from('games').select('*').eq('status', 'active').order('created_at', { ascending: false })`.

3. `completeGames`: `supabase.from('games').select('*').eq('status', 'complete').order('created_at', { ascending: false })`.

After those return, collect every distinct user id referenced:

- `proposer` from each request
- every `invited[i].user` from each request
- every id in `participants` across both game arrays

Then one more query: `supabase.from('profiles').select(PROFILE_COLS).in('id', allIds)`. Build `profilesById` into the store. Decode `invited` from `Json` to `InvitedEntry[]` when hydrating `pendingRequests`.

Sort `pendingRequests` by `created_at` descending so newest invites surface first.

On any error, log and set empty for that segment (same pattern as friends). Set `loading: false` at the end.

### `createRequest(meId, invitedIds)`

```ts
const { error } = await supabase.rpc('propose_game', {
	invited_user_ids: invitedIds,
})
if (error) return { error: "Couldn't create game" }
await get().loadForUser(meId)
return { error: null }
```

### `respond(meId, requestId, accept)`

```ts
const { error } = await supabase.rpc('respond_to_game_request', {
	request_id: requestId,
	accept,
})
if (error) return { error: "Couldn't respond" }
await get().loadForUser(meId)
return { error: null }
```

We reload for simplicity — on acceptance the request may have become a game, and both lists change.

### `complete(meId, gameId)`

```ts
const { error } = await supabase.rpc('complete_game', { game_id: gameId })
if (error) return { error: "Couldn't complete game" }
await get().loadForUser(meId)
return { error: null }
```

### `clear()`

Reset all four collections and `loading`.

### Registration

```ts
export const gamesStoreRegistration: AutoLoadedStore = {
	name: 'games',
	loadForUser: (userId) => useGamesStore.getState().loadForUser(userId),
	clear: () => useGamesStore.getState().clear(),
}
```

Register in `lib/stores/index.ts` alongside `friendsStoreRegistration`.

## UI

### `app/(app)/_layout.tsx` (changes)

- Add a `PlayTabIcon` subcomponent next to the existing `FriendsTabIcon` pattern.
- `PlayTabIcon` reads `useGamesStore((s) => s.pendingRequests)`, computes `showDot = pendingRequests.some(r => r.invited.find(i => i.user === meId)?.status === 'pending' && !r.invited.some(i => i.status === 'rejected'))`. Needs `useAuth().user?.id` for `meId`.
- Swap the current Play Tabs.Screen icon to use `PlayTabIcon` with `name="game-controller-outline"`.
- Add hidden sibling routes: `<Tabs.Screen name="create-game" options={{ href: null }} />`. The `app/game/*` routes live outside `(app)` entirely so they don't need hidden tab entries.

### `app/(app)/create-game.tsx` (new — hidden tab)

Styled like `send-request.tsx`:

- Back chevron + "Create game" title + right spacer.
- `Input` search bar with `placeholder="Search friends"`, `autoCapitalize="none"`, `autoCorrect={false}`. No autoFocus (user is browsing).
- Source data: `useFriendsStore((s) => s.friends)`. No network call; friends are already loaded in the store.
- Filter: if `query.trim().length === 0`, show all friends. Otherwise filter `friend.profile.username.toLowerCase().includes(query.trim().toLowerCase())`.
- Rows: avatar + username + a toggleable checkbox-style indicator on the right. Tapping the row toggles selection. Use a `Set<string>` of selected friend ids in local state.
- Empty friends list → render `"Add friends before starting a game."` hint, no input, no Create button.
- Bottom (sticky above the tab bar): a full-width `Button` "Create game". Disabled when `selected.size === 0`. On press: call `useGamesStore.getState().createRequest(user.id, Array.from(selected))`. On success, `router.replace('/play')` so the back-stack lands on Play. Show inline error text on failure.

### `app/(app)/play.tsx` (rewrite)

Layout inside `SafeAreaView` + `ScrollView`:

1. **Header row.** "Play" title on the left. Round "+" button on the right (same pattern as the Friends tab), Ionicons `"add-outline"`. On press: `router.push('/create-game')`.

2. **Pending-invites section** (only when `pendingRequests.length > 0`). Heading `"Invites"`. Each row:
    - Rendered as a `Pressable` that navigates to `/game/request/<id>`.
    - Left: avatar of the proposer.
    - Middle: one line `"<proposer_username> invited you"`.
    - Right: a chevron or no-op spacer.

3. **Active-games section** (only when `activeGames.length > 0`). Heading `"Active"`. Each row:
    - Rendered as a `Pressable` that navigates to `/game/<id>`.
    - Single line: comma-joined participant usernames (see design decision 15).

4. Empty state when both sections are empty: `"No games yet. Tap + to start one."`.

`useFocusEffect` re-runs `loadForUser(user.id)` on focus, same as friends.

### `app/(app)/history.tsx` (rewrite)

Inside `SafeAreaView` + `ScrollView`:

- Title "History" at top.
- Three sections, each rendered only when non-empty, in this order: **Pending**, **Active**, **Complete**.
- Pending rows and active rows are `Pressable`s routing to the corresponding detail view (`/game/request/<id>` and `/game/<id>`).
- Complete rows are currently non-interactive (no active game view for complete games — actually, the `/game/<id>` view handles both; complete rows also route there, which shows the participants + "Completed" label).
- Row layout for games (active & complete): usernames on top, `created_at` formatted short below in `colors.textMuted`, font `sm`.
- Row layout for pending requests: `"<proposer> invited you"` on top, `created_at` below.
- Empty state when all three sections are empty: `"No games yet."`.

### `app/game/request/[id].tsx` (new — pending game view, outside `(app)`)

Full-screen layout:

- Header with back chevron (`router.back()`) and title "Game invite".
- Body: a bordered card listing each row:
    - Proposer row first: avatar + username + `"Proposer"` label.
    - Then each `invited[i]`: avatar + username + status label (`Pending` / `Accepted` / `Rejected`).
- Under the card, if the current user is in `invited[]` with status `'pending'` AND no invited user has status `'rejected'`, show two buttons: **Accept** (primary) and **Reject** (secondary). Full-width stacked.
- If the user has already responded (accepted) OR someone else has rejected, show an info line instead ("Waiting for others" / "Someone declined, game cancelled" / "You accepted").
- On press, call `useGamesStore.getState().respond(user.id, id, accept)`. On error show inline text. On success the store reloads and either:
    - the request row disappears from the store and we `router.back()` immediately (use a ref to detect disappearance post-reload), OR
    - the row still exists (partial accept) and we stay on the screen with updated state.

    Simplest implementation: after a successful `respond` call, `router.back()` unconditionally. The Play tab's pending list will reflect the latest state when the user returns. If the user wants to re-open the pending view they tap the row again.

Data source: `useGamesStore((s) => s.pendingRequests.find(r => r.id === id))`. If not found (already completed into a game / reloaded), render a "This invite is no longer available" state with a back button.

### `app/game/[id].tsx` (new — active / complete game view, outside `(app)`)

Full-screen layout:

- Header with back chevron + "Game" title.
- Body: bordered card listing each participant (avatar + username). Current user labeled `"(you)"`.
- Footer:
    - If `status === 'active'`: full-width **Mark complete** button (primary). On press, `useGamesStore.getState().complete(user.id, id)`. On success, `router.back()`.
    - If `status === 'complete'`: info line `"Completed"` (no button).

Data source: `useGamesStore((s) => s.activeGames.concat(s.completeGames).find(g => g.id === id))`. If not found, "Game not found" + back button.

### `lib/modules/*` additions

No new shared components strictly required. Everything uses existing `Button`, `Input`, `Avatar`, `TabBarIcon`. If the selectable-friend row in create-game gets reused elsewhere later we'll extract it; for v1 keep it inline.

## File layout

```
app/
  (app)/
    _layout.tsx           (add PlayTabIcon, hidden create-game route)
    play.tsx              (rewrite)
    history.tsx           (rewrite)
    create-game.tsx       (new)
  game/
    _layout.tsx           (new — Stack layout, header hidden)
    [id].tsx              (new — active / complete game view)
    request/
      [id].tsx            (new — pending game view)
lib/
  stores/
    index.ts              (register gamesStoreRegistration)
    useGamesStore.ts      (new)
supabase/
  migrations/
    <ts>_games.sql        (new)
```

Note: `app/game/_layout.tsx` is a minimal Stack wrapper so the detail screens render without the tab bar. Alternative is making them modals — Stack is simpler and back-navigation is well-understood.

## Verification checklist (phase 2 done when all green)

- [ ] Migration file written and shown to user. User runs `npm run migrate` then `npm run types`.
- [ ] `lib/database-types.ts` contains `games`, `game_requests`, `propose_game`, `respond_to_game_request`, `complete_game`.
- [ ] `useGamesStore` exported from `lib/stores/useGamesStore.ts`; registered in `lib/stores/index.ts`.
- [ ] Play tab shows Create button top-right, Pending-invites and Active-games sections (non-empty-only), empty state otherwise. Red dot on the Play tab icon when the user has an unanswered live invite.
- [ ] History tab shows Pending / Active / Complete sections (non-empty-only), rows display usernames + created_at, taps route to the right detail view.
- [ ] `create-game.tsx` lists friends, filters by search, allows multi-select, Create button disabled unless ≥1 selected, error-path handled.
- [ ] `/game/request/[id]` pending view lists invited users with status, shows Accept/Reject only when legal, both buttons wired through `respond`.
- [ ] `/game/[id]` active view lists participants + Mark complete button for participants; complete games render the list with "Completed" label.
- [ ] Accepting the last pending user materializes a `games` row and deletes the request (verify by inspecting the DB after a full-accept flow).
- [ ] Any rejection freezes the request in an info-only state on the pending view; Play/History still list it.
- [ ] Dev filter: create-game search returns no `dev=true` profiles in production builds; participant lists for existing games render everyone regardless of dev flag (no hiding live game history).
- [ ] Sign-out clears `useGamesStore` along with the other auto-loaded stores.
- [ ] `npm run check` passes.
- [ ] `npm run format` run.
