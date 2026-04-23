-- Per-user default game options. Shape mirrors the create-game form
-- sections: `settings` holds core-game controls (dev cards etc.), `extras`
-- holds non-standard additions (bonuses). Dev cards default on, bonuses
-- default off. Updated via a normal profiles update when a user taps
-- "Save options" on the create-game screen.

alter table public.profiles
    add column game_defaults jsonb not null default
        '{"settings": {"devCards": true}, "extras": {"bonuses": false}}'::jsonb;
