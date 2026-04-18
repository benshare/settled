-- Gameplay columns on games, 'setup' status, and removal of the SQL RPCs
-- whose responsibilities have moved to the game-service edge function
-- (which mutates via the service-role key and bypasses RLS).

alter table public.games
    add column player_order uuid[] not null default '{}',
    add column current_turn int null,
    add column scores int[] not null default '{}',
    add column winner int null,
    add column events jsonb[] not null default '{}';

alter table public.games drop constraint if exists games_status_check;
alter table public.games
    add constraint games_status_check
    check (status in ('setup', 'active', 'complete'));

-- respond_to_game_request and complete_game are replaced by game-service
-- actions. propose_game stays (still a simple insert on the caller's behalf).
drop function if exists public.respond_to_game_request(uuid, boolean);
drop function if exists public.complete_game(uuid);

-- Drop write policies that existed only to let the now-removed security-invoker
-- RPCs mutate these tables. The edge function uses the service role, so RLS
-- writes are not needed. (game_requests_insert_proposer stays for propose_game.)
drop policy if exists "game_requests_update_party" on public.game_requests;
drop policy if exists "game_requests_delete_party" on public.game_requests;
drop policy if exists "games_insert_participant" on public.games;
drop policy if exists "games_update_participant" on public.games;
