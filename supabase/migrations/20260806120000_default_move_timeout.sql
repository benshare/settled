-- The move timeout defaults to two days rather than off.
--
-- The client-side halves of this are `DEFAULT_CONFIG.timeout` (lib/catan/
-- types.ts) and `DEFAULT_GAME_DEFAULTS.settings.timeout` (lib/stores/
-- useProfileStore.ts). This file is the stored half: the column default for
-- new profiles, plus a backfill so games already in flight get a clock instead
-- of only games created from here on.
--
-- See .claude/specs/move-timeouts.md.

-- New profiles. An existing profile row that has never saved its options is
-- missing the key entirely, which `parseGameDefaults` reads as the default —
-- so only a profile that explicitly saved "None" keeps no timeout.
alter table public.profiles
    alter column game_defaults set default
        '{"settings": {"devCards": true, "spectators": true, "timeout": "2d"}, "extras": {"bonuses": false}}'::jsonb;

-- Games in flight with no clock — either created before timeouts shipped (no
-- key at all) or created with the old "None" default. Both get two days, and a
-- full fresh window from now, so nobody is skipped the minute this lands.
--
-- Deliberately not touching finished games: their config is the record of how
-- they were actually played.
update public.games
set config = jsonb_set(config, '{timeout}', '"2d"'),
    deadline_at = now() + interval '2 days',
    timeout_warned = 0
where status in ('placement', 'active')
  and coalesce(config->>'timeout', '') not in
      ('1h', '3h', '12h', '1d', '2d', '3d', '4d', '5d', '6d', '7d');

-- Pending invitations, for the same reason: the game they turn into is created
-- from this config, so leaving them alone would keep producing clockless games
-- for as long as the oldest request sits unanswered.
update public.game_requests
set config = jsonb_set(config, '{timeout}', '"2d"')
where coalesce(config->>'timeout', '') not in
      ('1h', '3h', '12h', '1d', '2d', '3d', '4d', '5d', '6d', '7d');
