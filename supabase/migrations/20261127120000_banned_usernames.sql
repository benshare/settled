-- Reserve a case-insensitive blocklist of usernames (pronouns, resources,
-- `robber`, `player`, game keywords). Mirror of lib/username.ts — change both;
-- dev/check-banned-usernames.ts asserts they stay in sync. Full design:
-- .claude/specs/banned-usernames.md.
--
-- A trigger, NOT a CHECK constraint: a CHECK is re-evaluated on every UPDATE of
-- the row, so a grandfathered holder of a reserved name (e.g. `player`) could
-- never update any other column. The trigger instead fires only on INSERT, or on
-- an UPDATE that actually CHANGES the username — so existing holders keep their
-- name and nothing renames them. Matching is exact + case-insensitive (the whole
-- username equals a reserved word), never substring.

create or replace function public.profiles_reject_banned_username()
returns trigger
language plpgsql
as $$
declare
    -- BANNED_USERNAMES_START (parsed by dev/check-banned-usernames.ts)
    v_banned constant text[] := array[
        -- Pronouns
        'him', 'his', 'her', 'hers', 'she', 'they', 'them', 'their', 'theirs',
        'its', 'our', 'ours', 'you', 'your', 'yours',
        -- Player
        'player', 'players',
        -- Resources + common synonyms
        'brick', 'wood', 'sheep', 'wheat', 'ore', 'lumber', 'grain', 'wool',
        'clay',
        -- Robber
        'robber',
        -- Game keywords
        'knight', 'settlement', 'settlements', 'city', 'cities', 'road', 'roads',
        'settler', 'settlers', 'catan', 'settled', 'monopoly', 'victorypoint',
        'longestroad', 'largestarmy', 'roadbuilding', 'yearofplenty', 'devcard',
        'desert'
    ];
    -- BANNED_USERNAMES_END
begin
    -- Grandfather: only a new row, or one whose username actually changed, is
    -- checked. An unchanged username (any other column being updated) passes.
    if tg_op = 'UPDATE'
        and lower(new.username) is not distinct from lower(old.username) then
        return new;
    end if;

    if lower(btrim(new.username)) = any (v_banned) then
        raise exception 'username is reserved'
            using errcode = 'check_violation';
    end if;

    return new;
end;
$$;

create trigger profiles_reject_banned_username
    before insert or update of username on public.profiles
    for each row
    execute function public.profiles_reject_banned_username();
