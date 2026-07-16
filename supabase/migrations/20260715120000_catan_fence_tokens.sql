-- Fencer bonus (set 3): reserved road edges on game_states, keyed edge →
-- owning player index. Nullable/empty for games without a fencer. RLS on
-- game_states already governs row access; a new column needs no new policy.

alter table public.game_states
    add column fence_tokens jsonb null;
