-- Haunt ghosts move off `vertices` (where they were a 'ghost' building and so
-- couldn't share a corner) into `players[i].ghosts` — see
-- .claude/specs/haunt-shared-ghosts.md.
--
-- Deploy the edge function right after this: the old one reads ghosts off
-- `vertices`, the new one would score a leftover 'ghost' vertex as a settlement.
-- SET expressions all read the pre-update row, so `players` sees the ghosts
-- that `vertices` drops.

update public.game_states gs
set
	players = (
		select jsonb_agg(
			case
				when g.ghosts is null then e.p
				else e.p || jsonb_build_object(
					'ghosts',
					coalesce(e.p -> 'ghosts', '[]'::jsonb) || g.ghosts
				)
			end
			order by e.ord
		)
		from jsonb_array_elements(gs.players) with ordinality as e (p, ord)
		left join lateral (
			select jsonb_agg(v.key order by v.key) as ghosts
			from jsonb_each(gs.vertices) v
			where v.value ->> 'building' = 'ghost'
				and (v.value ->> 'player')::int = e.ord - 1
		) g on true
	),
	vertices = (
		select coalesce(jsonb_object_agg(v.key, v.value), '{}'::jsonb)
		from jsonb_each(gs.vertices) v
		where v.value ->> 'building' is distinct from 'ghost'
	)
where exists (
	select 1
	from jsonb_each(gs.vertices) v
	where v.value ->> 'building' = 'ghost'
);
