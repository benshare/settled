-- Finished games a player hasn't looked at yet. A row exists while the result
-- is unseen; the client deletes its own row when it shows the game-over view.
-- Until then the game stays in the player's Active list tagged "Complete"
-- (see .claude/specs/unseen-results-and-pins.md).
--
-- Rows are written by a trigger on the status flip rather than by game-service,
-- so every ending (VP win, forfeit, timeout, whole-table cancel) is covered
-- without an edge deploy. Storing *unseen* rather than *seen* keeps the table
-- at a handful of rows per user and makes the backfill free: games already
-- finished when this ships get no row, i.e. they read as seen.

create table public.unseen_game_results (
    user_id uuid not null references public.profiles(id) on delete cascade,
    game_id uuid not null references public.games(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (user_id, game_id)
);

alter table public.unseen_game_results enable row level security;

create policy "unseen_game_results_select_self" on public.unseen_game_results
    for select to authenticated
    using (auth.uid() = user_id);

-- Marking seen is the only client write. No insert policy: only the trigger
-- (security definer) creates rows.
create policy "unseen_game_results_delete_self" on public.unseen_game_results
    for delete to authenticated
    using (auth.uid() = user_id);

create or replace function public.games_mark_results_unseen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    -- Joined through profiles: a deleted account's id survives in
    -- participants (see account-deletion.md) and would violate the FK.
    insert into public.unseen_game_results (user_id, game_id)
    select p.id, new.id
    from public.profiles p
    where p.id = any (new.participants)
    on conflict do nothing;
    return new;
end;
$$;

create trigger games_mark_results_unseen
    after update of status on public.games
    for each row
    when (
        new.status in ('complete', 'canceled')
        and old.status not in ('complete', 'canceled')
    )
    execute function public.games_mark_results_unseen();
