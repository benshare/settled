-- Games a spectator has pinned to their Games tab. Per user, server-side so a
-- pin follows them across devices. A pinned game stays listed after it ends
-- (the spectator select policies are status-agnostic) until it is unpinned.
-- See .claude/specs/unseen-results-and-pins.md.

create table public.game_pins (
    user_id uuid not null references public.profiles(id) on delete cascade,
    game_id uuid not null references public.games(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (user_id, game_id)
);

alter table public.game_pins enable row level security;

create policy "game_pins_select_self" on public.game_pins
    for select to authenticated
    using (auth.uid() = user_id);

-- Only a game the pinner can currently read: the subquery runs under the games
-- select policies, so this admits spectatable (and seated) games and nothing
-- else.
create policy "game_pins_insert_self" on public.game_pins
    for insert to authenticated
    with check (
        auth.uid() = user_id
        and exists (select 1 from public.games g where g.id = game_pins.game_id)
    );

create policy "game_pins_delete_self" on public.game_pins
    for delete to authenticated
    using (auth.uid() = user_id);
