-- One-step undo. Holds a snapshot of this row as it was immediately before the
-- most recent *undoable* action (a solo, information-free action — see
-- .claude/specs/undo.md), or null when the last action wasn't undoable.
--
-- Written and cleared by the game-service dispatcher, never by a handler. No
-- RLS change: the existing game_states select policy already covers everyone
-- who can read the live row, and the snapshot holds nothing extra.
alter table public.game_states
    add column undo jsonb null;
