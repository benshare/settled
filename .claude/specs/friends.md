# Friends

Add a friends system: two new tables (`friends`, `friend_requests`), a new `Friends` bottom-tab screen (third, after History), a send-request flow with username search, a manage-requests banner, and a dot indicator on the tab when there are pending incoming requests.

This feature also lands a small general-purpose **auto-loaded user stores** registry (see below) so that future social stores (e.g. presence, chat, notifications) drop in with zero plumbing.

## Scope

In scope:

- `friends` table with an alphabetized-pair uniqueness constraint.
- `friend_requests` table with status enum = pending | accepted | rejected.
- RLS policies so each user can only see/act on rows they're a party to.
- `useFriendsStore` (zustand) holding: friends list, incoming pending, outgoing pending, and actions for send/accept/reject/cancel/search.
- Auto-loaded user stores registry at `lib/stores/index.ts` + `lib/stores/CLAUDE.md` documenting how to add more.
- New `Friends` tab at `app/(app)/friends.tsx`, between History and Account.
- New `app/(app)/send-request.tsx` (sibling tab route with `href: null`) for searching users and sending requests.
- Manage-requests banner on the Friends screen (incoming + sent pending).
- Generalizable `TabBarIcon` component at `lib/modules/TabBarIcon.tsx` supporting an optional dot badge, used for the Friends tab.
- DB migration, types refresh.

Out of scope:

- Unfriend / remove friend (deferred).
- Blocking users.
- Notifications (push/email).
- Realtime subscriptions — re-fetch on screen focus.
- Mutual-friend counts, suggestions, contacts sync.
- Friend activity feed.

## Design decisions (locked in)

1. **Alphabetized pair for `friends`.** One row per friendship with `check (user_id_a < user_id_b)`. Primary key `(user_id_a, user_id_b)`. Insertion helper sorts the two IDs before insert. "Friends of X" requires `user_id_a = X or user_id_b = X` — acceptable.

2. **Three statuses only: `pending`, `accepted`, `rejected`.** Cancelling a pending request by the sender is a **hard delete** of the row (so a future re-send is a fresh insert, not an update). Rejection is a status flip and is **permanent**.

3. **Rejected is permanent and invisible to the rejected party.** Unordered-pair uniqueness on `friend_requests` means once any row exists for a pair, neither user can insert another — a rejected row blocks forever. Both users see the pair as "Pending" in search (hiding rejection from the rejected party). A `cancelled` request, being a hard delete, leaves no row behind, so a re-send works.

4. **Accept flow is a transactional RPC.** `public.accept_friend_request(request_id uuid)` flips the request to `accepted` and inserts the `friends` row atomically, so we can't end up in half-state on a client crash.

5. **Direct FKs from `friends` / `friend_requests` user-id columns to `profiles.id`**, in addition to the existing `auth.users` FKs. A foreign key is just a constraint — no new column. Two FKs can live on the same column because `profiles.id` itself references `auth.users.id`, so every valid `auth.users.id` that has a profile satisfies both. This unlocks PostgREST embedded selects like `.select('*, profiles!friends_user_id_a_profiles_fkey(*)')`, saving a round trip.

6. **Transition guard via trigger, not `with check`.** RLS update policy is permissive (either party); a `before update` trigger on `friend_requests` enforces legal transitions (`pending→accepted` by receiver, `pending→rejected` by receiver) and blocks anything else. Cancel is a separate delete path with its own RLS policy (sender only, row must be pending).

7. **Tab badge via a generalizable `TabBarIcon` component.** Not using `tabBarBadge` — custom wrapper gives us full styling control. Component accepts an Ionicons `name` plus an optional `showDot` boolean. Used for Friends in this feature; can be dropped into any other tab later.

8. **Auto-loaded user stores.** A small registry lets us say "these zustand stores should be populated when a user enters `(app)` and cleared on sign out". Implemented in `lib/stores/index.ts`; documented in `lib/stores/CLAUDE.md`. `useProfileStore` stays bespoke (loaded explicitly by `verify.tsx` / `set-username.tsx` because routing depends on it) — the registry is for stores whose load can be fire-and-forget once the user is inside the app.

9. **Search** is one profiles query + one batched relationship lookup; computes `none | pending | friends` per row client-side. Embedded selects across `friend_requests` + `profiles` reduce this further if needed (not required for correctness).

10. **Send-request screen is a sibling tab route with `href: null`.** Matches the pattern already used by hidden auth routes. Reached via `router.push('/send-request')`.

## Database migration

Single file: `supabase/migrations/<ts>_friends.sql`.

```sql
-- Enum for friend-request status
create type public.friend_request_status as enum (
    'pending',
    'accepted',
    'rejected'
);

-- friends: one row per friendship, with alphabetized user IDs
create table public.friends (
    user_id_a uuid not null references auth.users on delete cascade,
    user_id_b uuid not null references auth.users on delete cascade,
    time_added timestamptz not null default now(),
    primary key (user_id_a, user_id_b),
    check (user_id_a < user_id_b),
    -- Additional FKs to profiles(id) so PostgREST can embed profile rows.
    constraint friends_user_id_a_profiles_fkey
        foreign key (user_id_a) references public.profiles(id) on delete cascade,
    constraint friends_user_id_b_profiles_fkey
        foreign key (user_id_b) references public.profiles(id) on delete cascade
);

create index friends_user_id_b_idx on public.friends (user_id_b);

alter table public.friends enable row level security;

create policy "friends_select_party" on public.friends
    for select to authenticated
    using (auth.uid() = user_id_a or auth.uid() = user_id_b);

create policy "friends_insert_party" on public.friends
    for insert to authenticated
    with check (auth.uid() = user_id_a or auth.uid() = user_id_b);

-- No update policy (friendships are immutable).
-- Delete policy deferred to the unfriend feature.

-- friend_requests: directional, one-row-per-pair regardless of direction
create table public.friend_requests (
    id uuid primary key default gen_random_uuid(),
    sender_id uuid not null references auth.users on delete cascade,
    receiver_id uuid not null references auth.users on delete cascade,
    status public.friend_request_status not null default 'pending',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (sender_id <> receiver_id),
    constraint friend_requests_sender_profiles_fkey
        foreign key (sender_id) references public.profiles(id) on delete cascade,
    constraint friend_requests_receiver_profiles_fkey
        foreign key (receiver_id) references public.profiles(id) on delete cascade
);

-- Unordered-pair uniqueness: only one row per pair regardless of direction.
create unique index friend_requests_pair_idx
    on public.friend_requests (
        least(sender_id, receiver_id),
        greatest(sender_id, receiver_id)
    );

create index friend_requests_receiver_status_idx
    on public.friend_requests (receiver_id, status);
create index friend_requests_sender_status_idx
    on public.friend_requests (sender_id, status);

alter table public.friend_requests enable row level security;

create policy "friend_requests_select_party" on public.friend_requests
    for select to authenticated
    using (auth.uid() = sender_id or auth.uid() = receiver_id);

create policy "friend_requests_insert_sender" on public.friend_requests
    for insert to authenticated
    with check (auth.uid() = sender_id and status = 'pending');

-- Sender can delete their own pending row (= cancel).
create policy "friend_requests_delete_sender_pending" on public.friend_requests
    for delete to authenticated
    using (auth.uid() = sender_id and status = 'pending');

-- Updates: receiver flips pending -> accepted | rejected.
-- The trigger below enforces which transitions are allowed; the policy is just gatekeeping.
create policy "friend_requests_update_receiver" on public.friend_requests
    for update to authenticated
    using (auth.uid() = receiver_id)
    with check (auth.uid() = receiver_id);

-- Transition guard.
create or replace function public.enforce_friend_request_transition()
returns trigger language plpgsql as $$
begin
    if new.status = old.status
        and new.sender_id = old.sender_id
        and new.receiver_id = old.receiver_id then
        return new;
    end if;

    if old.status = 'pending'
        and new.status in ('accepted', 'rejected')
        and new.sender_id = old.sender_id
        and new.receiver_id = old.receiver_id then
        return new;
    end if;

    raise exception 'illegal friend_request transition % -> %', old.status, new.status;
end;
$$;

create trigger friend_requests_enforce_transition
before update on public.friend_requests
for each row execute function public.enforce_friend_request_transition();

-- Re-use the set_updated_at() function from the profiles migration.
create trigger friend_requests_set_updated_at
before update on public.friend_requests
for each row execute function public.set_updated_at();

-- Atomic accept: flip the request row to 'accepted' and insert the friends row.
create or replace function public.accept_friend_request(request_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
    r public.friend_requests%rowtype;
    a uuid;
    b uuid;
begin
    select * into r from public.friend_requests where id = request_id;
    if not found then
        raise exception 'request not found';
    end if;
    if r.receiver_id <> auth.uid() then
        raise exception 'not authorized';
    end if;
    if r.status <> 'pending' then
        raise exception 'request is not pending';
    end if;

    update public.friend_requests
        set status = 'accepted'
        where id = request_id;

    a := least(r.sender_id, r.receiver_id);
    b := greatest(r.sender_id, r.receiver_id);

    insert into public.friends (user_id_a, user_id_b)
        values (a, b)
        on conflict do nothing;
end;
$$;
```

Notes:

- The `set_updated_at()` function already exists (created in the profiles migration).
- Cancel = `supabase.from('friend_requests').delete().eq('id', id)`. The `friend_requests_delete_sender_pending` policy guards it.
- Reject = update status to `rejected`. Accept = RPC (never direct update).
- On `sendRequest`, if the pair has a rejected row, the insert fails 23505. The store maps all send errors to a generic message — the UI never exposes rejection.

**After writing the migration, stop and show the user the full SQL.** User runs `npm run migrate` then `npm run types`. Claude does not run destructive DB commands.

## Types refresh

After `npm run types`, `lib/database-types.ts` will have:

- `friends` Row/Insert/Update with the profiles FK relationships reflected in the `Relationships` field.
- `friend_requests` Row/Insert/Update with `status: Database['public']['Enums']['friend_request_status']`.
- `friend_request_status` in `Enums`.
- `accept_friend_request` under `Functions`.

## Auto-loaded user stores

### `lib/stores/index.ts` (new)

```ts
export type AutoLoadedStore = {
	name: string
	loadForUser: (userId: string) => Promise<void>
	clear: () => void
}

import { friendsStoreRegistration } from './useFriendsStore'

export const autoLoadedStores: AutoLoadedStore[] = [
	friendsStoreRegistration,
	// Add new auto-loaded stores here. See lib/stores/CLAUDE.md.
]

export async function loadAllUserStores(userId: string): Promise<void> {
	await Promise.all(
		autoLoadedStores.map((s) =>
			s.loadForUser(userId).catch((err) => {
				console.warn(`[stores] ${s.name} loadForUser failed`, err)
			})
		)
	)
}

export function clearAllUserStores(): void {
	autoLoadedStores.forEach((s) => s.clear())
}
```

Errors in a single store's load don't block the others — we log and continue.

### `lib/stores/CLAUDE.md` (new)

Short doc (kept concise per the global CLAUDE.md rule):

````md
# Stores

Two kinds of stores live here.

## 1. Bespoke stores

Loaded by the screens that need them. `useProfileStore` is the only one today. It's outside the auto-load registry because routing (`verify.tsx`, `set-username.tsx`) depends on its load completing at specific moments.

## 2. Auto-loaded user stores

Registered in `index.ts`. Loaded once when a user enters `(app)`, cleared on sign out. Use this for any store whose data is scoped to a signed-in user and whose load can be fire-and-forget (failure is non-fatal — the screen using the data is responsible for its own empty/loading state).

### Adding an auto-loaded store

1. Create `useMyStore.ts` with a zustand store. Give it a `loadForUser(userId)` action and a `clear()` action.
2. In the same file, export a registration object:
    ```ts
    import type { AutoLoadedStore } from './index'
    export const myStoreRegistration: AutoLoadedStore = {
    	name: 'my',
    	loadForUser: (userId) => useMyStore.getState().loadForUser(userId),
    	clear: () => useMyStore.getState().clear(),
    }
    ```
````

3. Import and add it to `autoLoadedStores` in `index.ts`.

That's it — `app/(app)/_layout.tsx` calls `loadAllUserStores(user.id)` on mount, and `account.tsx` calls `clearAllUserStores()` on sign out.

````

### Wiring

- `app/(app)/_layout.tsx`: inside the `AppLayout` component, `useEffect` dependent on `user?.id`. When it changes to a truthy value, call `loadAllUserStores(user.id)`.
- `app/(app)/account.tsx` `handleSignOut`: after `clearProfile()`, call `clearAllUserStores()`.

## State: `lib/stores/useFriendsStore.ts`

```ts
import { create } from 'zustand'
import type { AutoLoadedStore } from './index'
import type { Profile } from './useProfileStore'
import type { Database } from '../database-types'
import { supabase } from '../supabase'

type FriendRequest = Database['public']['Tables']['friend_requests']['Row']

export type FriendEntry = {
    otherId: string
    profile: Profile
    time_added: string
}

export type IncomingRequest = {
    request: FriendRequest
    profile: Profile // sender's profile
}

export type OutgoingRequest = {
    request: FriendRequest
    profile: Profile // receiver's profile
}

export type SearchRelationship = 'none' | 'pending' | 'friends'

export type SearchResult = {
    profile: Profile
    relationship: SearchRelationship
}

type FriendsStore = {
    friends: FriendEntry[]
    pendingIncoming: IncomingRequest[]
    pendingOutgoing: OutgoingRequest[]
    loading: boolean

    loadForUser: (userId: string) => Promise<void>
    clear: () => void

    sendRequest: (
        meId: string,
        targetId: string
    ) => Promise<{ error: string | null }>
    cancelRequest: (requestId: string) => Promise<{ error: string | null }>
    acceptRequest: (requestId: string) => Promise<{ error: string | null }>
    rejectRequest: (requestId: string) => Promise<{ error: string | null }>

    search: (meId: string, query: string) => Promise<SearchResult[]>
}

export const useFriendsStore = create<FriendsStore>((set, get) => ({
    // ...implementation below
}))

export const friendsStoreRegistration: AutoLoadedStore = {
    name: 'friends',
    loadForUser: (userId) => useFriendsStore.getState().loadForUser(userId),
    clear: () => useFriendsStore.getState().clear(),
}
````

### `loadForUser(userId)` implementation

Three parallel queries (via `Promise.all`), each using embedded selects on profiles:

1. `friends`:

    ```ts
    supabase
    	.from('friends')
    	.select(
    		`
        user_id_a,
        user_id_b,
        time_added,
        a:profiles!friends_user_id_a_profiles_fkey(id, username, avatar_path, created_at, updated_at),
        b:profiles!friends_user_id_b_profiles_fkey(id, username, avatar_path, created_at, updated_at)
      `
    	)
    	.or(`user_id_a.eq.${userId},user_id_b.eq.${userId}`)
    ```

    Map to `FriendEntry[]` by picking the non-me profile.

2. `pendingIncoming`:

    ```ts
    supabase
    	.from('friend_requests')
    	.select('*, sender:profiles!friend_requests_sender_profiles_fkey(*)')
    	.eq('receiver_id', userId)
    	.eq('status', 'pending')
    ```

3. `pendingOutgoing`:
    ```ts
    supabase
    	.from('friend_requests')
    	.select(
    		'*, receiver:profiles!friend_requests_receiver_profiles_fkey(*)'
    	)
    	.eq('sender_id', userId)
    	.eq('status', 'pending')
    ```

On any error, log and set empty; the screens show the empty state. Sets `loading: false` at the end.

### `sendRequest(meId, targetId)`

```ts
const { error } = await supabase
	.from('friend_requests')
	.insert({ sender_id: meId, receiver_id: targetId })
```

On success, re-run `loadForUser(meId)` (simplest) — pendingOutgoing now has the new row. On any error (including 23505 from a rejected or already-pending pair) return a generic error. The UI never distinguishes cases.

### `cancelRequest(requestId)`

```ts
supabase.from('friend_requests').delete().eq('id', requestId)
```

On success, optimistically filter the row out of `pendingOutgoing`.

### `acceptRequest(requestId)`

```ts
supabase.rpc('accept_friend_request', { request_id: requestId })
```

On success, re-run `loadForUser(meId)` (the friends list changed, the banner changed — easier than maintaining both deltas). Pass meId via a closure or re-use `supabase.auth.getSession()` inside the store. Simplest: the screen passes `meId` through — adjust the signature to `acceptRequest(meId, requestId)`. Same for `rejectRequest`.

### `rejectRequest(meId, requestId)`

```ts
supabase
	.from('friend_requests')
	.update({ status: 'rejected' })
	.eq('id', requestId)
```

On success, optimistically filter the row out of `pendingIncoming`.

### `search(meId, query)`

Return type `SearchResult[]`; does not write to the store.

```ts
// 1. Profile search
const { data: profiles } = await supabase
	.from('profiles')
	.select('id, username, avatar_path, created_at, updated_at')
	.ilike('username', `${query}%`)
	.neq('id', meId)
	.order('username', { ascending: true })
	.limit(20)

if (!profiles || profiles.length === 0) return []
const ids = profiles.map((p) => p.id)

// 2. Any friendships containing me + one of these ids
const { data: friendRows } = await supabase
	.from('friends')
	.select('user_id_a, user_id_b')
	.or(
		`and(user_id_a.eq.${meId},user_id_b.in.(${ids.join(',')})),` +
			`and(user_id_b.eq.${meId},user_id_a.in.(${ids.join(',')}))`
	)

// 3. Any friend_requests between me and one of these ids, any status
const { data: reqRows } = await supabase
	.from('friend_requests')
	.select('sender_id, receiver_id, status')
	.or(
		`and(sender_id.eq.${meId},receiver_id.in.(${ids.join(',')})),` +
			`and(receiver_id.eq.${meId},sender_id.in.(${ids.join(',')}))`
	)

// 4. Compute relationship per profile
const friendIds = new Set<string>()
for (const f of friendRows ?? []) {
	friendIds.add(f.user_id_a === meId ? f.user_id_b : f.user_id_a)
}
const requestIds = new Set<string>()
for (const r of reqRows ?? []) {
	// Any row (pending OR rejected) counts as 'pending' in the UI per spec.
	requestIds.add(r.sender_id === meId ? r.receiver_id : r.sender_id)
}

return profiles.map((profile) => ({
	profile,
	relationship: friendIds.has(profile.id)
		? 'friends'
		: requestIds.has(profile.id)
			? 'pending'
			: 'none',
}))
```

### `clear()`

Reset friends, pendingIncoming, pendingOutgoing to empty arrays, loading to false.

## UI

### `lib/modules/TabBarIcon.tsx` (new — generalizable)

```tsx
import { Ionicons } from '@expo/vector-icons'
import { StyleSheet, View } from 'react-native'
import { colors } from '../theme'

interface TabBarIconProps {
	name: React.ComponentProps<typeof Ionicons>['name']
	color: string
	size: number
	showDot?: boolean
}

export function TabBarIcon({ name, color, size, showDot }: TabBarIconProps) {
	return (
		<View>
			<Ionicons name={name} color={color} size={size} />
			{showDot && <View style={styles.dot} />}
		</View>
	)
}

const styles = StyleSheet.create({
	dot: {
		position: 'absolute',
		top: -1,
		right: -3,
		width: 9,
		height: 9,
		borderRadius: 999,
		backgroundColor: colors.error, // red
		borderWidth: 1.5,
		borderColor: colors.background,
	},
})
```

Every tab can be migrated to this helper — this feature only switches Friends over, the others keep their inline `Ionicons` until they need a badge.

### `app/(app)/_layout.tsx` (changes)

- Import `TabBarIcon`, `useFriendsStore`, `useAuth`, `loadAllUserStores`.
- `useEffect` on `user?.id`: when it becomes truthy, call `loadAllUserStores(user.id)`.
- Add the Friends tab between History and Account:
    ```tsx
    <Tabs.Screen
    	name="friends"
    	options={{
    		title: 'Friends',
    		tabBarIcon: ({ color, size }) => (
    			<FriendsTabIcon color={color} size={size} />
    		),
    	}}
    />
    ```
    where `FriendsTabIcon` is a tiny in-file subcomponent:
    ```tsx
    function FriendsTabIcon({ color, size }: { color: string; size: number }) {
    	const incomingCount = useFriendsStore((s) => s.pendingIncoming.length)
    	return (
    		<TabBarIcon
    			name="people-outline"
    			color={color}
    			size={size}
    			showDot={incomingCount > 0}
    		/>
    	)
    }
    ```
- Add a hidden send-request route:
    ```tsx
    <Tabs.Screen name="send-request" options={{ href: null }} />
    ```

### `app/(app)/friends.tsx` (new)

Layout top to bottom inside `SafeAreaView`:

1. **Header row.** "Friends" title on the left. Round "+" button on the right — `Ionicons name="person-add-outline"` inside a `Pressable`. On press: `router.push('/send-request')`.

2. **Manage-requests banner.** Rendered only when `pendingIncoming.length + pendingOutgoing.length > 0`. Bordered card (`colors.card` background, `colors.border` border, `radius.md`). Two sub-sections:
    - **Incoming requests** — heading, then one row per incoming request: avatar (size 40), username, Accept button (primary, slim), Reject button (secondary, slim). Stack horizontally via `flexDirection: 'row'`.
    - **Sent requests** — heading, then one row per outgoing: avatar, username, Cancel button (secondary, slim).
    - While an action for a row is in flight, disable that row's buttons and show a spinner on the action.

3. **Friends list.** If `friends.length === 0`, show empty state ("No friends yet. Tap + to add one."). Otherwise a `FlatList`-less simple `map` inside the ScrollView: avatar, username. No tap action.

Data load: on mount, `loadForUser(user.id)` (covered by the auto-load registry on tab enter, but we also call it on screen focus for freshness). Use `useFocusEffect` from `expo-router` (`@react-navigation/native` re-export) so the list re-fetches when you come back from `send-request`. Show `ActivityIndicator` while `loading && friends.length === 0`.

Slim variants: the existing `Button` has `minHeight: 52`. We need slim for the banner rows — add a `size?: 'md' | 'sm'` prop to `Button` (new) that switches the min-height and paddings. Add this as part of this feature. (Per global CLAUDE.md: "Most components are standardized to the same height (40px), including Input, Select, Button. There are slim variants for some, including Button." So slim already exists as a convention; we're implementing it here for the first time.)

### `app/(app)/send-request.tsx` (new)

- Header with a back chevron (`router.back()`) and title "Add friend".
- `Input` with `placeholder="Search by username"`, `autoFocus`, `autoCapitalize="none"`, `autoCorrect={false}`.
- Debounced 300ms search via `useEffect` + `setTimeout` pattern (mirrors the username uniqueness check in `account.tsx`).
- Results stored in local state (`useState<SearchResult[]>`), not the store.
- Each result row: avatar + username, plus a button derived from `relationship`:
    - `none` → **Add** (primary slim). On tap: `sendRequest(me.id, profile.id)`. On success, locally flip the result's relationship to `'pending'` so the button shows Pending.
    - `pending` → **Pending** (disabled secondary).
    - `friends` → **Friends** (disabled secondary).
- Hints: if `query.trim().length < 2`, show "Type at least 2 characters." If search returns empty, "No users found."

### Tab ordering (final)

1. Play
2. History
3. Friends
4. Account

`send-request` is a sibling with `href: null`.

## File layout

```
app/
  (app)/
    _layout.tsx           (add Friends tab + hidden send-request, auto-load effect)
    friends.tsx           (new)
    send-request.tsx      (new)
    account.tsx           (handleSignOut also calls clearAllUserStores)
lib/
  modules/
    TabBarIcon.tsx        (new)
    Button.tsx            (add slim size variant)
  stores/
    index.ts              (new — registry + loadAll/clearAll)
    CLAUDE.md             (new)
    useFriendsStore.ts    (new)
supabase/
  migrations/
    <ts>_friends.sql      (new)
```

## Verification checklist (phase 2 done when all green)

- [ ] Migration file written and shown to user. User runs `npm run migrate` then `npm run types`.
- [ ] `lib/database-types.ts` contains `friends`, `friend_requests`, `friend_request_status`, `accept_friend_request`.
- [ ] `lib/stores/index.ts` + `CLAUDE.md` in place; `useFriendsStore` registered.
- [ ] `app/(app)/_layout.tsx` calls `loadAllUserStores(user.id)` when user changes; `account.tsx` sign-out calls `clearAllUserStores()`.
- [ ] Friends tab appears between History and Account. `TabBarIcon` dot renders when `pendingIncoming.length > 0`.
- [ ] Send-request screen: typing 2+ chars shows results; each row's button reflects the correct relationship; Add sends the request and flips to Pending locally.
- [ ] Manage-requests banner: Accept moves a row into the friends list and clears the badge; Reject removes the incoming row; Cancel hard-deletes the outgoing row.
- [ ] Rejected pair: from either user's perspective, searching the other shows "Pending"; attempting to re-send returns the generic send error.
- [ ] Sign out clears both profile and auto-loaded stores.
- [ ] `npm run check` passes.
- [ ] `npm run format` run.
