-- Curses became a choice: a game may deal 2-3 curse cards per player and let
-- them keep one (see `GameConfig.curseCount`). Record what was offered, the
-- same way `offered_bonuses` already does, so the Stats tab can measure curse
-- pick rate.
--
-- Null on games played without bonuses, and on games that finished before this
-- column existed. Single-card offers are recorded too, but excluded from pick
-- rate — a card nobody could decline isn't a pick.
alter table public.game_results add column offered_curses text[];
