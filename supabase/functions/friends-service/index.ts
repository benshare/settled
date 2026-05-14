// friends-service: server-mediated mutations for the friends subsystem.
// Today the only action is `send`, which inserts a friend_requests row and
// queues a push. Other friends-side actions (accept/reject/cancel) stay on
// their existing direct paths since none emit pushes in v1.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import {
	createClient,
	SupabaseClient,
} from 'https://esm.sh/@supabase/supabase-js@2'
import { sendNotifications } from '../_notify/index.ts'

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers':
		'authorization, x-client-info, apikey, content-type',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }

serve(async (req) => {
	if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
	if (req.method !== 'POST') return err(405, 'method')

	const auth = req.headers.get('Authorization')
	if (!auth) return err(401, 'no auth')

	const anon = createClient(
		Deno.env.get('SUPABASE_URL')!,
		Deno.env.get('SUPABASE_ANON_KEY')!,
		{ global: { headers: { Authorization: auth } } }
	)
	const { data: userRes } = await anon.auth.getUser()
	const me = userRes?.user?.id
	if (!me) return err(401, 'unauthenticated')

	const admin = createClient(
		Deno.env.get('SUPABASE_URL')!,
		Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
	)

	const body = await req.json().catch(() => null)
	if (!body || typeof body !== 'object') return err(400, 'bad body')

	switch ((body as { action?: unknown }).action) {
		case 'send':
			return handleSend(
				admin,
				me,
				(body as { target_id?: unknown }).target_id
			)
		default:
			return err(400, 'unknown action')
	}
})

async function handleSend(
	admin: SupabaseClient,
	me: string,
	targetId: unknown
): Promise<Response> {
	if (typeof targetId !== 'string') return err(400, 'bad target')
	if (targetId === me) return err(400, 'self')

	// Service role bypasses RLS, so the unique-pair index is the live guard
	// against duplicates (pending or rejected). Surfaces as Postgres 23505.
	const { data, error } = await admin
		.from('friend_requests')
		.insert({ sender_id: me, receiver_id: targetId })
		.select('id')
		.single()
	if (error) {
		if (error.code === '23505') return err(409, 'duplicate')
		return err(500, error.message || 'insert failed')
	}

	EdgeRuntime.waitUntil(
		sendNotifications(admin, [
			{
				userId: targetId,
				kind: 'friend_request',
				gate: 'friendRequest',
				senderProfileId: me,
			},
		])
	)

	return json({ ok: true, id: data.id })
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...CORS, 'Content-Type': 'application/json' },
	})
}

function err(status: number, message: string): Response {
	return json({ ok: false, error: message }, status)
}
