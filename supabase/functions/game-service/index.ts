// game-service: a single edge function that handles every write to the games
// subsystem. Actions dispatch on `body.action`. All mutations go through the
// service-role admin client (bypassing RLS) after we authenticate the caller
// from their forwarded JWT.
//
// Actions:
//   - respond: update a game_request's invited[] entry; if fully accepted,
//     materialize the games row and kick off the setup finalizer.
//   - roll: on the caller's turn, roll 1-6 and advance / complete the game.
//
// Internal helper (not an external action):
//   - finalizeSetup: after a 3s delay, shuffle player_order and go active.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { delay } from 'https://deno.land/std@0.177.0/async/delay.ts'
import {
	createClient,
	SupabaseClient,
} from 'https://esm.sh/@supabase/supabase-js@2'

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void }

type InvitedEntry = {
	user: string
	status: 'pending' | 'accepted' | 'rejected'
}

type GameEvent =
	| { kind: 'setup_complete'; at: string }
	| {
			kind: 'roll'
			player_index: number
			value: number
			new_score: number
			at: string
	  }
	| { kind: 'game_complete'; winner_index: number; at: string }

type RespondBody = { action: 'respond'; request_id: string; accept: boolean }
type RollBody = { action: 'roll'; game_id: string }
type Body = RespondBody | RollBody

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers':
		'authorization, x-client-info, apikey, content-type',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', ...CORS_HEADERS },
	})
}

function err(status: number, message: string) {
	return json({ ok: false, error: message }, status)
}

function adminClient(): SupabaseClient {
	return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
		auth: { persistSession: false },
	})
}

async function callerUserId(req: Request): Promise<string | null> {
	const authHeader = req.headers.get('Authorization')
	if (!authHeader) return null
	const token = authHeader.replace(/^Bearer\s+/i, '').trim()
	if (!token) return null
	const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
		headers: {
			Authorization: `Bearer ${token}`,
			apikey: ANON_KEY,
		},
	})
	if (!res.ok) return null
	const user = (await res.json()) as { id?: string }
	return user.id ?? null
}

function shuffle<T>(xs: T[]): T[] {
	const a = [...xs]
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		;[a[i], a[j]] = [a[j], a[i]]
	}
	return a
}

function rollDie(): number {
	const buf = new Uint32Array(1)
	crypto.getRandomValues(buf)
	return (buf[0] % 6) + 1
}

async function handleRespond(
	admin: SupabaseClient,
	me: string,
	body: RespondBody
): Promise<Response> {
	const { data: request, error: loadErr } = await admin
		.from('game_requests')
		.select('*')
		.eq('id', body.request_id)
		.maybeSingle()
	if (loadErr) return err(500, 'load failed')
	if (!request) return err(404, 'request not found')

	const invited = request.invited as InvitedEntry[]
	const meIdx = invited.findIndex((e) => e.user === me)
	if (meIdx < 0) return err(400, 'not invited')
	if (invited[meIdx].status !== 'pending')
		return err(400, 'already responded')

	const nextStatus: InvitedEntry['status'] = body.accept
		? 'accepted'
		: 'rejected'
	const nextInvited: InvitedEntry[] = invited.map((e, i) =>
		i === meIdx ? { ...e, status: nextStatus } : e
	)

	const allAccepted =
		body.accept && nextInvited.every((e) => e.status === 'accepted')

	if (allAccepted) {
		const participants = [
			request.proposer,
			...nextInvited.map((e) => e.user),
		]
		const { data: inserted, error: insertErr } = await admin
			.from('games')
			.insert({ participants, status: 'setup' })
			.select('id')
			.single()
		if (insertErr || !inserted) return err(500, 'could not create game')

		const { error: delErr } = await admin
			.from('game_requests')
			.delete()
			.eq('id', body.request_id)
		if (delErr) return err(500, 'could not clear request')

		EdgeRuntime.waitUntil(finalizeSetup(inserted.id))
		return json({ ok: true, game_id: inserted.id })
	}

	const { error: updateErr } = await admin
		.from('game_requests')
		.update({ invited: nextInvited })
		.eq('id', body.request_id)
	if (updateErr) return err(500, 'could not update request')

	return json({ ok: true })
}

async function finalizeSetup(gameId: string): Promise<void> {
	await delay(3000)
	const admin = adminClient()
	const { data: game, error: loadErr } = await admin
		.from('games')
		.select('*')
		.eq('id', gameId)
		.maybeSingle()
	if (loadErr || !game) return
	if (game.status !== 'setup') return

	const playerOrder = shuffle(game.participants as string[])
	const scores = playerOrder.map(() => 0)
	const events = [
		...(game.events as GameEvent[]),
		{
			kind: 'setup_complete',
			at: new Date().toISOString(),
		} satisfies GameEvent,
	]

	await admin
		.from('games')
		.update({
			player_order: playerOrder,
			scores,
			current_turn: 0,
			events,
			status: 'active',
		})
		.eq('id', gameId)
		.eq('status', 'setup')
}

async function handleRoll(
	admin: SupabaseClient,
	me: string,
	body: RollBody
): Promise<Response> {
	const { data: game, error: loadErr } = await admin
		.from('games')
		.select('*')
		.eq('id', body.game_id)
		.maybeSingle()
	if (loadErr) return err(500, 'load failed')
	if (!game) return err(404, 'game not found')
	if (game.status !== 'active') return err(400, 'game not active')

	const playerOrder = game.player_order as string[]
	const currentTurn = game.current_turn as number | null
	if (currentTurn === null || playerOrder[currentTurn] !== me) {
		return err(400, 'not your turn')
	}

	const value = rollDie()
	const scores = [...(game.scores as number[])]
	scores[currentTurn] = scores[currentTurn] + value
	const newScore = scores[currentTurn]
	const at = new Date().toISOString()

	const events = [
		...(game.events as GameEvent[]),
		{
			kind: 'roll',
			player_index: currentTurn,
			value,
			new_score: newScore,
			at,
		} satisfies GameEvent,
	]

	if (newScore >= 10) {
		events.push({ kind: 'game_complete', winner_index: currentTurn, at })
		const { error: updErr } = await admin
			.from('games')
			.update({
				scores,
				events,
				status: 'complete',
				winner: currentTurn,
			})
			.eq('id', body.game_id)
		if (updErr) return err(500, 'update failed')
	} else {
		const nextTurn = (currentTurn + 1) % playerOrder.length
		const { error: updErr } = await admin
			.from('games')
			.update({ scores, events, current_turn: nextTurn })
			.eq('id', body.game_id)
		if (updErr) return err(500, 'update failed')
	}

	return json({ ok: true })
}

serve(async (req) => {
	if (req.method === 'OPTIONS') {
		return new Response('ok', { headers: CORS_HEADERS })
	}
	if (req.method !== 'POST') return err(405, 'method not allowed')

	const me = await callerUserId(req)
	if (!me) return err(401, 'not authenticated')

	let body: Body
	try {
		body = (await req.json()) as Body
	} catch {
		return err(400, 'invalid body')
	}

	const admin = adminClient()

	switch (body.action) {
		case 'respond':
			return handleRespond(admin, me, body)
		case 'roll':
			return handleRoll(admin, me, body)
		default:
			return err(400, 'unknown action')
	}
})
