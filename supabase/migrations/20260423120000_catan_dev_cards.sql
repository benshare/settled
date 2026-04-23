-- Dev-card state on game_states. `dev_deck` is the shuffled draw pile
-- (top = first element); `largest_army` tracks the player index holding the
-- Largest Army bonus (null when no one qualifies); `round` is a monotonic
-- turn counter used to enforce "can't play a dev card on the turn you
-- bought it". Per-player dev-card hands + played counts live inside the
-- existing `players` JSONB column (no schema change needed there).

alter table public.game_states
    add column dev_deck jsonb not null default '[]'::jsonb;

alter table public.game_states
    alter column dev_deck drop default;

alter table public.game_states
    add column largest_army int null;

alter table public.game_states
    add column round int not null default 0;

alter table public.game_states
    alter column round drop default;
