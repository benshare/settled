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

-- propose_game(invited_user_ids): proposer creates a new request. Every invited
-- entry starts as 'pending'.
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

-- respond_to_game_request(request_id, accept): updates the current user's
-- invited[] entry. If accept=true and every entry is now 'accepted', insert the
-- games row and delete the request.
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
