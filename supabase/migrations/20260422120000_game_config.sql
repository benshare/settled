-- Game config: a small JSONB blob that travels from the request onto the game
-- state. Today it only holds { bonuses: boolean }; later it can grow into a
-- full config page. Nullable on game_states so rows created before this
-- migration keep parsing as { bonuses: false } on the client.

alter table public.game_requests
    add column config jsonb not null default '{}'::jsonb;

alter table public.game_states
    add column config jsonb null;

-- Extend propose_game to accept a config. Optional argument keeps older
-- callers (and any in-flight client builds) working without a change.
-- PostgreSQL treats overloads as distinct, so drop the 1-arg version before
-- creating the 2-arg version.
drop function if exists public.propose_game(uuid[]);

create or replace function public.propose_game(
    invited_user_ids uuid[],
    config jsonb default '{}'::jsonb
)
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
    if jsonb_typeof(config) <> 'object' then
        raise exception 'config must be an object';
    end if;

    select coalesce(jsonb_agg(
        jsonb_build_object('user', u, 'status', 'pending')
    ), '[]'::jsonb)
    into inv
    from unnest(invited_user_ids) as u;

    insert into public.game_requests (proposer, invited, config)
    values (me, inv, config)
    returning id into new_id;

    return new_id;
end;
$$;
