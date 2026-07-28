-- Forfeiting and ending games. Two withdrawable, per-player declarations that
-- a game can end without anyone reaching the VP threshold:
--
--   forfeits   — when every seat but one holds a standing forfeit, the game
--                ends and the remaining player wins (status 'complete').
--   end_votes  — when EVERY seat holds a standing vote, the game is canceled
--                with no winner (status 'canceled').
--
-- Both hold user ids rather than seat indices: they're set from the caller's
-- auth id, and a uuid can't be silently misaligned against player_order the
-- way an int can.
--
-- They live on games rather than game_states because this is game metadata,
-- not board state — the same argument config was moved for in
-- 20260724120000_game_config_on_games.sql. The row is already in the realtime
-- publication and its select policies already cover participants and
-- spectators, so neither needs a change. Like every other write in this
-- subsystem, both arrays are only ever written by the edge function under the
-- service role.

alter table public.games
    add column forfeits uuid[] not null default '{}',
    add column end_votes uuid[] not null default '{}';

alter table public.games drop constraint games_status_check;

alter table public.games
    add constraint games_status_check
    check (status in ('placement', 'active', 'complete', 'canceled'));

-- True on every row of a game that ended by forfeit, the winner's included.
-- Such a game counts toward games played and win rate and nothing else — see
-- lib/stats.ts. A CANCELED game writes no game_results rows at all, which is
-- what "contributes nothing" means at the storage layer.
--
-- The default backfills existing rows correctly: they all ended by play.
alter table public.game_results
    add column forfeit boolean not null default false;
