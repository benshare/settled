-- Per-player summary of a finished game, written by the game-service edge
-- function the moment a winner is found. See .claude/specs/stats.md.
--
-- Final scores are otherwise unrecoverable once a game ends: victory points are
-- a derivation over game_states (which stays live-shaped, not archival) and
-- placement was never recorded at all. The Stats tab reads this table instead
-- of refetching and rescoring every past game on the client.

create table public.game_results (
    game_id uuid not null references public.games (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    player_index integer not null,
    -- Fully-revealed VP (includes hidden VP dev cards) — the game is over.
    points integer not null,
    -- 1-based. Ties share the better rank: 1 + (players with strictly more).
    placement integer not null,
    won boolean not null,
    -- `game_states.round` at completion: a monotonic *turn* counter, not
    -- rounds. Divide by player_count for full go-arounds.
    turns integer not null,
    player_count integer not null,
    -- Null on games played without bonuses. `offered_bonuses` is the pair this
    -- player was dealt; null for games that predate it being recorded.
    bonus text,
    curse text,
    offered_bonuses text[],
    completed_at timestamptz not null default now(),
    primary key (game_id, user_id)
);

create index game_results_user_idx on public.game_results (user_id);

alter table public.game_results enable row level security;

-- Readable by anyone who sat at that table — the same visibility they already
-- have on the games row. Deliberately broader than `user_id = auth.uid()` so
-- head-to-head stats stay possible without a policy change.
create policy "game_results_select_participant" on public.game_results
    for select to authenticated
    using (
        exists (
            select 1 from public.games g
            where g.id = game_results.game_id
              and auth.uid() = any (g.participants)
        )
    );

-- No insert/update/delete policies: only the edge function (service role,
-- which bypasses RLS) writes here.
