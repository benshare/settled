-- When a game ended (either way — 'complete' or 'canceled'). History sorts on
-- this; created_at buried long-running games below ones started after them.
-- Written by game-service alongside the status flip; null while in progress.

alter table public.games add column completed_at timestamptz;

-- Backfill: game_results is the authoritative stamp for completed games; the
-- last logged event's timestamp covers canceled games (which write no
-- results) and anything else.
update public.games g
set completed_at = coalesce(
    (select min(r.completed_at) from public.game_results r where r.game_id = g.id),
    (g.events[array_length(g.events, 1)] ->> 'at')::timestamptz,
    g.created_at
)
where g.status in ('complete', 'canceled');
