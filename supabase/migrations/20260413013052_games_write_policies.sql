-- Add write policies so the games RPCs (security invoker) can mutate rows
-- under the caller's identity. Each policy mirrors what the RPC itself
-- authorizes internally.

-- game_requests: proposer creates the row.
create policy "game_requests_insert_proposer" on public.game_requests
    for insert to authenticated
    with check (auth.uid() = proposer);

-- game_requests: a party (proposer or an invited user) updates the row.
-- Used by respond_to_game_request when partial state changes.
create policy "game_requests_update_party" on public.game_requests
    for update to authenticated
    using (
        auth.uid() = proposer
        or exists (
            select 1
            from jsonb_array_elements(invited) elem
            where (elem->>'user')::uuid = auth.uid()
        )
    )
    with check (
        auth.uid() = proposer
        or exists (
            select 1
            from jsonb_array_elements(invited) elem
            where (elem->>'user')::uuid = auth.uid()
        )
    );

-- game_requests: a party deletes the row (used when respond_to_game_request
-- materializes the games row on full acceptance).
create policy "game_requests_delete_party" on public.game_requests
    for delete to authenticated
    using (
        auth.uid() = proposer
        or exists (
            select 1
            from jsonb_array_elements(invited) elem
            where (elem->>'user')::uuid = auth.uid()
        )
    );

-- games: a participant creates the row (used by respond_to_game_request on
-- full acceptance; caller is one of the participants).
create policy "games_insert_participant" on public.games
    for insert to authenticated
    with check (auth.uid() = any (participants));

-- games: a participant updates the row (used by complete_game).
create policy "games_update_participant" on public.games
    for update to authenticated
    using (auth.uid() = any (participants))
    with check (auth.uid() = any (participants));
