-- Per-player gameplay preferences.
--
-- `profiles.play_prefs` holds how the app behaves for this player in any game
-- (today: `confirmDevCardBuy`). Unlike `game_defaults` it isn't a game setting
-- and never reaches another seat. The client parses it with fallbacks, so '{}'
-- means every preference at its default.
--
-- Must be applied BEFORE the client that selects this column ships: the
-- profile load names it explicitly, and a missing column fails that load.

alter table profiles
	add column play_prefs jsonb not null default '{}'::jsonb;

-- No RLS changes: profiles already has its policies, and nothing server-side
-- reads this column.
