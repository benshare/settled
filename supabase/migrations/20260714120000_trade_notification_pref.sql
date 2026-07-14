-- Trade offers get their own notification preference. They were previously
-- gated on the `yourTurn` key, so muting turn notifications also muted trades.

alter table public.profiles
    alter column notification_prefs set default jsonb_build_object(
        'gameInvite', true,
        'yourTurn', true,
        'trade', true,
        'friendRequest', true
    );

-- Existing rows predate the key. Both readers already treat a missing key as
-- on, so this is for uniformity rather than correctness.
update public.profiles
set notification_prefs = notification_prefs || jsonb_build_object('trade', true)
where not (notification_prefs ? 'trade');
