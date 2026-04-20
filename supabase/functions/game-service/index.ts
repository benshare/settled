// game-service: single edge function for every write to the games subsystem.
// Dispatches on body.action. Authenticates the caller via their JWT, then
// mutates via the service-role admin client (bypassing RLS).
//
// Actions:
//   - respond: update a game_request's invited[] entry; on full acceptance,
//     insert both the games row (status='placement', shuffled player_order)
//     and the game_states row (generated standard board, blank placements,
//     zeroed hands, initial-placement phase), and delete the request.
//   - place_settlement: place the current player's settlement at `vertex`
//     during initial placement. Grants starting resources on the second
//     settlement. Advances phase.step to 'road'.
//   - place_road: place the current player's road on `edge` incident to
//     their just-placed settlement. Advances snake-order turn; on the final
//     road, transitions the game to status='active' / phase='roll'.
//   - roll: during phase='roll', rolls 2d6, distributes resources to every
//     settlement/city adjacent to a matching hex, transitions to phase='main'.
//     A 7 is a no-op (robber deferred).
//   - end_turn: during phase='main', clears lastRoll, transitions phase to
//     'roll', and advances current_turn to the next player (wrap-around).
//   - build_road / build_settlement / build_city: during phase='main' and on
//     the caller's turn, validates the spot + resources, deducts cost, and
//     writes the piece. No victory check in this pass.
//   - propose_trade / accept_trade / cancel_trade: single open trade offer
//     per game, proposed by the current main-phase player. Accept or cancel
//     clears the offer; end_turn clears it too.
//
// The board/resource/number constants below are duplicated from lib/catan
// because the Supabase functions directory lives outside the TS project and
// imports up-tree aren't reliable under the Deno bundler. Raw data lives in
// adjacentVertices (+ EDGES); the other adjacency maps are derived by the
// same IIFE pattern used in lib/catan/board.ts.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import {
	createClient,
	SupabaseClient,
} from 'https://esm.sh/@supabase/supabase-js@2'

type InvitedEntry = {
	user: string
	status: 'pending' | 'accepted' | 'rejected'
}

type RespondBody = { action: 'respond'; request_id: string; accept: boolean }
type PlaceSettlementBody = {
	action: 'place_settlement'
	game_id: string
	vertex: string
}
type PlaceRoadBody = {
	action: 'place_road'
	game_id: string
	edge: string
}
type RollBody = { action: 'roll'; game_id: string }
type EndTurnBody = { action: 'end_turn'; game_id: string }
type BuildRoadBody = { action: 'build_road'; game_id: string; edge: string }
type BuildSettlementBody = {
	action: 'build_settlement'
	game_id: string
	vertex: string
}
type BuildCityBody = {
	action: 'build_city'
	game_id: string
	vertex: string
}
type ProposeTradeBody = {
	action: 'propose_trade'
	game_id: string
	give: ResourceHand
	receive: ResourceHand
	to: number[]
}
type AcceptTradeBody = {
	action: 'accept_trade'
	game_id: string
	offer_id: string
}
type CancelTradeBody = {
	action: 'cancel_trade'
	game_id: string
	offer_id: string
}
type Body =
	| RespondBody
	| PlaceSettlementBody
	| PlaceRoadBody
	| RollBody
	| EndTurnBody
	| BuildRoadBody
	| BuildSettlementBody
	| BuildCityBody
	| ProposeTradeBody
	| AcceptTradeBody
	| CancelTradeBody

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

function shuffle<T>(xs: readonly T[]): T[] {
	const a = [...xs]
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		;[a[i], a[j]] = [a[j], a[i]]
	}
	return a
}

// --- Catan constants (duplicated from lib/catan) ---------------------------

const HEXES = [
	'1A',
	'1B',
	'1C',
	'2A',
	'2B',
	'2C',
	'2D',
	'3A',
	'3B',
	'3C',
	'3D',
	'3E',
	'4A',
	'4B',
	'4C',
	'4D',
	'5A',
	'5B',
	'5C',
] as const
type Hex = (typeof HEXES)[number]

const VERTICES = [
	'1A',
	'1B',
	'1C',
	'1D',
	'1E',
	'1F',
	'1G',
	'2A',
	'2B',
	'2C',
	'2D',
	'2E',
	'2F',
	'2G',
	'2H',
	'2I',
	'3A',
	'3B',
	'3C',
	'3D',
	'3E',
	'3F',
	'3G',
	'3H',
	'3I',
	'3J',
	'3K',
	'4A',
	'4B',
	'4C',
	'4D',
	'4E',
	'4F',
	'4G',
	'4H',
	'4I',
	'4J',
	'4K',
	'5A',
	'5B',
	'5C',
	'5D',
	'5E',
	'5F',
	'5G',
	'5H',
	'5I',
	'6A',
	'6B',
	'6C',
	'6D',
	'6E',
	'6F',
	'6G',
] as const
type Vertex = (typeof VERTICES)[number]

const EDGES = [
	'1A - 1B',
	'1A - 2B',
	'1B - 1C',
	'1C - 1D',
	'1C - 2D',
	'1D - 1E',
	'1E - 1F',
	'1E - 2F',
	'1F - 1G',
	'1G - 2H',
	'2A - 2B',
	'2A - 3B',
	'2B - 2C',
	'2C - 2D',
	'2C - 3D',
	'2D - 2E',
	'2E - 2F',
	'2E - 3F',
	'2F - 2G',
	'2G - 2H',
	'2G - 3H',
	'2H - 2I',
	'2I - 3J',
	'3A - 3B',
	'3A - 4A',
	'3B - 3C',
	'3C - 3D',
	'3C - 4C',
	'3D - 3E',
	'3E - 3F',
	'3E - 4E',
	'3F - 3G',
	'3G - 3H',
	'3G - 4G',
	'3H - 3I',
	'3I - 3J',
	'3I - 4I',
	'3J - 3K',
	'3K - 4K',
	'4A - 4B',
	'4B - 4C',
	'4B - 5A',
	'4C - 4D',
	'4D - 4E',
	'4D - 5C',
	'4E - 4F',
	'4F - 4G',
	'4F - 5E',
	'4G - 4H',
	'4H - 4I',
	'4H - 5G',
	'4I - 4J',
	'4J - 4K',
	'4J - 5I',
	'5A - 5B',
	'5B - 5C',
	'5B - 6A',
	'5C - 5D',
	'5D - 5E',
	'5D - 6C',
	'5E - 5F',
	'5F - 5G',
	'5F - 6E',
	'5G - 5H',
	'5H - 5I',
	'5H - 6G',
	'6A - 6B',
	'6B - 6C',
	'6C - 6D',
	'6D - 6E',
	'6E - 6F',
	'6F - 6G',
] as const
type Edge = (typeof EDGES)[number]

type Resource = 'brick' | 'wood' | 'sheep' | 'wheat' | 'ore'

const RESOURCES: readonly Resource[] = [
	'brick',
	'wood',
	'sheep',
	'wheat',
	'ore',
]

const STANDARD_RESOURCE_COUNTS: Record<Resource, number> = {
	brick: 3,
	wood: 4,
	sheep: 4,
	wheat: 4,
	ore: 3,
}

const STANDARD_NUMBERS = [
	2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12,
] as const

type HexData = { resource: null } | { resource: Resource; number: number }

// Each hex's 6 corner vertices in clockwise order. Hand-authored; everything
// else below derives from this + EDGES. Source of truth is lib/catan/board.ts.
const adjacentVertices: Record<Hex, readonly Vertex[]> = {
	'1A': ['1B', '1C', '2D', '2C', '2B', '1A'],
	'1B': ['1D', '1E', '2F', '2E', '2D', '1C'],
	'1C': ['1F', '1G', '2H', '2G', '2F', '1E'],
	'2A': ['2B', '2C', '3D', '3C', '3B', '2A'],
	'2B': ['2D', '2E', '3F', '3E', '3D', '2C'],
	'2C': ['2F', '2G', '3H', '3G', '3F', '2E'],
	'2D': ['2H', '2I', '3J', '3I', '3H', '2G'],
	'3A': ['3B', '3C', '4C', '4B', '4A', '3A'],
	'3B': ['3D', '3E', '4E', '4D', '4C', '3C'],
	'3C': ['3F', '3G', '4G', '4F', '4E', '3E'],
	'3D': ['3H', '3I', '4I', '4H', '4G', '3G'],
	'3E': ['3J', '3K', '4K', '4J', '4I', '3I'],
	'4A': ['4C', '4D', '5C', '5B', '5A', '4B'],
	'4B': ['4E', '4F', '5E', '5D', '5C', '4D'],
	'4C': ['4G', '4H', '5G', '5F', '5E', '4F'],
	'4D': ['4I', '4J', '5I', '5H', '5G', '4H'],
	'5A': ['5C', '5D', '6C', '6B', '6A', '5B'],
	'5B': ['5E', '5F', '6E', '6D', '6C', '5D'],
	'5C': ['5G', '5H', '6G', '6F', '6E', '5F'],
}

function edgeEndpoints(e: Edge): [Vertex, Vertex] {
	const [a, b] = e.split(' - ') as [Vertex, Vertex]
	return [a, b]
}

const adjacentHexes: Record<Vertex, readonly Hex[]> = (() => {
	const out: Record<Vertex, Hex[]> = Object.fromEntries(
		VERTICES.map((v) => [v, [] as Hex[]])
	) as Record<Vertex, Hex[]>
	for (const h of HEXES) {
		for (const v of adjacentVertices[h]) out[v].push(h)
	}
	return out
})()

const neighborVertices: Record<Vertex, readonly Vertex[]> = (() => {
	const out: Record<Vertex, Vertex[]> = Object.fromEntries(
		VERTICES.map((v) => [v, [] as Vertex[]])
	) as Record<Vertex, Vertex[]>
	for (const e of EDGES) {
		const [a, b] = edgeEndpoints(e)
		out[a].push(b)
		out[b].push(a)
	}
	return out
})()

const adjacentEdges: Record<Vertex, readonly Edge[]> = (() => {
	const out: Record<Vertex, Edge[]> = Object.fromEntries(
		VERTICES.map((v) => [v, [] as Edge[]])
	) as Record<Vertex, Edge[]>
	for (const e of EDGES) {
		const [a, b] = edgeEndpoints(e)
		out[a].push(e)
		out[b].push(e)
	}
	return out
})()

// --- Game state shapes (duplicated from lib/catan/types) -------------------

type VertexState =
	| { occupied: false }
	| { occupied: true; player: number; building: 'settlement' | 'city' }

type EdgeState = { occupied: false } | { occupied: true; player: number }

type ResourceHand = Record<Resource, number>

type PlayerState = { resources: ResourceHand }

type DieFace = 1 | 2 | 3 | 4 | 5 | 6
type DiceRoll = { a: DieFace; b: DieFace }

type TradeOffer = {
	id: string
	from: number
	to: number[]
	give: ResourceHand
	receive: ResourceHand
	createdAt: string
}

type Phase =
	| { kind: 'initial_placement'; round: 1 | 2; step: 'settlement' | 'road' }
	| { kind: 'roll' }
	| { kind: 'main'; roll: DiceRoll; trade: TradeOffer | null }
	| { kind: 'game_over' }

type GameState = {
	variant: string
	hexes: Record<Hex, HexData>
	vertices: Partial<Record<Vertex, VertexState>>
	edges: Partial<Record<Edge, EdgeState>>
	players: PlayerState[]
	phase: Phase
}

function vertexStateOf(state: GameState, v: Vertex): VertexState {
	return state.vertices[v] ?? { occupied: false }
}

function edgeStateOf(state: GameState, e: Edge): EdgeState {
	return state.edges[e] ?? { occupied: false }
}

// --- Placement rules (must match lib/catan/placement) ----------------------

function isValidSettlementVertex(state: GameState, v: Vertex): boolean {
	if (vertexStateOf(state, v).occupied) return false
	for (const n of neighborVertices[v]) {
		if (vertexStateOf(state, n).occupied) return false
	}
	return true
}

function targetSettlement(state: GameState, playerIdx: number): Vertex | null {
	let found: Vertex | null = null
	for (const v of VERTICES) {
		const vs = vertexStateOf(state, v)
		if (!vs.occupied || vs.player !== playerIdx) continue
		const hasOwnRoad = adjacentEdges[v].some((e) => {
			const es = edgeStateOf(state, e)
			return es.occupied && es.player === playerIdx
		})
		if (hasOwnRoad) continue
		if (found) return found
		found = v
	}
	return found
}

function isValidRoadEdge(
	state: GameState,
	playerIdx: number,
	edge: Edge
): boolean {
	const target = targetSettlement(state, playerIdx)
	if (!target) return false
	if (!adjacentEdges[target].includes(edge)) return false
	return !edgeStateOf(state, edge).occupied
}

function startingResourcesForVertex(
	state: GameState,
	vertex: Vertex
): ResourceHand {
	const hand: ResourceHand = {
		brick: 0,
		wood: 0,
		sheep: 0,
		wheat: 0,
		ore: 0,
	}
	for (const h of adjacentHexes[vertex]) {
		const hd = state.hexes[h]
		if (hd.resource === null) continue
		hand[hd.resource] += 1
	}
	return hand
}

function nextPlacementTurn(
	round: 1 | 2,
	currentTurn: number,
	playerCount: number
): { round: 1 | 2; currentTurn: number } | null {
	if (round === 1) {
		if (currentTurn < playerCount - 1) {
			return { round: 1, currentTurn: currentTurn + 1 }
		}
		return { round: 2, currentTurn: playerCount - 1 }
	}
	if (currentTurn > 0) {
		return { round: 2, currentTurn: currentTurn - 1 }
	}
	return null
}

// --- Roll / main-phase rules (must match lib/catan/roll) ------------------

function rollDice(): DiceRoll {
	const d = () => (1 + Math.floor(Math.random() * 6)) as DieFace
	return { a: d(), b: d() }
}

function distributeResources(
	state: GameState,
	total: number
): Record<number, ResourceHand> {
	const result: Record<number, ResourceHand> = {}
	if (total === 7) return result
	for (const hex of HEXES) {
		const hd = state.hexes[hex]
		if (hd.resource === null) continue
		if (hd.number !== total) continue
		for (const v of adjacentVertices[hex]) {
			const vs = vertexStateOf(state, v)
			if (!vs.occupied) continue
			const gain = vs.building === 'city' ? 2 : 1
			const hand =
				result[vs.player] ??
				(result[vs.player] = {
					brick: 0,
					wood: 0,
					sheep: 0,
					wheat: 0,
					ore: 0,
				})
			hand[hd.resource] += gain
		}
	}
	return result
}

function nextMainTurn(currentTurn: number, playerCount: number): number {
	return (currentTurn + 1) % playerCount
}

// --- Build rules (must match lib/catan/build) ------------------------------

type BuildKind = 'road' | 'settlement' | 'city'

const BUILD_COSTS: Record<BuildKind, ResourceHand> = {
	road: { brick: 1, wood: 1, sheep: 0, wheat: 0, ore: 0 },
	settlement: { brick: 1, wood: 1, sheep: 1, wheat: 1, ore: 0 },
	city: { brick: 0, wood: 0, sheep: 0, wheat: 2, ore: 3 },
}

function canAfford(hand: ResourceHand, cost: ResourceHand): boolean {
	for (const r of RESOURCES) if (hand[r] < cost[r]) return false
	return true
}

function deductHand(hand: ResourceHand, cost: ResourceHand): ResourceHand {
	const out = { ...hand }
	for (const r of RESOURCES) out[r] = hand[r] - cost[r]
	return out
}

function roadConnectsVia(
	state: GameState,
	playerIdx: number,
	edge: Edge,
	vertex: Vertex
): boolean {
	const vs = vertexStateOf(state, vertex)
	if (vs.occupied) return vs.player === playerIdx
	for (const e of adjacentEdges[vertex]) {
		if (e === edge) continue
		const es = edgeStateOf(state, e)
		if (es.occupied && es.player === playerIdx) return true
	}
	return false
}

function isValidBuildRoadEdge(
	state: GameState,
	playerIdx: number,
	edge: Edge
): boolean {
	if (edgeStateOf(state, edge).occupied) return false
	const [a, b] = edgeEndpoints(edge)
	return (
		roadConnectsVia(state, playerIdx, edge, a) ||
		roadConnectsVia(state, playerIdx, edge, b)
	)
}

function isValidBuildSettlementVertex(
	state: GameState,
	playerIdx: number,
	vertex: Vertex
): boolean {
	if (vertexStateOf(state, vertex).occupied) return false
	for (const n of neighborVertices[vertex]) {
		if (vertexStateOf(state, n).occupied) return false
	}
	return adjacentEdges[vertex].some((e) => {
		const es = edgeStateOf(state, e)
		return es.occupied && es.player === playerIdx
	})
}

function isValidBuildCityVertex(
	state: GameState,
	playerIdx: number,
	vertex: Vertex
): boolean {
	const vs = vertexStateOf(state, vertex)
	return (
		vs.occupied && vs.player === playerIdx && vs.building === 'settlement'
	)
}

// --- Trade rules (must match lib/catan/trade) ------------------------------

function isValidTradeShape(give: ResourceHand, receive: ResourceHand): boolean {
	let giveTotal = 0
	let receiveTotal = 0
	for (const r of RESOURCES) {
		if (give[r] < 0 || receive[r] < 0) return false
		if (give[r] > 0 && receive[r] > 0) return false
		giveTotal += give[r]
		receiveTotal += receive[r]
	}
	return giveTotal > 0 && receiveTotal > 0
}

function normalizeHand(input: unknown): ResourceHand | null {
	if (!input || typeof input !== 'object') return null
	const src = input as Record<string, unknown>
	const out: ResourceHand = {
		brick: 0,
		wood: 0,
		sheep: 0,
		wheat: 0,
		ore: 0,
	}
	for (const r of RESOURCES) {
		const v = src[r]
		if (v === undefined) continue
		if (
			typeof v !== 'number' ||
			!Number.isFinite(v) ||
			!Number.isInteger(v)
		) {
			return null
		}
		out[r] = v
	}
	return out
}

function applyTradeToPlayers(
	players: PlayerState[],
	fromIdx: number,
	toIdx: number,
	give: ResourceHand,
	receive: ResourceHand
): PlayerState[] {
	return players.map((p, i) => {
		if (i !== fromIdx && i !== toIdx) return p
		const deltaIn = i === fromIdx ? receive : give
		const deltaOut = i === fromIdx ? give : receive
		const next: ResourceHand = { ...p.resources }
		for (const r of RESOURCES) {
			next[r] = next[r] + deltaIn[r] - deltaOut[r]
		}
		return { ...p, resources: next }
	})
}

function isOfferAddressedTo(offer: TradeOffer, meIdx: number): boolean {
	if (meIdx === offer.from) return false
	if (offer.to.length === 0) return true
	return offer.to.includes(meIdx)
}

function newTradeId(): string {
	return Math.random().toString(36).slice(2, 10)
}

// --- Game generation -------------------------------------------------------

function generateHexes(): Record<Hex, HexData> {
	const bag: (Resource | null)[] = [null]
	for (const r of RESOURCES) {
		for (let i = 0; i < STANDARD_RESOURCE_COUNTS[r]; i++) bag.push(r)
	}
	const resources = shuffle(bag)
	const numbers = shuffle(STANDARD_NUMBERS)

	const out = {} as Record<Hex, HexData>
	let numIdx = 0
	for (let i = 0; i < HEXES.length; i++) {
		const hex = HEXES[i]
		const r = resources[i]
		if (r === null) out[hex] = { resource: null }
		else out[hex] = { resource: r, number: numbers[numIdx++] }
	}
	return out
}

function initialPlayers(count: number): PlayerState[] {
	return Array.from({ length: count }, () => ({
		resources: { brick: 0, wood: 0, sheep: 0, wheat: 0, ore: 0 },
	}))
}

const INITIAL_PHASE: Phase = {
	kind: 'initial_placement',
	round: 1,
	step: 'settlement',
}

// --- Actions ---------------------------------------------------------------

async function loadGame(
	admin: SupabaseClient,
	gameId: string
): Promise<
	| { ok: true; game: GameRow; state: GameState }
	| { ok: false; response: Response }
> {
	const { data: game, error: gErr } = await admin
		.from('games')
		.select('*')
		.eq('id', gameId)
		.maybeSingle()
	if (gErr) return { ok: false, response: err(500, 'load game failed') }
	if (!game) return { ok: false, response: err(404, 'game not found') }

	const { data: stateRow, error: sErr } = await admin
		.from('game_states')
		.select('*')
		.eq('game_id', gameId)
		.maybeSingle()
	if (sErr) return { ok: false, response: err(500, 'load state failed') }
	if (!stateRow)
		return { ok: false, response: err(404, 'game state not found') }

	// Normalize phase.main.trade for rows written before trade existed.
	const rawPhase = stateRow.phase as Phase
	const phase: Phase =
		rawPhase.kind === 'main' && rawPhase.trade === undefined
			? { ...rawPhase, trade: null }
			: rawPhase

	const state: GameState = {
		variant: stateRow.variant,
		hexes: stateRow.hexes,
		vertices: stateRow.vertices,
		edges: stateRow.edges,
		players: stateRow.players,
		phase,
	}
	return { ok: true, game: game as GameRow, state }
}

type GameRow = {
	id: string
	participants: string[]
	player_order: string[]
	current_turn: number | null
	status: 'placement' | 'active' | 'complete'
	winner: number | null
	events: unknown[]
}

function currentPlayerIndex(game: GameRow, me: string): number | null {
	const idx = game.player_order.indexOf(me)
	if (idx < 0) return null
	if (game.current_turn === null) return null
	return idx
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
		const playerOrder = shuffle(participants)

		const { data: inserted, error: insertErr } = await admin
			.from('games')
			.insert({
				participants,
				player_order: playerOrder,
				current_turn: 0,
				status: 'placement',
			})
			.select('id')
			.single()
		if (insertErr || !inserted) return err(500, 'could not create game')

		const { error: stateErr } = await admin.from('game_states').insert({
			game_id: inserted.id,
			variant: 'standard',
			hexes: generateHexes(),
			vertices: {},
			edges: {},
			players: initialPlayers(playerOrder.length),
			phase: INITIAL_PHASE,
		})
		if (stateErr) return err(500, 'could not create game state')

		const { error: delErr } = await admin
			.from('game_requests')
			.delete()
			.eq('id', body.request_id)
		if (delErr) return err(500, 'could not clear request')

		return json({ ok: true, game_id: inserted.id })
	}

	const { error: updateErr } = await admin
		.from('game_requests')
		.update({ invited: nextInvited })
		.eq('id', body.request_id)
	if (updateErr) return err(500, 'could not update request')

	return json({ ok: true })
}

async function handlePlaceSettlement(
	admin: SupabaseClient,
	me: string,
	body: PlaceSettlementBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	if (game.status !== 'placement') return err(400, 'not in placement')
	if (state.phase.kind !== 'initial_placement') return err(400, 'wrong phase')
	if (state.phase.step !== 'settlement')
		return err(400, 'expected settlement step')

	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (game.current_turn !== meIdx) return err(403, 'not your turn')

	if (!(VERTICES as readonly string[]).includes(body.vertex))
		return err(400, 'unknown vertex')
	const vertex = body.vertex as Vertex

	if (!isValidSettlementVertex(state, vertex))
		return err(400, 'invalid settlement placement')

	const round = state.phase.round
	const nextVertices = {
		...state.vertices,
		[vertex]: {
			occupied: true as const,
			player: meIdx,
			building: 'settlement' as const,
		},
	}

	let nextPlayers = state.players
	if (round === 2) {
		const grant = startingResourcesForVertex(state, vertex)
		nextPlayers = state.players.map((p, i) => {
			if (i !== meIdx) return p
			const r = p.resources
			return {
				...p,
				resources: {
					wood: r.wood + grant.wood,
					wheat: r.wheat + grant.wheat,
					sheep: r.sheep + grant.sheep,
					brick: r.brick + grant.brick,
					ore: r.ore + grant.ore,
				},
			}
		})
	}

	const nextPhase: Phase = {
		kind: 'initial_placement',
		round,
		step: 'road',
	}

	const { error: stateErr } = await admin
		.from('game_states')
		.update({
			vertices: nextVertices,
			players: nextPlayers,
			phase: nextPhase,
		})
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	const event = {
		kind: 'settlement_placed',
		player: meIdx,
		vertex,
		round,
		at: new Date().toISOString(),
	}
	const { error: gameErr } = await admin
		.from('games')
		.update({ events: [...(game.events ?? []), event] })
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')

	return json({ ok: true })
}

async function handlePlaceRoad(
	admin: SupabaseClient,
	me: string,
	body: PlaceRoadBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	if (game.status !== 'placement') return err(400, 'not in placement')
	if (state.phase.kind !== 'initial_placement') return err(400, 'wrong phase')
	if (state.phase.step !== 'road') return err(400, 'expected road step')

	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (game.current_turn !== meIdx) return err(403, 'not your turn')

	if (!(EDGES as readonly string[]).includes(body.edge))
		return err(400, 'unknown edge')
	const edge = body.edge as Edge

	if (!isValidRoadEdge(state, meIdx, edge))
		return err(400, 'invalid road placement')

	const round = state.phase.round
	const playerCount = game.player_order.length
	const next = nextPlacementTurn(round, game.current_turn!, playerCount)

	const nextEdges = {
		...state.edges,
		[edge]: { occupied: true as const, player: meIdx },
	}

	const roadEvent = {
		kind: 'road_placed',
		player: meIdx,
		edge,
		round,
		at: new Date().toISOString(),
	}

	if (next === null) {
		// Last placement — transition to active / roll.
		const { error: stateErr } = await admin
			.from('game_states')
			.update({
				edges: nextEdges,
				phase: { kind: 'roll' } satisfies Phase,
			})
			.eq('game_id', game.id)
		if (stateErr) return err(500, 'could not update state')

		const completeEvent = {
			kind: 'placement_complete',
			at: new Date().toISOString(),
		}
		const { error: gameErr } = await admin
			.from('games')
			.update({
				status: 'active',
				current_turn: 0,
				events: [...(game.events ?? []), roadEvent, completeEvent],
			})
			.eq('id', game.id)
		if (gameErr) return err(500, 'could not update game')

		return json({ ok: true })
	}

	const { error: stateErr } = await admin
		.from('game_states')
		.update({
			edges: nextEdges,
			phase: {
				kind: 'initial_placement',
				round: next.round,
				step: 'settlement',
			} satisfies Phase,
		})
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	const { error: gameErr } = await admin
		.from('games')
		.update({
			current_turn: next.currentTurn,
			events: [...(game.events ?? []), roadEvent],
		})
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not update game')

	return json({ ok: true })
}

async function handleRoll(
	admin: SupabaseClient,
	me: string,
	body: RollBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	if (game.status !== 'active') return err(400, 'not active')
	if (state.phase.kind !== 'roll') return err(400, 'expected roll phase')

	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (game.current_turn !== meIdx) return err(403, 'not your turn')

	const dice = rollDice()
	const total = dice.a + dice.b

	const gains = distributeResources(state, total)
	const nextPlayers = state.players.map((p, i) => {
		const g = gains[i]
		if (!g) return p
		const r = p.resources
		return {
			...p,
			resources: {
				wood: r.wood + g.wood,
				wheat: r.wheat + g.wheat,
				sheep: r.sheep + g.sheep,
				brick: r.brick + g.brick,
				ore: r.ore + g.ore,
			},
		}
	})

	const { error: stateErr } = await admin
		.from('game_states')
		.update({
			players: nextPlayers,
			phase: {
				kind: 'main',
				roll: dice,
				trade: null,
			} satisfies Phase,
		})
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	const rollEvent = {
		kind: 'rolled',
		player: meIdx,
		dice: [dice.a, dice.b],
		total,
		at: new Date().toISOString(),
	}
	const { error: gameErr } = await admin
		.from('games')
		.update({ events: [...(game.events ?? []), rollEvent] })
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')

	return json({ ok: true, dice, total })
}

async function handleEndTurn(
	admin: SupabaseClient,
	me: string,
	body: EndTurnBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	if (game.status !== 'active') return err(400, 'not active')
	if (state.phase.kind !== 'main') return err(400, 'expected main phase')

	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (game.current_turn !== meIdx) return err(403, 'not your turn')

	const nextTurn = nextMainTurn(game.current_turn!, game.player_order.length)

	const { error: stateErr } = await admin
		.from('game_states')
		.update({ phase: { kind: 'roll' } satisfies Phase })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	const endEvent = {
		kind: 'turn_ended',
		player: meIdx,
		at: new Date().toISOString(),
	}
	const { error: gameErr } = await admin
		.from('games')
		.update({
			current_turn: nextTurn,
			events: [...(game.events ?? []), endEvent],
		})
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not update game')

	return json({ ok: true })
}

async function preflightBuild(
	admin: SupabaseClient,
	me: string,
	gameId: string
): Promise<
	| { ok: true; game: GameRow; state: GameState; meIdx: number }
	| { ok: false; response: Response }
> {
	const loaded = await loadGame(admin, gameId)
	if (!loaded.ok) return loaded
	const { game, state } = loaded
	if (game.status !== 'active')
		return { ok: false, response: err(400, 'not active') }
	if (state.phase.kind !== 'main')
		return { ok: false, response: err(400, 'expected main phase') }
	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null)
		return { ok: false, response: err(403, 'not a participant') }
	if (game.current_turn !== meIdx)
		return { ok: false, response: err(403, 'not your turn') }
	return { ok: true, game, state, meIdx }
}

function applyCost(
	players: PlayerState[],
	meIdx: number,
	cost: ResourceHand
): PlayerState[] {
	return players.map((p, i) =>
		i === meIdx ? { ...p, resources: deductHand(p.resources, cost) } : p
	)
}

async function handleBuildRoad(
	admin: SupabaseClient,
	me: string,
	body: BuildRoadBody
): Promise<Response> {
	const pre = await preflightBuild(admin, me, body.game_id)
	if (!pre.ok) return pre.response
	const { game, state, meIdx } = pre

	if (!(EDGES as readonly string[]).includes(body.edge))
		return err(400, 'unknown edge')
	const edge = body.edge as Edge

	if (!isValidBuildRoadEdge(state, meIdx, edge))
		return err(400, 'invalid road')
	const cost = BUILD_COSTS.road
	if (!canAfford(state.players[meIdx].resources, cost))
		return err(400, 'insufficient resources')

	const nextEdges = {
		...state.edges,
		[edge]: { occupied: true as const, player: meIdx },
	}
	const nextPlayers = applyCost(state.players, meIdx, cost)

	const { error: stateErr } = await admin
		.from('game_states')
		.update({ edges: nextEdges, players: nextPlayers })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	const event = {
		kind: 'road_built',
		player: meIdx,
		edge,
		at: new Date().toISOString(),
	}
	const { error: gameErr } = await admin
		.from('games')
		.update({ events: [...(game.events ?? []), event] })
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')

	return json({ ok: true })
}

async function handleBuildSettlement(
	admin: SupabaseClient,
	me: string,
	body: BuildSettlementBody
): Promise<Response> {
	const pre = await preflightBuild(admin, me, body.game_id)
	if (!pre.ok) return pre.response
	const { game, state, meIdx } = pre

	if (!(VERTICES as readonly string[]).includes(body.vertex))
		return err(400, 'unknown vertex')
	const vertex = body.vertex as Vertex

	if (!isValidBuildSettlementVertex(state, meIdx, vertex))
		return err(400, 'invalid settlement')
	const cost = BUILD_COSTS.settlement
	if (!canAfford(state.players[meIdx].resources, cost))
		return err(400, 'insufficient resources')

	const nextVertices = {
		...state.vertices,
		[vertex]: {
			occupied: true as const,
			player: meIdx,
			building: 'settlement' as const,
		},
	}
	const nextPlayers = applyCost(state.players, meIdx, cost)

	const { error: stateErr } = await admin
		.from('game_states')
		.update({ vertices: nextVertices, players: nextPlayers })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	const event = {
		kind: 'settlement_built',
		player: meIdx,
		vertex,
		at: new Date().toISOString(),
	}
	const { error: gameErr } = await admin
		.from('games')
		.update({ events: [...(game.events ?? []), event] })
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')

	return json({ ok: true })
}

async function handleBuildCity(
	admin: SupabaseClient,
	me: string,
	body: BuildCityBody
): Promise<Response> {
	const pre = await preflightBuild(admin, me, body.game_id)
	if (!pre.ok) return pre.response
	const { game, state, meIdx } = pre

	if (!(VERTICES as readonly string[]).includes(body.vertex))
		return err(400, 'unknown vertex')
	const vertex = body.vertex as Vertex

	if (!isValidBuildCityVertex(state, meIdx, vertex))
		return err(400, 'invalid city target')
	const cost = BUILD_COSTS.city
	if (!canAfford(state.players[meIdx].resources, cost))
		return err(400, 'insufficient resources')

	const nextVertices = {
		...state.vertices,
		[vertex]: {
			occupied: true as const,
			player: meIdx,
			building: 'city' as const,
		},
	}
	const nextPlayers = applyCost(state.players, meIdx, cost)

	const { error: stateErr } = await admin
		.from('game_states')
		.update({ vertices: nextVertices, players: nextPlayers })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	const event = {
		kind: 'city_built',
		player: meIdx,
		vertex,
		at: new Date().toISOString(),
	}
	const { error: gameErr } = await admin
		.from('games')
		.update({ events: [...(game.events ?? []), event] })
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')

	return json({ ok: true })
}

async function handleProposeTrade(
	admin: SupabaseClient,
	me: string,
	body: ProposeTradeBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	if (game.status !== 'active') return err(400, 'not active')
	if (state.phase.kind !== 'main') return err(400, 'expected main phase')

	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (game.current_turn !== meIdx) return err(403, 'not your turn')

	const phase = state.phase
	if (phase.kind !== 'main') return err(400, 'expected main phase')
	if (phase.trade !== null) return err(400, 'trade already open')

	const give = normalizeHand(body.give)
	const receive = normalizeHand(body.receive)
	if (!give || !receive) return err(400, 'invalid resource hand')
	if (!isValidTradeShape(give, receive))
		return err(400, 'invalid trade shape')
	if (!canAfford(state.players[meIdx].resources, give))
		return err(400, 'insufficient resources')

	const playerCount = game.player_order.length
	if (!Array.isArray(body.to)) return err(400, 'invalid to list')
	const to: number[] = []
	for (const t of body.to) {
		if (typeof t !== 'number' || !Number.isInteger(t)) {
			return err(400, 'invalid to list')
		}
		if (t < 0 || t >= playerCount) return err(400, 'invalid to list')
		if (t === meIdx) return err(400, 'cannot address self')
		if (to.includes(t)) continue
		to.push(t)
	}

	const offer: TradeOffer = {
		id: newTradeId(),
		from: meIdx,
		to,
		give,
		receive,
		createdAt: new Date().toISOString(),
	}

	const nextPhase: Phase = { ...phase, trade: offer }
	const { error: stateErr } = await admin
		.from('game_states')
		.update({ phase: nextPhase })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	const event = {
		kind: 'trade_proposed',
		offer_id: offer.id,
		from: meIdx,
		to,
		give,
		receive,
		at: offer.createdAt,
	}
	const { error: gameErr } = await admin
		.from('games')
		.update({ events: [...(game.events ?? []), event] })
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')

	return json({ ok: true, offer_id: offer.id })
}

async function handleAcceptTrade(
	admin: SupabaseClient,
	me: string,
	body: AcceptTradeBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	if (game.status !== 'active') return err(400, 'not active')
	const phase = state.phase
	if (phase.kind !== 'main') return err(400, 'expected main phase')
	const offer = phase.trade
	if (!offer || offer.id !== body.offer_id) return err(404, 'offer not found')

	const meIdx = game.player_order.indexOf(me)
	if (meIdx < 0) return err(403, 'not a participant')
	if (!isOfferAddressedTo(offer, meIdx))
		return err(403, 'not addressed to you')
	if (!canAfford(state.players[offer.from].resources, offer.give))
		return err(400, 'proposer can no longer afford')
	if (!canAfford(state.players[meIdx].resources, offer.receive))
		return err(400, 'you cannot afford')

	const nextPlayers = applyTradeToPlayers(
		state.players,
		offer.from,
		meIdx,
		offer.give,
		offer.receive
	)
	const nextPhase: Phase = { ...phase, trade: null }

	const { error: stateErr } = await admin
		.from('game_states')
		.update({ players: nextPlayers, phase: nextPhase })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	const event = {
		kind: 'trade_accepted',
		offer_id: offer.id,
		from: offer.from,
		to: meIdx,
		give: offer.give,
		receive: offer.receive,
		at: new Date().toISOString(),
	}
	const { error: gameErr } = await admin
		.from('games')
		.update({ events: [...(game.events ?? []), event] })
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')

	return json({ ok: true })
}

async function handleCancelTrade(
	admin: SupabaseClient,
	me: string,
	body: CancelTradeBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	const phase = state.phase
	if (phase.kind !== 'main') return err(400, 'expected main phase')
	const offer = phase.trade
	if (!offer || offer.id !== body.offer_id) return err(404, 'offer not found')

	const meIdx = game.player_order.indexOf(me)
	if (meIdx < 0) return err(403, 'not a participant')
	if (offer.from !== meIdx) return err(403, 'not your offer')

	const nextPhase: Phase = { ...phase, trade: null }
	const { error: stateErr } = await admin
		.from('game_states')
		.update({ phase: nextPhase })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	const event = {
		kind: 'trade_canceled',
		offer_id: offer.id,
		from: meIdx,
		at: new Date().toISOString(),
	}
	const { error: gameErr } = await admin
		.from('games')
		.update({ events: [...(game.events ?? []), event] })
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')

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
		case 'place_settlement':
			return handlePlaceSettlement(admin, me, body)
		case 'place_road':
			return handlePlaceRoad(admin, me, body)
		case 'roll':
			return handleRoll(admin, me, body)
		case 'end_turn':
			return handleEndTurn(admin, me, body)
		case 'build_road':
			return handleBuildRoad(admin, me, body)
		case 'build_settlement':
			return handleBuildSettlement(admin, me, body)
		case 'build_city':
			return handleBuildCity(admin, me, body)
		case 'propose_trade':
			return handleProposeTrade(admin, me, body)
		case 'accept_trade':
			return handleAcceptTrade(admin, me, body)
		case 'cancel_trade':
			return handleCancelTrade(admin, me, body)
		default:
			return err(400, 'unknown action')
	}
})
