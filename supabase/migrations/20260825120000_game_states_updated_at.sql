-- Make `game_states.updated_at` actually move.
--
-- The column has been `default now()` since 20260418120000_catan_schema.sql
-- with no trigger, and nothing in `supabase/functions` ever names it — so it
-- was frozen at insert time for the life of a game. That silently disabled the
-- cheap half of the client's foreground resync: `refetchChanged` in
-- `lib/stores/useGameStatesStore.ts` reads this one column for every held game
-- and pulls whole rows only for the ids whose stamp moved. With a stamp that
-- never moves, no game ever looked stale, and a client that had already read a
-- board could only correct it through realtime — which does not replay what it
-- missed while the socket was closed. The path appeared to work because a cold
-- launch holds no row yet and takes the full-fetch branch instead.
--
-- `public.set_updated_at()` already exists (profiles, friend_requests); this
-- just points a third trigger at it. Deliberately unguarded by an
-- `old.* is distinct from new.*` check, matching the other two: every write to
-- this table comes from `game-service` committing a real move.

create trigger game_states_set_updated_at
before update on public.game_states
for each row execute function public.set_updated_at();
