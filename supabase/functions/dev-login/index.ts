// dev-login: mints a session for an arbitrary account, so an admin build can
// "act as" any player from the user search (`lib/admin.ts`). Same shape as
// `reviewer-login` — no caller identity, so `verify_jwt = false` and it
// authorizes on a header — but two things differ.
//
// 1. The target is a request parameter (a profile uuid or a username), not a
//    hardcoded id, so this hands out a session for ANY account. `DEV_LOGIN_KEY`
//    therefore is a real security boundary, unlike `REVIEWER_KEY`: it must
//    never ship in the app bundle. The app reads it from `.env` via
//    `app.config.js` extra, which is populated locally and nowhere else. If the
//    secret is unset the function is inert (500), so deploying it without
//    setting the secret exposes nothing.
// 2. The password is derived, not stored: HMAC(DEV_LOGIN_KEY, userId). Knowing
//    one account's password tells you nothing about another's, and rotating the
//    key invalidates every derived password at once.
//
// Sign-in is attempted BEFORE the password is set, so an account that has been
// impersonated once is never written to again. That matters because GoTrue
// revokes every session on an admin password change — impersonating a real
// player signs them out on their own devices, but only the first time.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers':
		'authorization, x-client-info, apikey, content-type, x-dev-key',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

serve(async (req) => {
	if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
	if (req.method !== 'POST') return err(405, 'method')

	const devKey = Deno.env.get('DEV_LOGIN_KEY')
	if (!devKey) return err(500, 'DEV_LOGIN_KEY not configured')
	if (req.headers.get('x-dev-key') !== devKey)
		return err(401, 'bad dev login key')

	let player: unknown
	try {
		player = (await req.json())?.player
	} catch {
		return err(400, 'body must be JSON')
	}
	if (typeof player !== 'string' || !player.trim())
		return err(400, 'player is required')
	const target = player.trim()

	const admin = createClient(
		Deno.env.get('SUPABASE_URL')!,
		Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
		{ auth: { persistSession: false, autoRefreshToken: false } }
	)

	// A uuid is taken as the id directly — the profile row is only read for the
	// label sent back, and an auth user with no profile yet is still valid.
	let userId = target
	let profile: { id: string; username: string; dev: boolean } | null = null
	if (UUID_RE.test(target)) {
		const { data } = await admin
			.from('profiles')
			.select('id, username, dev')
			.eq('id', target)
			.maybeSingle()
		profile = data
	} else {
		const { data, error } = await admin
			.from('profiles')
			.select('id, username, dev')
			.ilike('username', target)
			.maybeSingle()
		if (error) return err(500, error.message)
		if (!data) return err(404, `no profile with username "${target}"`)
		profile = data
		userId = data.id
	}

	const { data: userRes, error: getErr } =
		await admin.auth.admin.getUserById(userId)
	if (getErr || !userRes?.user)
		return err(404, getErr?.message ?? `no auth user with id ${userId}`)

	const phone = userRes.user.phone
	if (!phone) return err(400, 'that account has no phone identity')

	const anon = createClient(
		Deno.env.get('SUPABASE_URL')!,
		Deno.env.get('SUPABASE_ANON_KEY')!,
		{ auth: { persistSession: false, autoRefreshToken: false } }
	)
	const credentials = {
		phone: `+${phone.replace(/^\+/, '')}`,
		password: await derivePassword(devKey, userId),
	}

	let rotated = false
	let { data, error } = await anon.auth.signInWithPassword(credentials)
	if (error) {
		const { error: updErr } = await admin.auth.admin.updateUserById(
			userId,
			{
				password: credentials.password,
			}
		)
		if (updErr) return err(500, updErr.message)
		rotated = true
		;({ data, error } = await anon.auth.signInWithPassword(credentials))
	}
	if (error || !data.session) return err(500, error?.message ?? 'no session')

	return new Response(
		JSON.stringify({
			ok: true,
			access_token: data.session.access_token,
			refresh_token: data.session.refresh_token,
			user_id: userId,
			username: profile?.username ?? null,
			dev: profile?.dev ?? false,
			// True when this account had no derived password yet, i.e. its other
			// sessions were just revoked. The app ignores it; it's here so a
			// manual call can tell whether it just signed someone out.
			rotated,
		}),
		{ headers: { ...CORS, 'Content-Type': 'application/json' } }
	)
})

// The `Dev1!` prefix covers upper/lower/digit/symbol so the result satisfies any
// password-strength policy the project may turn on later; the hex carries the
// entropy.
async function derivePassword(secret: string, userId: string) {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	)
	const sig = await crypto.subtle.sign(
		'HMAC',
		key,
		new TextEncoder().encode(userId)
	)
	const hex = Array.from(new Uint8Array(sig))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
	return `Dev1!${hex}`
}

function err(status: number, message: string) {
	return new Response(JSON.stringify({ ok: false, error: message }), {
		status,
		headers: { ...CORS, 'Content-Type': 'application/json' },
	})
}
