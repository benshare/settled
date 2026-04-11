-- Flag for users that only exist for local/dev testing.
-- Production client builds filter these out from user-facing queries (see lib/stores/CLAUDE.md).
alter table public.profiles
    add column dev boolean not null default false;
