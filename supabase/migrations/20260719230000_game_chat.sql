-- Game chat: a per-game message thread for participants.
--
-- Two tables. `game_messages` is the thread itself; `game_chat_reads` is the
-- per-(game, user) read cursor, which doubles as the "currently reading"
-- presence signal that suppresses a push for someone who already has the panel
-- open (see .claude/specs/game-chat.md).

-- 1. Messages.
create table public.game_messages (
    id uuid primary key default gen_random_uuid(),
    game_id uuid not null references public.games(id) on delete cascade,
    sender uuid not null references public.profiles(id) on delete cascade,
    body text not null check (char_length(body) between 1 and 500),
    created_at timestamptz not null default now()
);

create index game_messages_game_id_created_at_idx
    on public.game_messages (game_id, created_at);

alter table public.game_messages enable row level security;

-- Read: participants only. Mirrors the game_states select policy.
create policy "game_messages_select_participant" on public.game_messages
    for select to authenticated
    using (
        exists (
            select 1 from public.games g
            where g.id = game_messages.game_id
              and auth.uid() = any (g.participants)
        )
    );

-- No insert/update/delete policies: writes go through game-service on the
-- service role, per the edge-function convention.

alter publication supabase_realtime add table public.game_messages;

-- 2. Read cursor + presence.
--
-- This is the one chat table the client writes to directly. The row is
-- self-scoped, RLS-guarded, and carries no game rules; routing the 15s
-- heartbeat through an edge function would mean a function invocation per open
-- panel per 15s for no benefit.
create table public.game_chat_reads (
    game_id uuid not null references public.games(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    last_read_at timestamptz not null default now(),
    primary key (game_id, user_id)
);

alter table public.game_chat_reads enable row level security;

create policy "game_chat_reads_select_self" on public.game_chat_reads
    for select to authenticated
    using (auth.uid() = user_id);

create policy "game_chat_reads_insert_self" on public.game_chat_reads
    for insert to authenticated
    with check (auth.uid() = user_id);

create policy "game_chat_reads_update_self" on public.game_chat_reads
    for update to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- 3. Chat notification preference, defaulted on.
--
-- parseNotificationPrefs already defaults a missing key to true, so the
-- backfill is belt-and-braces rather than load-bearing.
update public.profiles
set notification_prefs =
    coalesce(notification_prefs, '{}'::jsonb) || jsonb_build_object('chatMessage', true);

alter table public.profiles
    alter column notification_prefs set default jsonb_build_object(
        'gameInvite', true,
        'yourTurn', true,
        'trade', true,
        'friendRequest', true,
        'chatMessage', true
    );
