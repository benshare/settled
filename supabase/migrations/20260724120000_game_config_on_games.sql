-- Move GameConfig from game_states onto games, and drop the denormalized
-- games.spectators column that only existed to work around its absence there.
--
-- config is immutable game metadata — written once when the game is created,
-- never mutated — so it belongs beside participants and status, not on the
-- board-state row. Putting it there also lets the spectator policies read it
-- directly: a policy on games could not subquery game_states, whose own select
-- policy subqueries games, and PostgreSQL rejects that pair as infinitely
-- recursive. That circularity was the sole reason for the boolean.
--
-- Collapsing to one source of truth also closes a drift the two-column shape
-- already produced: the flag had to be re-derived field-by-field at insert
-- time, so every game created between the client shipping the toggle and the
-- edge function deploying had config.spectators true and the column false —
-- unwatchable despite being marked watchable. The backfill below repairs those
-- rows as a side effect of moving the data.

alter table public.games
    add column config jsonb not null default '{}'::jsonb;

update public.games g
set config = s.config
from public.game_states s
where s.game_id = g.id;

alter table public.games
    alter column config drop default;

-- Every extant row carries the key, but pin the invariant so the policies below
-- can read it as a plain boolean: a row that never opted in is not watchable.
update public.games
set config = jsonb_set(config, '{spectators}', 'false'::jsonb)
where not (config ? 'spectators');

alter table public.game_states drop column config;

-- Rebuild the spectator policies against games.config. The predicate is
-- otherwise unchanged from 20260722120000_spectating.sql — still not scoped by
-- status, so a game completing under a watcher does not yank the row out from
-- under them mid-render.

drop policy "games_select_spectator" on public.games;
drop policy "game_states_select_spectator" on public.game_states;
drop policy "game_messages_select_spectator" on public.game_messages;

create policy "games_select_spectator" on public.games
    for select to authenticated
    using (
        (config ->> 'spectators')::boolean
        and not (auth.uid() = any (participants))
        and exists (
            select 1 from public.friends f
            where (f.user_id_a = auth.uid() and f.user_id_b = any (participants))
               or (f.user_id_b = auth.uid() and f.user_id_a = any (participants))
        )
    );

create policy "game_states_select_spectator" on public.game_states
    for select to authenticated
    using (
        exists (
            select 1 from public.games g
            where g.id = game_states.game_id
              and (g.config ->> 'spectators')::boolean
              and not (auth.uid() = any (g.participants))
              and exists (
                  select 1 from public.friends f
                  where (f.user_id_a = auth.uid() and f.user_id_b = any (g.participants))
                     or (f.user_id_b = auth.uid() and f.user_id_a = any (g.participants))
              )
        )
    );

create policy "game_messages_select_spectator" on public.game_messages
    for select to authenticated
    using (
        exists (
            select 1 from public.games g
            where g.id = game_messages.game_id
              and (g.config ->> 'spectators')::boolean
              and not (auth.uid() = any (g.participants))
              and exists (
                  select 1 from public.friends f
                  where (f.user_id_a = auth.uid() and f.user_id_b = any (g.participants))
                     or (f.user_id_b = auth.uid() and f.user_id_a = any (g.participants))
              )
        )
    );

-- Same partial index as before, now keyed off the jsonb. Both operators are
-- immutable, so the expression is indexable.
drop index if exists public.games_spectators_status_idx;

create index games_spectators_status_idx
    on public.games (status) where (config ->> 'spectators')::boolean;

alter table public.games drop column spectators;
