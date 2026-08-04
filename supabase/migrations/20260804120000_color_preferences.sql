-- Player color preferences.
--
-- `profiles.color_prefs` is a per-user ranking of the six player colors, best
-- first. An empty array means no preference, which resolves to a random color
-- rather than to the default order — so the default here is deliberately '[]'
-- and not the full list.
--
-- `games.colors` is the resolved assignment, one color per seat in
-- `player_order` order. Written once by the edge function at game creation.

alter table profiles
	add column color_prefs jsonb not null default '[]'::jsonb;

alter table games
	add column colors text[] not null default '{}';

-- Backfill: before preferences existed a player's color was their seat index
-- into the palette, which this array reproduces in order.
update games
set colors = (array['red', 'blue', 'orange', 'white', 'green', 'brown'])
	[1:coalesce(array_length(player_order, 1), 0)]
where cardinality(colors) = 0;

-- No RLS changes. Both columns sit on tables that already have policies, and
-- the edge function reads color_prefs with the service-role client.
