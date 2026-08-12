-- Release 2 of the turn-pointer move: drop the mirror.
--
-- `game_states.current_turn` has been the source of truth since
-- 20260807120000_current_turn_on_game_states.sql; this column has been
-- write-only since then, kept alive purely for clients built before that
-- release. See `.claude/specs/current-turn-on-game-states.md`.
--
-- ORDER MATTERS: deploy the edge function that stops writing this column
-- *before* running this migration. The other way round, every handler that
-- still names the column in its `games` update fails, and every action in
-- every game 500s until the deploy lands.

alter table public.games
    drop column if exists current_turn;
