-- Per-user debug prompt: an error modal shown at app load with a link the
-- player can copy and send back. Everything about it is backend-controlled —
-- who sees it (a row exists), whether it shows (`enabled`), and what gets
-- copied (`link`) — so toggling it never needs a client release, native or OTA.
--
-- One row per targeted user rather than a global flag + user list: the client
-- reads its own row through RLS, so no user id is baked into the bundle and
-- nobody can see whether anyone else is targeted.

create table public.debug_prompts (
    user_id uuid primary key references public.profiles (id) on delete cascade,
    -- The flag. False parks a row here ready to be flipped from the dashboard.
    enabled boolean not null default false,
    -- Copied verbatim by the modal's button. Re-read at press time, so an edit
    -- here lands on the next tap without the app restarting.
    link text,
    updated_at timestamptz not null default now()
);

alter table public.debug_prompts enable row level security;

create policy "debug_prompts_select_own" on public.debug_prompts
    for select to authenticated
    using (user_id = auth.uid());

-- No insert/update/delete policies: this table is written from the dashboard /
-- service role only, both of which bypass RLS.

insert into public.debug_prompts (user_id, enabled, link)
values ('27559b91-848d-479c-891d-77f67774208f', false, null)
on conflict (user_id) do nothing;
