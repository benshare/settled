-- Spectating: friends of any player may watch a game that opted in.
--
-- See .claude/specs/spectating.md. The flag is denormalized onto `games`
-- because GameConfig lives on game_states.config, which is written after the
-- games row — a policy on `games` cannot depend on it without circularity.

alter table public.games
    add column spectators boolean not null default false;

-- Partial index: the spectatable set is small relative to all games, and the
-- Play-tab listing always filters on status too.
create index games_spectators_status_idx
    on public.games (status) where spectators;

-- Read policies. Each is additive alongside the existing participant policy
-- (PostgreSQL ORs permissive policies together).
--
-- The predicate is deliberately NOT scoped by status: a game that completes
-- while someone is watching must not have the row yanked out from under them
-- mid-render. The status filter lives in the listing query instead.
--
-- The `friends` subquery runs under friends_select_party, which permits exactly
-- the rows where auth.uid() is a party — all this asks for — so no security
-- definer wrapper is needed.

create policy "games_select_spectator" on public.games
    for select to authenticated
    using (
        spectators
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
              and g.spectators
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
              and g.spectators
              and not (auth.uid() = any (g.participants))
              and exists (
                  select 1 from public.friends f
                  where (f.user_id_a = auth.uid() and f.user_id_b = any (g.participants))
                     or (f.user_id_b = auth.uid() and f.user_id_a = any (g.participants))
              )
        )
    );

-- game_chat_reads needs nothing: it is already self-scoped to auth.uid(), and a
-- spectator only ever writes their own row.

-- New games are watchable by default; existing rows keep the column default of
-- false and stay private.
alter table public.profiles
    alter column game_defaults set default
        '{"settings": {"devCards": true, "spectators": true}, "extras": {"bonuses": false}}'::jsonb;
