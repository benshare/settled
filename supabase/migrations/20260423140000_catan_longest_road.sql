-- Longest Road holder on game_states. Player index (0-based in
-- games.player_order) of the player holding the Longest Road bonus, or null
-- when no one has ≥ 5 connected road segments with a strict majority.
-- Recomputed by the edge function after road builds, Road Building card
-- finalization, and settlement builds (an opponent's settlement can split a
-- chain). Ties keep the existing holder.

alter table public.game_states
    add column longest_road int null;
