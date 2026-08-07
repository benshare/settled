-- Global per-card play numbers for the bonus/curse catalog, aggregated across
-- every player's completed games. See .claude/specs/card-global-stats.md.
--
-- game_results already records everything needed (bonus, curse, what was
-- offered, won, points, forfeit, player_count) but is readable only for games
-- the requester sat at. Widening that policy would expose other people's
-- individual scores, so this view exposes counts and nothing else: no game id,
-- no user id, no single result can be recovered from it.
--
-- `security_invoker = false` is the Postgres default, stated explicitly because
-- it is the entire point — the view runs as its owner (postgres, which owns
-- game_results and therefore bypasses its RLS), so it sees every row.

create view public.card_stats with (security_invoker = false) as
with result_rows as (
    select
        r.bonus,
        r.curse,
        r.offered_bonuses,
        r.offered_curses,
        r.won,
        r.points,
        r.forfeit,
        -- gameSizeFor(player_count), re-expressed in SQL. A third mirror of
        -- that rule, alongside lib/catan/types.ts and the edge function.
        case
            when r.player_count <= 2 then 'small'
            when r.player_count >= 5 then 'expanded'
            else 'standard'
        end as size
    from public.game_results r
    join public.profiles p on p.id = r.user_id
    -- Dev and production share one database, so a seeded test game would
    -- otherwise move a real global number.
    where not p.dev
),

-- One row per card actually played, both kinds in one shape.
played as (
    select 'bonus'::text as kind, bonus as card_id, size, won, points, forfeit
    from result_rows
    where bonus is not null
    union all
    select 'curse'::text, curse, size, won, points, forfeit
    from result_rows
    where curse is not null
),

play_totals as (
    select
        kind,
        card_id,
        size,
        count(*) as games,
        count(*) filter (where won) as wins,
        -- A forfeited game counts toward games and wins but has no meaningful
        -- score in it, so points are measured over the smaller sample — the
        -- same split lib/stats.ts makes for the reader's own history.
        count(*) filter (where not forfeit) as played_games,
        coalesce(sum(points) filter (where not forfeit), 0) as points_sum
    from played
    group by kind, card_id, size
),

-- One row per card offered, but only out of hands that held a real choice: a
-- card nobody could decline would read as 100% picked. Legacy rows (null
-- arrays, from before offers were recorded) contribute nothing.
offered as (
    select 'bonus'::text as kind, o as card_id, size, o = bonus as kept
    from result_rows, unnest(offered_bonuses) as o
    where array_length(offered_bonuses, 1) >= 2
    union all
    select 'curse'::text, o, size, o = curse
    from result_rows, unnest(offered_curses) as o
    where array_length(offered_curses, 1) >= 2
),

offer_totals as (
    select
        kind,
        card_id,
        size,
        count(*) as offers,
        count(*) filter (where kept) as keeps
    from offered
    group by kind, card_id, size
)

-- Full join: a card can have been offered in games that are still running (no
-- results row yet) and, for old games, played without its offer recorded.
select
    coalesce(p.kind, o.kind) as kind,
    coalesce(p.card_id, o.card_id) as card_id,
    coalesce(p.size, o.size) as size,
    coalesce(p.games, 0) as games,
    coalesce(p.wins, 0) as wins,
    coalesce(p.played_games, 0) as played_games,
    coalesce(p.points_sum, 0) as points_sum,
    coalesce(o.offers, 0) as offers,
    coalesce(o.keeps, 0) as keeps
from play_totals p
full join offer_totals o
    on o.kind = p.kind
   and o.card_id = p.card_id
   and o.size = p.size;

comment on view public.card_stats is
    'Global bonus/curse play counts per (kind, card_id, game size). Counts '
    'only — deliberately bypasses game_results RLS, which is safe because no '
    'individual row is recoverable. Rates are computed client-side.';

-- Read-only, signed-in users only. Anon gets nothing.
revoke all on public.card_stats from anon;
grant select on public.card_stats to authenticated;
