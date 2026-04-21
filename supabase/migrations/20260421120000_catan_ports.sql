-- Add the ports (harbors) array to game_states. Nullable because a few old
-- games may still exist in dev environments without ports; new games always
-- seed a 9-entry array of { edge, kind } at creation time.

alter table public.game_states
    add column ports jsonb null;
