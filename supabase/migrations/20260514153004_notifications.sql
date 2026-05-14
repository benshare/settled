-- Notifications: push tokens, per-user prefs, and server-mediated
-- friend/game request insertion paths.

-- 1. Per-user notification preferences. Three booleans, defaulted on. Same
--    JSONB pattern as profiles.game_defaults so the client can narrow with a
--    parser helper.
alter table public.profiles
    add column notification_prefs jsonb not null default jsonb_build_object(
        'gameInvite', true,
        'yourTurn', true,
        'friendRequest', true
    );

-- 2. Expo push tokens. Token is the primary key so a token migrating between
--    users (rare, e.g. re-install on a shared device) overwrites the prior
--    owner via upsert. user_id has its own index for fan-out lookups.
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

-- 3. Server-mediated friend request inserts. The friends-service edge function
--    owns the path (service role), so the sender-side RLS policy is no longer
--    needed. Receiver-side update/select policies stay.
drop policy if exists "friend_requests_insert_sender" on public.friend_requests;

-- 4. Server-mediated game proposal. game-service owns propose_game as an
--    action (so the push fan-out has a single home). The SQL function and the
--    client-side RLS insert policy are no longer needed.
drop policy if exists "game_requests_insert_proposer" on public.game_requests;
drop function if exists public.propose_game(uuid[], jsonb);
