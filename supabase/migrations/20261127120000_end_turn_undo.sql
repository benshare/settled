-- Undoable end turn. Holds a compact snapshot of what the most recent `end_turn`
-- changed (the ending seat, its pre-reset player state, the main phase left
-- behind, the prior round, and the events length before `turn_ended`), or null
-- when the window is closed.
--
-- Written by `handleEndTurn`, read/cleared by `handleUndoEndTurn`, and cleared by
-- the next committed move in `serve`'s post-action hook — so a player can take
-- their end-turn back until the next player acts. See
-- `.claude/specs/end-turn-undo.md`. Unrelated to the old `undo` column (dropped
-- in 20260924120000), which backed the pre-queue one-step undo.
--
-- No RLS change: the existing game_states select policy already covers everyone
-- who can read the live row, and the snapshot holds nothing the row doesn't.
alter table public.game_states
    add column end_turn_undo jsonb null;
