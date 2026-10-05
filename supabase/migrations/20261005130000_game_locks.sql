-- Per-game lease lock. game-service takes it in front of every game-scoped
-- action so two concurrent read-modify-writes on one game can't silently
-- undo each other. A lease rather than an advisory lock because PostgREST
-- calls can't share a session or transaction. See
-- .claude/specs/avarice-voluntary-discard.md (part 1).

create table public.game_locks (
	game_id uuid primary key references public.games (id) on delete cascade,
	token uuid not null,
	expires_at timestamptz not null
);

-- Service role only: no policies.
alter table public.game_locks enable row level security;

-- True iff the caller now holds the lease. An unexpired lease held by another
-- token is left alone; an expired one is taken over.
create or replace function public.acquire_game_lock(
	p_game_id uuid,
	p_token uuid,
	p_ttl_ms int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
	held uuid;
begin
	insert into public.game_locks (game_id, token, expires_at)
	values (p_game_id, p_token, now() + make_interval(secs => p_ttl_ms / 1000.0))
	on conflict (game_id) do update
		set token = excluded.token, expires_at = excluded.expires_at
		where public.game_locks.expires_at < now()
	returning token into held;
	return coalesce(held = p_token, false);
end;
$$;

-- Only the holder releases: a lease that expired and was taken over must not
-- be dropped by its old holder finishing late.
create or replace function public.release_game_lock(
	p_game_id uuid,
	p_token uuid
) returns void
language sql
security definer
set search_path = public
as $$
	delete from public.game_locks where game_id = p_game_id and token = p_token;
$$;

revoke all on function public.acquire_game_lock(uuid, uuid, int) from public, anon, authenticated;
revoke all on function public.release_game_lock(uuid, uuid) from public, anon, authenticated;
grant execute on function public.acquire_game_lock(uuid, uuid, int) to service_role;
grant execute on function public.release_game_lock(uuid, uuid) to service_role;
