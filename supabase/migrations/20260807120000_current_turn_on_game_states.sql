-- Move the turn pointer to the row that tracks progress.
--
-- `games` is identity — participants, seating, colors, immutable config, the
-- event log. `game_states` is progress. `current_turn` moves several times a
-- turn and belongs beside `phase`; it lived on `games` only because the Games
-- list loads `games` rows and nothing else, so a pointer anywhere else was
-- invisible to it. `useGameStatesStore` removed that constraint (see
-- `.claude/specs/pending-action-signal.md`).
--
-- This is release 1 of two: the column is duplicated, not moved. A client that
-- hasn't updated still reads `games.current_turn`, so the edge function writes
-- both — in the same statement, so the two can't be seen disagreeing — and
-- reads this one. Release 2 drops the old column once the old clients are gone.
--
-- Nullable on purpose: nobody holds the turn through the simultaneous
-- `select_bonus` phase. No RLS change — `game_states` already governs row
-- access, and a new column needs no new policy.

alter table public.game_states
    add column current_turn integer;

update public.game_states s
set current_turn = g.current_turn
from public.games g
where g.id = s.game_id;
