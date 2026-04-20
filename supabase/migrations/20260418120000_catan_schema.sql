-- Replace the dice-game schema with the Catan schema. Splits state off the
-- games row onto a new game_states table and drops fields no longer in use
-- (status='setup', scores). Existing games are discarded — no backfill.

drop table if exists public.games cascade;

create table public.games (
    id uuid primary key default gen_random_uuid(),
    participants uuid[] not null,
    player_order uuid[] not null default '{}',
    current_turn int null,
    status text not null default 'placement',
    winner int null,
    events jsonb[] not null default '{}',
    created_at timestamptz not null default now(),
    check (status in ('placement', 'active', 'complete')),
    check (array_length(participants, 1) >= 1)
);

create index games_participants_gin_idx
    on public.games using gin (participants);
create index games_status_idx
    on public.games (status);

alter table public.games enable row level security;

create policy "games_select_participant" on public.games
    for select to authenticated
    using (auth.uid() = any (participants));

create table public.game_states (
    game_id uuid primary key references public.games(id) on delete cascade,
    variant text not null,
    hexes jsonb not null,
    vertices jsonb not null default '{}',
    edges jsonb not null default '{}',
    players jsonb not null,
    phase jsonb not null,
    updated_at timestamptz not null default now()
);

alter table public.game_states enable row level security;

create policy "game_states_select_participant" on public.game_states
    for select to authenticated
    using (
        exists (
            select 1 from public.games g
            where g.id = game_states.game_id
                and auth.uid() = any (g.participants)
        )
    );

alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.game_states;
