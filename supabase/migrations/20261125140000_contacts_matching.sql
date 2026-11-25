-- Contacts onboarding + friend suggestions. See .claude/specs/contacts-onboarding.md.
--
-- Must be applied BEFORE the client that selects `contacts_onboarded_at`
-- ships: every profile load names the column explicitly, and a missing column
-- fails that load.

-- When the "find friends from contacts" prompt was shown. Null = never shown,
-- which is what lets existing accounts get it once, retroactively. Set on
-- show, not on answer, so a dismissal can never re-prompt.
alter table public.profiles
	add column contacts_onboarded_at timestamptz;

-- Per-user rolling quota on how many numbers `match_contacts` will check.
-- Contact discovery is inherently a phone → account oracle; this bounds how
-- fast one (phone-verified) account can enumerate it. Counts only — the
-- numbers themselves are never written anywhere.
create table public.contact_match_quota (
	user_id uuid primary key references public.profiles (id) on delete cascade,
	window_start timestamptz not null default now(),
	checked int not null default 0
);

-- Touched only by the definer function below: no policies.
alter table public.contact_match_quota enable row level security;

-- Phone numbers live in auth.users (SMS auth), which clients can't read, hence
-- security definer. Takes E.164 strings, returns the minimal public profile of
-- each matching account the caller could still send a request to — never a
-- phone number. `contact_index` is the position (0-based) of the first input
-- that matched, so the client can label the row with its own contact's name.
--
-- Excludes self, existing friends, and any pair that already has a
-- friend_requests row in either direction and any status: the pair-unique
-- index would reject a new request anyway (friends-service answers 409).
create or replace function public.match_contacts(
	p_phones text[],
	p_include_dev boolean default false
) returns table (
	id uuid,
	username text,
	avatar_path text,
	updated_at timestamptz,
	contact_index int
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
	me uuid := auth.uid();
	n int := coalesce(array_length(p_phones, 1), 0);
	used int;
begin
	if me is null then
		raise exception 'not authenticated' using errcode = '42501';
	end if;
	if n = 0 then
		return;
	end if;
	if n > 1000 then
		raise exception 'too many numbers' using errcode = '22023';
	end if;

	-- A raise rolls this increment back, so a refused call costs nothing.
	insert into public.contact_match_quota as q (user_id, window_start, checked)
	values (me, now(), n)
	on conflict (user_id) do update set
		window_start = case
			when q.window_start < now() - interval '1 day' then now()
			else q.window_start
		end,
		checked = case
			when q.window_start < now() - interval '1 day' then excluded.checked
			else q.checked + excluded.checked
		end
	returning q.checked into used;

	if used > 20000 then
		raise exception 'contact match quota exceeded' using errcode = '54000';
	end if;

	return query
	with input as (
		select distinct on (s.digits) s.digits, (s.ord - 1)::int as idx
		from (
			select regexp_replace(t.raw, '[^0-9]', '', 'g') as digits, t.ord
			from unnest(p_phones) with ordinality as t (raw, ord)
		) s
		where length(s.digits) between 8 and 15
		order by s.digits, s.ord
	),
	matched as (
		-- GoTrue stores phones as bare digits; the '+' form is belt and braces.
		select u.id as uid, min(i.idx) as idx
		from input i
		join auth.users u on u.phone in (i.digits, '+' || i.digits)
		where u.id <> me and u.deleted_at is null
		group by u.id
	)
	select p.id, p.username, p.avatar_path, p.updated_at, m.idx
	from matched m
	join public.profiles p on p.id = m.uid
	where (p_include_dev or not p.dev)
		and not exists (
			select 1 from public.friends f
			where f.user_id_a = least(me, p.id)
				and f.user_id_b = greatest(me, p.id)
		)
		and not exists (
			select 1 from public.friend_requests r
			where least(r.sender_id, r.receiver_id) = least(me, p.id)
				and greatest(r.sender_id, r.receiver_id) = greatest(me, p.id)
		)
	order by p.username;
end;
$$;

revoke all on function public.match_contacts(text[], boolean) from public, anon;
grant execute on function public.match_contacts(text[], boolean) to authenticated;
