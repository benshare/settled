-- Add the robber to game_states. Initialized to the desert hex when a new
-- game is created (enforced by the edge function). Existing rows get a
-- placeholder '1A' — there are no live games in production that predate
-- this migration, so the placeholder is never read.

alter table public.game_states
    add column robber text not null default '1A';

alter table public.game_states
    alter column robber drop default;
