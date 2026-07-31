// reviewer-login: mints a session for the App Store reviewer account without
// an SMS round-trip. The login screen calls this when the reviewer phone
// number is entered and hands the returned tokens to `auth.setSession`.
//
// Phone-only accounts have no admin "create session" endpoint and no magic
// link (generateLink is email-only), so the session is minted the one way
// GoTrue allows: sign in server-side with a password. That password lives in
// this function's env and nowhere else — never in the app bundle — and is set
// alongside the account by `dev/seed-reviewer-login.mjs`. The password is
// deliberately *not* rotated per request: an admin password update revokes
// every other session on the account, which would sign the real owner out of
// their own device on each reviewer login.
//
// Anyone who extracts REVIEWER_KEY from the bundle can call this and get a
// session as REVIEWER_USER_ID — that is the same access the reviewer bypass
// grants by design, so the key is friction, not a security boundary.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers':
		'authorization, x-client-info, apikey, content-type, x-reviewer-key',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const REVIEWER_USER_ID = 'a49421db-f053-412d-8916-75f85c1932a5'

serve(async (req) => {
	if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
	if (req.method !== 'POST') return err(405, 'method')

	const expectedKey = Deno.env.get('REVIEWER_KEY')
	const password = Deno.env.get('REVIEWER_PASSWORD')
	if (!expectedKey || !password)
		return err(500, 'REVIEWER_KEY / REVIEWER_PASSWORD not configured')
	if (req.headers.get('x-reviewer-key') !== expectedKey)
		return err(401, 'bad reviewer key')

	const admin = createClient(
		Deno.env.get('SUPABASE_URL')!,
		Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
		{ auth: { persistSession: false, autoRefreshToken: false } }
	)
	const { data: userRes, error: getErr } =
		await admin.auth.admin.getUserById(REVIEWER_USER_ID)
	if (getErr || !userRes?.user)
		return err(500, getErr?.message ?? 'reviewer user not found')

	const phone = userRes.user.phone
	if (!phone) return err(500, 'reviewer user has no phone identity')

	const anon = createClient(
		Deno.env.get('SUPABASE_URL')!,
		Deno.env.get('SUPABASE_ANON_KEY')!,
		{ auth: { persistSession: false, autoRefreshToken: false } }
	)
	const { data, error } = await anon.auth.signInWithPassword({
		phone: `+${phone.replace(/^\+/, '')}`,
		password,
	})
	if (error || !data.session)
		return err(
			500,
			`${error?.message ?? 'no session'} — REVIEWER_PASSWORD may no longer match the account; re-run dev/seed-reviewer-login.mjs`
		)

	return new Response(
		JSON.stringify({
			ok: true,
			access_token: data.session.access_token,
			refresh_token: data.session.refresh_token,
		}),
		{ headers: { ...CORS, 'Content-Type': 'application/json' } }
	)
})

function err(status: number, message: string) {
	return new Response(JSON.stringify({ ok: false, error: message }), {
		status,
		headers: { ...CORS, 'Content-Type': 'application/json' },
	})
}
