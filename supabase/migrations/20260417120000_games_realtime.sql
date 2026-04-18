-- Enable realtime broadcasts for games and game_requests.
alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.game_requests;
