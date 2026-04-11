-- Enum for friend-request status
create type public.friend_request_status as enum (
    'pending',
    'accepted',
    'rejected'
);

-- friends: one row per friendship, with alphabetized user IDs
create table public.friends (
    user_id_a uuid not null references auth.users on delete cascade,
    user_id_b uuid not null references auth.users on delete cascade,
    time_added timestamptz not null default now(),
    primary key (user_id_a, user_id_b),
    check (user_id_a < user_id_b),
    constraint friends_user_id_a_profiles_fkey
        foreign key (user_id_a) references public.profiles(id) on delete cascade,
    constraint friends_user_id_b_profiles_fkey
        foreign key (user_id_b) references public.profiles(id) on delete cascade
);

create index friends_user_id_b_idx on public.friends (user_id_b);

alter table public.friends enable row level security;

create policy "friends_select_party" on public.friends
    for select to authenticated
    using (auth.uid() = user_id_a or auth.uid() = user_id_b);

create policy "friends_insert_party" on public.friends
    for insert to authenticated
    with check (auth.uid() = user_id_a or auth.uid() = user_id_b);

-- friend_requests: directional, one-row-per-pair regardless of direction
create table public.friend_requests (
    id uuid primary key default gen_random_uuid(),
    sender_id uuid not null references auth.users on delete cascade,
    receiver_id uuid not null references auth.users on delete cascade,
    status public.friend_request_status not null default 'pending',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (sender_id <> receiver_id),
    constraint friend_requests_sender_profiles_fkey
        foreign key (sender_id) references public.profiles(id) on delete cascade,
    constraint friend_requests_receiver_profiles_fkey
        foreign key (receiver_id) references public.profiles(id) on delete cascade
);

create unique index friend_requests_pair_idx
    on public.friend_requests (
        least(sender_id, receiver_id),
        greatest(sender_id, receiver_id)
    );

create index friend_requests_receiver_status_idx
    on public.friend_requests (receiver_id, status);
create index friend_requests_sender_status_idx
    on public.friend_requests (sender_id, status);

alter table public.friend_requests enable row level security;

create policy "friend_requests_select_party" on public.friend_requests
    for select to authenticated
    using (auth.uid() = sender_id or auth.uid() = receiver_id);

create policy "friend_requests_insert_sender" on public.friend_requests
    for insert to authenticated
    with check (auth.uid() = sender_id and status = 'pending');

create policy "friend_requests_delete_sender_pending" on public.friend_requests
    for delete to authenticated
    using (auth.uid() = sender_id and status = 'pending');

create policy "friend_requests_update_receiver" on public.friend_requests
    for update to authenticated
    using (auth.uid() = receiver_id)
    with check (auth.uid() = receiver_id);

create or replace function public.enforce_friend_request_transition()
returns trigger language plpgsql as $$
begin
    if new.status = old.status
        and new.sender_id = old.sender_id
        and new.receiver_id = old.receiver_id then
        return new;
    end if;

    if old.status = 'pending'
        and new.status in ('accepted', 'rejected')
        and new.sender_id = old.sender_id
        and new.receiver_id = old.receiver_id then
        return new;
    end if;

    raise exception 'illegal friend_request transition % -> %', old.status, new.status;
end;
$$;

create trigger friend_requests_enforce_transition
before update on public.friend_requests
for each row execute function public.enforce_friend_request_transition();

create trigger friend_requests_set_updated_at
before update on public.friend_requests
for each row execute function public.set_updated_at();

create or replace function public.accept_friend_request(request_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
    r public.friend_requests%rowtype;
    a uuid;
    b uuid;
begin
    select * into r from public.friend_requests where id = request_id;
    if not found then
        raise exception 'request not found';
    end if;
    if r.receiver_id <> auth.uid() then
        raise exception 'not authorized';
    end if;
    if r.status <> 'pending' then
        raise exception 'request is not pending';
    end if;

    update public.friend_requests
        set status = 'accepted'
        where id = request_id;

    a := least(r.sender_id, r.receiver_id);
    b := greatest(r.sender_id, r.receiver_id);

    insert into public.friends (user_id_a, user_id_b)
        values (a, b)
        on conflict do nothing;
end;
$$;
