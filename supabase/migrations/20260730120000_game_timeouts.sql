-- Move timeouts. A per-game clock (config.timeout) that skips whoever is
-- holding the game up — at 2 players, ends the game against them.
--
-- All three columns live on games rather than game_states: this is game
-- metadata like config / forfeits / end_votes, not board state, and the sweep
-- has to find expired games with one indexed query without touching
-- game_states. The row is already in the realtime publication and its select
-- policies already cover participants and spectators, so neither needs a
-- change, and the game screen gets the countdown on a channel it is already on.
--
-- See .claude/specs/move-timeouts.md.

alter table public.games
    -- When the currently-pending action expires. Null when the game has no
    -- timeout configured, or has ended. Written by the edge function (never
    -- derived at read time) so the sweep below is a plain indexed range scan.
    add column deadline_at timestamptz,
    -- Highest warning already pushed for the CURRENT deadline_at: 0 none,
    -- 1 the one-hour heads-up, 2 the ten-minute one. Reset to 0 whenever
    -- deadline_at moves.
    add column timeout_warned smallint not null default 0,
    -- User ids skipped by a timeout who have not acted since. Any of them being
    -- on the clock shortens the next window to one minute, so an absent player
    -- is skipped roughly once a minute rather than stalling the table for
    -- another full window each go-around. Cleared per-user on their next real
    -- action.
    add column timed_out uuid[] not null default '{}';

create index games_deadline_idx on public.games (deadline_at)
    where status in ('placement', 'active');

-- The sweep runs every minute against game-service's `run_timeouts` action,
-- which both sends the warning pushes and applies expired timeouts. A minute of
-- granularity is right for a feature whose shortest window is an hour, and it
-- is what makes the one-minute penalty window land promptly.
--
-- Both extensions are on Supabase's allowed list; if a fresh project rejects
-- them, enable pg_cron / pg_net from Database → Extensions and re-run.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The service-role key is read from Vault, never written into this file. One
-- time, by hand, in the SQL editor:
--
--   select vault.create_secret('<service role key>', 'service_role_key');
--
-- Until that exists the job posts an unauthenticated request, which the
-- function rejects with a 401 — nothing else breaks.
select cron.schedule(
    'game-timeouts',
    '* * * * *',
    $$
    select net.http_post(
        url := 'https://ymbtisbqwehsgpidntag.supabase.co/functions/v1/game-service',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || coalesce(
                (select decrypted_secret from vault.decrypted_secrets
                 where name = 'service_role_key'),
                ''
            )
        ),
        body := jsonb_build_object('action', 'run_timeouts')
    );
    $$
);
