// dev-login: mints a session for an arbitrary account, so an admin build can
// "act as" any player from the user search (`lib/admin.ts`). Same shape as
// `reviewer-login` — no caller identity, so `verify_jwt = false` and it
// authorizes on a header — but the target is a request parameter (a profile
// uuid or a username), not a hardcoded id, so this hands out a session for ANY
// account. `DEV_LOGIN_KEY` therefore is a real security boundary, unlike
// `REVIEWER_KEY`: it must never ship in the app bundle. The app reads it from
// `.env` via `app.config.js` extra, which is populated locally and nowhere
// else. If the secret is unset the function is inert (500), so deploying it
// without setting the secret exposes nothing.
//
// The session is minted through a magic link — admin `generateLink`, redeemed
// by `verifyOtp` on the client — and NOT a password. Setting a password revokes
// every existing session for the account (GoTrue; supabase/auth#1579), which
// would sign the real owner out on their own devices on every first
// impersonation. `generateLink` needs an email, so a phone-signup account with
// none gets a namespaced synthetic one the first time; unlike a password
// change, setting an email leaves the account's existing sessions intact. The
// function returns the link's `token_hash` rather than a session, since only
// the client that will hold the session can redeem it.

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

	// `generateLink` keys off an email. These are phone-signup accounts, so most
	// have none — give them a namespaced synthetic one the first time. This never
	// overwrites a real email, and (unlike a password change) does not revoke the
	// account's sessions, so the real owner stays signed in on their own devices.
	let email = userRes.user.email
	if (!email) {
		email = `impersonate+${userId}@settled.invalid`
		const { error: updErr } = await admin.auth.admin.updateUserById(
			userId,
			{
				email,
				email_confirm: true,
			}
		)
		if (updErr) return err(500, updErr.message)
	}

	const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
		type: 'magiclink',
		email,
	})
	const tokenHash = link?.properties?.hashed_token
	if (linkErr || !tokenHash)
		return err(500, linkErr?.message ?? 'could not generate magic link')

	return new Response(
		JSON.stringify({
			ok: true,
			token_hash: tokenHash,
			user_id: userId,
			username: profile?.username ?? null,
			dev: profile?.dev ?? false,
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
