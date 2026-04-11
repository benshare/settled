-- profiles table
create table public.profiles (
    id uuid primary key references auth.users on delete cascade,
    username text not null,
    avatar_path text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index profiles_username_lower_idx
    on public.profiles (lower(username));

alter table public.profiles enable row level security;

create policy "profiles_select_authenticated" on public.profiles
    for select to authenticated using (true);

create policy "profiles_insert_own" on public.profiles
    for insert to authenticated with check (id = auth.uid());

create policy "profiles_update_own" on public.profiles
    for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "profiles_delete_own" on public.profiles
    for delete to authenticated using (id = auth.uid());

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- avatars storage bucket
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatars_read_public" on storage.objects
    for select using (bucket_id = 'avatars');

create policy "avatars_insert_own" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create policy "avatars_update_own" on storage.objects
    for update to authenticated
    using (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create policy "avatars_delete_own" on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
    );
