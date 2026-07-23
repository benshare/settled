-- Games the user is *actively* spectating — the subset of watchable games that
-- get a tab in the game screen's header strip. Distinct from what they *may*
-- watch (any spectators-enabled game with a friend, surfaced under "Watch"):
-- this records the ones they've actually opened. Read/written only by the owner
-- via the existing self-scoped profile policies (a user updates only their own
-- row), so no new policy is needed. Pruned client-side when a game ends.
alter table public.profiles
    add column spectating uuid[] not null default '{}';
