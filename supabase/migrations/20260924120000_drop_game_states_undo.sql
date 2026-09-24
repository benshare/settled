-- Drop the one-step undo snapshot. Undo is now a local action queue held on the
-- client and flushed as one `batch`, so nothing reads or writes this column —
-- see .claude/specs/local-action-queue.md.
--
-- Apply this LAST, after the new client is live: an old client still sends the
-- `undo` action, and the edge function's handler for it reads this column.

alter table public.game_states drop column if exists undo;
