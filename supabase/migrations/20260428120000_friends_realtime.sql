-- Enable realtime broadcasts for friends and friend_requests.
alter publication supabase_realtime add table public.friends;
alter publication supabase_realtime add table public.friend_requests;
