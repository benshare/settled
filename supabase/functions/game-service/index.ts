// game-service: single edge function for every write to the games subsystem.
// Dispatches on body.action. Authenticates the caller via their JWT, then
// mutates via the service-role admin client (bypassing RLS).
//
// Actions:
//   - respond: update a game_request's invited[] entry; on full acceptance,
//     insert both the games row (status='placement', shuffled player_order)
//     and the game_states row (generated standard board, blank placements,
//     zeroed hands, initial-placement phase), and delete the request.
//   - place_start: place a whole initial-placement turn at once — one
//     settlement+road pair, or two for the seat that places both settlements
//     back-to-back. Each pair is validated against the previous one applied.
//     Grants, snake-order advance and the end-of-placement transition are the
//     same rules the per-piece actions below use.
//   - place_settlement: place the current player's settlement at `vertex`
//     during initial placement. Grants starting resources on the second
//     settlement, except for the seat that places both back-to-back — see
//     choose_last_settlement. Advances phase.step to 'road'.
//   - place_road: place the current player's road on `edge` incident to
//     their just-placed settlement. Advances snake-order turn; on the final
//     road, transitions the game to status='active' / phase='roll'.
//   - choose_last_settlement: for the seat that places both settlements
//     back-to-back, nominates which one it placed last. Grants that
//     settlement's starting resources, rewrites the seat's placement events
//     into the nominated order, and resumes the snake order.
//   - roll: during phase='roll', rolls 2d6. On a non-7, distributes resources
//     to every settlement/city adjacent to a matching hex (except the hex the
//     robber sits on), transitions to phase='main'. On a 7, transitions to
//     phase='discard' (if any hand >7) or directly to phase='move_robber'.
//   - end_turn: during phase='main', clears lastRoll, transitions phase to
//     'roll', and advances current_turn to the next player (wrap-around).
//   - build_road / build_settlement / build_city: during phase='main' and on
//     the caller's turn, validates the spot + resources, deducts cost, and
//     writes the piece. No victory check in this pass.
//   - discard: during phase='discard' and for any player that still owes a
//     discard, validates the submitted selection sums to the required count
//     and every resource is available, then deducts. When the last pending
//     discard is submitted, transitions to phase='move_robber'.
//   - move_robber: during phase='move_robber' and on the caller's turn,
//     validates the target hex (must be different from current), writes
//     state.robber, computes steal candidates. Transitions to phase='steal'
//     (if ≥1 candidate) or directly to phase='main'.
//   - steal: during phase='steal' and on the caller's turn, picks a random
//     resource from the chosen victim (must be in phase.candidates), moves
//     one card, transitions to phase='main'.
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
import { sendNotifications, type NotifyTarget } from '../_notify/index.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }

type InvitedEntry = {
	user: string
	status: 'pending' | 'accepted' | 'rejected'
}

type ProposeGameBody = {
	action: 'propose_game'
	invited_user_ids: unknown
	config: unknown
}
type RespondBody = { action: 'respond'; request_id: string; accept: boolean }
type CancelRequestBody = { action: 'cancel_request'; request_id: string }
type PickBonusBody = {
	action: 'pick_bonus'
	game_id: string
	bonus: string
	// Omitted when the hand holds a single curse (nothing to choose), and by
	// clients that predate curse selection.
	curse?: string
}
// A whole placement turn in one submission: one settlement+road pair, or two
// for the seat that places both of its settlements back-to-back. The client
// chooses the pieces locally and sends them together, so `place_settlement` /
// `place_road` are only reached by a game that was mid-turn when this shipped
// and by the timeout sweep's piece-by-piece auto-actions.
type PlaceStartBody = {
	action: 'place_start'
	game_id: string
	placements: unknown
}
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
type ChooseLastSettlementBody = {
	action: 'choose_last_settlement'
	game_id: string
	vertex: string
}
// `total` is the admin-testing roll override — honoured only for a seat whose
// player row carries `dev: true`. Absent on every normal roll.
type RollBody = { action: 'roll'; game_id: string; total?: unknown }
// `which` picks between the gambler's two pending rolls at a 5-6 player
// table (0 = the first pair, 1 = the alternate). Ignored otherwise.
type ConfirmRollBody = {
	action: 'confirm_roll'
	game_id: string
	which?: 0 | 1
}
type RerollDiceBody = { action: 'reroll_dice'; game_id: string }
type EndTurnBody = { action: 'end_turn'; game_id: string }
type HonkBody = { action: 'honk'; game_id: string }
type SendMessageBody = {
	action: 'send_message'
	game_id: string
	body: string
}
type EndSpecialBuildBody = { action: 'end_special_build'; game_id: string }
type UndoBody = { action: 'undo'; game_id: string }
// One setter per flag rather than four verbs: submitting and withdrawing share
// every guard and differ only in which way the array moves, and an idempotent
// setter can't get out of step with a client that fires twice.
type SetForfeitBody = { action: 'set_forfeit'; game_id: string; on: boolean }
type SetEndVoteBody = { action: 'set_end_vote'; game_id: string; on: boolean }
type BuildRoadBody = {
	action: 'build_road'
	game_id: string
	edge: string
	use_bricklayer?: boolean
	// Smith: units of the cost's brick/ore component paid in the other.
	smith_swap?: number
	// Fencer: pay 1 of this resource on the fencer's own reserved edge.
	fence_pay?: 'wood' | 'brick' | null
}
type BuildSettlementBody = {
	action: 'build_settlement'
	game_id: string
	vertex: string
	use_bricklayer?: boolean
	smith_swap?: number
}
type BuildCityBody = {
	action: 'build_city'
	game_id: string
	vertex: string
	use_bricklayer?: boolean
	// Metropolitan: replace N wheat in the cost with N ore (one-directional;
	// 0..2). Mutually exclusive with use_bricklayer (both bonuses can't be
	// held simultaneously).
	swap_wheat_to_ore?: number
	smith_swap?: number
}
type DiscardBody = {
	action: 'discard'
	game_id: string
	discard: ResourceHand
}
type MoveRobberBody = { action: 'move_robber'; game_id: string; hex: string }
type StealBody = { action: 'steal'; game_id: string; victim: number }
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
type RejectTradeBody = {
	action: 'reject_trade'
	game_id: string
	offer_id: string
}
type ConfirmTradeBody = {
	action: 'confirm_trade'
	game_id: string
	offer_id: string
	// Index of the accepter the proposer chooses to trade with.
	with: number
}
type BankTradeBody = {
	action: 'bank_trade'
	game_id: string
	give: unknown
	receive: unknown
	// Merchant: pay `count` extra of the single give resource for `count`
	// resources of choice.
	merchant?: {
		resource: unknown
		count: unknown
		take: unknown
	} | null
}
type BuyDevCardBody = {
	action: 'buy_dev_card'
	game_id: string
	use_bricklayer?: boolean
	scout_swap?: { from: unknown; to: unknown } | null
	smith_swap?: number
}
type PlayDevCardBody = {
	action: 'play_dev_card'
	game_id: string
	id: unknown
	payload?: unknown
}
type SetSpecialistResourceBody = {
	action: 'set_specialist_resource'
	game_id: string
	resource: unknown
}
type BuyCarpenterVPBody = {
	action: 'buy_carpenter_vp'
	game_id: string
}
type TapKnightBody = {
	action: 'tap_knight'
	game_id: string
	r1: unknown
	r2: unknown
}
type BuildSuperCityBody = {
	action: 'build_super_city'
	game_id: string
	vertex: string
	swap_wheat_to_ore?: number
}
type LiquidateBody = {
	action: 'liquidate'
	game_id: string
	target: unknown
}
type PlaceExplorerRoadBody = {
	action: 'place_explorer_road'
	game_id: string
	edge: string
}
type RitualRollBody = {
	action: 'ritual_roll'
	game_id: string
	discard: unknown
	total: unknown
}
type ShepherdSwapBody = {
	action: 'shepherd_swap'
	game_id: string
	take: unknown
}
type ClaimCurioBody = {
	action: 'claim_curio'
	game_id: string
	take: unknown
}
type MoveForgerTokenBody = {
	action: 'move_forger_token'
	game_id: string
	hex: string
}
type PickForgerTargetBody = {
	action: 'pick_forger_target'
	game_id: string
	target: unknown
}
type ConfirmScoutCardBody = {
	action: 'confirm_scout_card'
	game_id: string
	index: unknown
}
type PlaceFenceTokenBody = {
	action: 'place_fence_token'
	game_id: string
	edge: string
}
type SetHauntSpotsBody = {
	action: 'set_haunt_spots'
	game_id: string
	spots: unknown
}
type InvestBody = {
	action: 'invest'
	game_id: string
	resource: unknown
}
type CastMagicBody = {
	action: 'cast_magic'
	game_id: string
	target: unknown
	discard: unknown
}
type SkipMagicBody = {
	action: 'skip_magic'
	game_id: string
}
// The one action with no user behind it and no game_id: the cron sweep. See
// handleRunTimeouts.
type RunTimeoutsBody = { action: 'run_timeouts' }
type Body =
	| HonkBody
	| SendMessageBody
	| ProposeGameBody
	| RespondBody
	| CancelRequestBody
	| PickBonusBody
	| PlaceStartBody
	| PlaceSettlementBody
	| PlaceRoadBody
	| ChooseLastSettlementBody
	| RollBody
	| ConfirmRollBody
	| RerollDiceBody
	| EndTurnBody
	| EndSpecialBuildBody
	| BuildRoadBody
	| BuildSettlementBody
	| BuildCityBody
	| DiscardBody
	| MoveRobberBody
	| StealBody
	| ProposeTradeBody
	| AcceptTradeBody
	| CancelTradeBody
	| RejectTradeBody
	| ConfirmTradeBody
	| BankTradeBody
	| BuyDevCardBody
	| PlayDevCardBody
	| SetSpecialistResourceBody
	| BuyCarpenterVPBody
	| TapKnightBody
	| BuildSuperCityBody
	| LiquidateBody
	| PlaceExplorerRoadBody
	| RitualRollBody
	| ShepherdSwapBody
	| ClaimCurioBody
	| MoveForgerTokenBody
	| PickForgerTargetBody
	| ConfirmScoutCardBody
	| PlaceFenceTokenBody
	| SetHauntSpotsBody
	| InvestBody
	| CastMagicBody
	| SkipMagicBody
	| RunTimeoutsBody
	| UndoBody
	| SetForfeitBody
	| SetEndVoteBody

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
type Hex = string

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
type Vertex = string

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
type Edge = string

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

// Fixed token order for the 'spiral' number layout — mirror of lib/catan/board.
// Authentic Catan A-R order.
const STANDARD_SPIRAL_SEQUENCE = [
	5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 5, 6, 3, 11, 4,
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

function deriveAdjacentHexes(
	hexes: readonly Hex[],
	vertices: readonly Vertex[],
	adjVerts: Record<Hex, readonly Vertex[]>
): Record<Vertex, readonly Hex[]> {
	const out: Record<Vertex, Hex[]> = Object.fromEntries(
		vertices.map((v) => [v, [] as Hex[]])
	)
	for (const h of hexes) for (const v of adjVerts[h]) out[v].push(h)
	return out
}

function deriveNeighborVertices(
	vertices: readonly Vertex[],
	edges: readonly Edge[]
): Record<Vertex, readonly Vertex[]> {
	const out: Record<Vertex, Vertex[]> = Object.fromEntries(
		vertices.map((v) => [v, [] as Vertex[]])
	)
	for (const e of edges) {
		const [a, b] = edgeEndpoints(e)
		out[a].push(b)
		out[b].push(a)
	}
	return out
}

function deriveAdjacentEdges(
	vertices: readonly Vertex[],
	edges: readonly Edge[]
): Record<Vertex, readonly Edge[]> {
	const out: Record<Vertex, Edge[]> = Object.fromEntries(
		vertices.map((v) => [v, [] as Edge[]])
	)
	for (const e of edges) {
		const [a, b] = edgeEndpoints(e)
		out[a].push(e)
		out[b].push(e)
	}
	return out
}

// --- Game state shapes (duplicated from lib/catan/types) -------------------

type VertexBuilding = 'settlement' | 'city' | 'super_city' | 'ghost'

type VertexState =
	| { occupied: false }
	| {
			occupied: true
			player: number
			building: VertexBuilding
			placedTurn: number
	  }

type EdgeState =
	{ occupied: false } | { occupied: true; player: number; placedTurn: number }

type ResourceHand = Record<Resource, number>

type DevCardId =
	'knight' | 'victory_point' | 'road_building' | 'year_of_plenty' | 'monopoly'

type DevCardEntry = { id: DevCardId; purchasedTurn: number }

type PlayerState = {
	resources: ResourceHand
	bonus?: BonusId
	curse?: CurseId
	devCards: DevCardEntry[]
	devCardsPlayed: Partial<Record<DevCardId, number>>
	playedDevThisTurn: boolean
	// Cards paid into traditional builds this turn (road/settlement/city/dev
	// card buy). Used by the `age` curse. Reset on end_turn for the outgoing
	// active player. Sparse — only written for cursed players.
	cardsSpentThisTurn?: number
	// Bonus-specific sparse fields (see lib/catan/types.ts).
	specialistResource?: Resource
	rerolledThisTurn?: boolean
	boughtCarpenterVPThisTurn?: boolean
	carpenterVP?: number
	tappedKnights?: number
	// Set 2.
	ritualWasUsedThisTurn?: boolean
	shepherdUsedThisTurn?: boolean
	forgerToken?: Hex
	forgerMovedThisTurn?: boolean
	// Set 3.
	// Round in which the magician last cast; only consulted where the bonus
	// has a cooldown (2 players).
	lastMagicRound?: number
	investments?: Partial<Record<Resource, number>>
	hauntSpots?: Vertex[]
	// Admin testing flag, set by hand in the row. Lets this seat name its own
	// dice total on `roll` (see handleRoll).
	dev?: boolean
}

type DieFace = 1 | 2 | 3 | 4 | 5 | 6
type DiceRoll = { a: DieFace; b: DieFace }

type TradeOffer = {
	id: string
	from: number
	to: number[]
	give: ResourceHand
	receive: ResourceHand
	createdAt: string
	rejectedBy?: number[]
	// Confirm mode: addressees who accepted and await the proposer's
	// confirmation. Empty/absent in automatic mode.
	acceptedBy?: number[]
}

type PortKind = '3:1' | Resource
type Port = { edge: Edge; kind: PortKind }
type BankKind =
	| '5:1'
	| '4:1'
	| '3:1'
	| '2:1-brick'
	| '2:1-wood'
	| '2:1-sheep'
	| '2:1-wheat'
	| '2:1-ore'

// Canonical 9 port slots (matches lib/catan/board.ts PORT_SLOTS).
const PORT_SLOTS: readonly Edge[] = [
	'1B - 1C',
	'1E - 1F',
	'2I - 3J',
	'4J - 4K',
	'5H - 6G',
	'6C - 6D',
	'5B - 6A',
	'4A - 4B',
	'2A - 2B',
]

const STANDARD_PORT_KINDS: readonly PortKind[] = [
	'3:1',
	'3:1',
	'3:1',
	'3:1',
	'brick',
	'wood',
	'sheep',
	'wheat',
	'ore',
]

// --- Expanded (5-6 player) board — mirror of lib/catan/boardExpanded.ts ------
// Generated by dev/gen-expanded-board.ts. 30 hexes, rows 3-4-5-6-5-4-3.

// deno-fmt-ignore
const EXPANDED_HEXES: readonly Hex[] = [
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
	'4E',
	'4F',
	'5A',
	'5B',
	'5C',
	'5D',
	'5E',
	'6A',
	'6B',
	'6C',
	'6D',
	'7A',
	'7B',
	'7C',
]

// deno-fmt-ignore
const EXPANDED_VERTICES: readonly Vertex[] = [
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
	'4L',
	'4M',
	'5A',
	'5B',
	'5C',
	'5D',
	'5E',
	'5F',
	'5G',
	'5H',
	'5I',
	'5J',
	'5K',
	'5L',
	'5M',
	'6A',
	'6B',
	'6C',
	'6D',
	'6E',
	'6F',
	'6G',
	'6H',
	'6I',
	'6J',
	'6K',
	'7A',
	'7B',
	'7C',
	'7D',
	'7E',
	'7F',
	'7G',
	'7H',
	'7I',
	'8A',
	'8B',
	'8C',
	'8D',
	'8E',
	'8F',
	'8G',
]

// deno-fmt-ignore
const EXPANDED_EDGES: readonly Edge[] = [
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
	'3A - 4B',
	'3B - 3C',
	'3C - 3D',
	'3C - 4D',
	'3D - 3E',
	'3E - 3F',
	'3E - 4F',
	'3F - 3G',
	'3G - 3H',
	'3G - 4H',
	'3H - 3I',
	'3I - 3J',
	'3I - 4J',
	'3J - 3K',
	'3K - 4L',
	'4A - 4B',
	'4A - 5A',
	'4B - 4C',
	'4C - 4D',
	'4C - 5C',
	'4D - 4E',
	'4E - 4F',
	'4E - 5E',
	'4F - 4G',
	'4G - 4H',
	'4G - 5G',
	'4H - 4I',
	'4I - 4J',
	'4I - 5I',
	'4J - 4K',
	'4K - 4L',
	'4K - 5K',
	'4L - 4M',
	'4M - 5M',
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
	'5I - 5J',
	'5J - 5K',
	'5J - 6I',
	'5K - 5L',
	'5L - 5M',
	'5L - 6K',
	'6A - 6B',
	'6B - 6C',
	'6B - 7A',
	'6C - 6D',
	'6D - 6E',
	'6D - 7C',
	'6E - 6F',
	'6F - 6G',
	'6F - 7E',
	'6G - 6H',
	'6H - 6I',
	'6H - 7G',
	'6I - 6J',
	'6J - 6K',
	'6J - 7I',
	'7A - 7B',
	'7B - 7C',
	'7B - 8A',
	'7C - 7D',
	'7D - 7E',
	'7D - 8C',
	'7E - 7F',
	'7F - 7G',
	'7F - 8E',
	'7G - 7H',
	'7H - 7I',
	'7H - 8G',
	'8A - 8B',
	'8B - 8C',
	'8C - 8D',
	'8D - 8E',
	'8E - 8F',
	'8F - 8G',
]

const EXPANDED_adjacentVertices: Record<Hex, readonly Vertex[]> = {
	'1A': ['1B', '1C', '2D', '2C', '2B', '1A'],
	'1B': ['1D', '1E', '2F', '2E', '2D', '1C'],
	'1C': ['1F', '1G', '2H', '2G', '2F', '1E'],
	'2A': ['2B', '2C', '3D', '3C', '3B', '2A'],
	'2B': ['2D', '2E', '3F', '3E', '3D', '2C'],
	'2C': ['2F', '2G', '3H', '3G', '3F', '2E'],
	'2D': ['2H', '2I', '3J', '3I', '3H', '2G'],
	'3A': ['3B', '3C', '4D', '4C', '4B', '3A'],
	'3B': ['3D', '3E', '4F', '4E', '4D', '3C'],
	'3C': ['3F', '3G', '4H', '4G', '4F', '3E'],
	'3D': ['3H', '3I', '4J', '4I', '4H', '3G'],
	'3E': ['3J', '3K', '4L', '4K', '4J', '3I'],
	'4A': ['4B', '4C', '5C', '5B', '5A', '4A'],
	'4B': ['4D', '4E', '5E', '5D', '5C', '4C'],
	'4C': ['4F', '4G', '5G', '5F', '5E', '4E'],
	'4D': ['4H', '4I', '5I', '5H', '5G', '4G'],
	'4E': ['4J', '4K', '5K', '5J', '5I', '4I'],
	'4F': ['4L', '4M', '5M', '5L', '5K', '4K'],
	'5A': ['5C', '5D', '6C', '6B', '6A', '5B'],
	'5B': ['5E', '5F', '6E', '6D', '6C', '5D'],
	'5C': ['5G', '5H', '6G', '6F', '6E', '5F'],
	'5D': ['5I', '5J', '6I', '6H', '6G', '5H'],
	'5E': ['5K', '5L', '6K', '6J', '6I', '5J'],
	'6A': ['6C', '6D', '7C', '7B', '7A', '6B'],
	'6B': ['6E', '6F', '7E', '7D', '7C', '6D'],
	'6C': ['6G', '6H', '7G', '7F', '7E', '6F'],
	'6D': ['6I', '6J', '7I', '7H', '7G', '6H'],
	'7A': ['7C', '7D', '8C', '8B', '8A', '7B'],
	'7B': ['7E', '7F', '8E', '8D', '8C', '7D'],
	'7C': ['7G', '7H', '8G', '8F', '8E', '7F'],
}

// deno-fmt-ignore
const EXPANDED_PORT_SLOTS: readonly Edge[] = [
	'1A - 1B',
	'2A - 3B',
	'4A - 4B',
	'5B - 6A',
	'7A - 7B',
	'8B - 8C',
	'8E - 8F',
	'7H - 7I',
	'5L - 6K',
	'4L - 4M',
	'2I - 3J',
]

const EXPANDED_RESOURCE_COUNTS: Record<Resource, number> = {
	brick: 5,
	wood: 6,
	sheep: 6,
	wheat: 6,
	ore: 5,
}

// deno-fmt-ignore
const EXPANDED_NUMBERS = [
	2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11,
	11, 11, 12, 12,
] as const

// Spiral token order for the custom 30-hex board — mirror of lib/catan/board.
// Tuned so reds never land adjacent (see lib/catan/board comment).
// deno-fmt-ignore
const EXPANDED_SPIRAL_SEQUENCE = [
	6, 11, 8, 9, 6, 5, 3, 6, 11, 2, 10, 5, 12, 4, 10, 9, 11, 5, 3, 4, 2, 3, 9,
	8, 12, 8, 4, 10,
] as const

const EXPANDED_PORT_KINDS: readonly PortKind[] = [
	'3:1',
	'3:1',
	'3:1',
	'3:1',
	'3:1',
	'brick',
	'wood',
	'sheep',
	'sheep',
	'wheat',
	'ore',
]

// --- Board bundles (per variant) — mirror of lib/catan/board.ts BOARDS -------
// Server-side needs only the graph + generation data (no layout/coastal).

type Variant = 'standard' | 'expanded'

type Board = {
	hexes: readonly Hex[]
	vertices: readonly Vertex[]
	edges: readonly Edge[]
	adjacentVertices: Record<Hex, readonly Vertex[]>
	adjacentHexes: Record<Vertex, readonly Hex[]>
	neighborVertices: Record<Vertex, readonly Vertex[]>
	adjacentEdges: Record<Vertex, readonly Edge[]>
	portSlots: readonly Edge[]
	resourceCounts: Record<Resource, number>
	numbers: readonly number[]
	spiralNumberSequence: readonly number[]
	portKinds: readonly PortKind[]
}

function buildBoard(parts: {
	hexes: readonly Hex[]
	vertices: readonly Vertex[]
	edges: readonly Edge[]
	adjacentVertices: Record<Hex, readonly Vertex[]>
	portSlots: readonly Edge[]
	resourceCounts: Record<Resource, number>
	numbers: readonly number[]
	spiralNumberSequence: readonly number[]
	portKinds: readonly PortKind[]
}): Board {
	return {
		...parts,
		adjacentHexes: deriveAdjacentHexes(
			parts.hexes,
			parts.vertices,
			parts.adjacentVertices
		),
		neighborVertices: deriveNeighborVertices(parts.vertices, parts.edges),
		adjacentEdges: deriveAdjacentEdges(parts.vertices, parts.edges),
	}
}

const BOARDS: Record<Variant, Board> = {
	standard: buildBoard({
		hexes: HEXES,
		vertices: VERTICES,
		edges: EDGES,
		adjacentVertices,
		portSlots: PORT_SLOTS,
		resourceCounts: STANDARD_RESOURCE_COUNTS,
		numbers: STANDARD_NUMBERS,
		spiralNumberSequence: STANDARD_SPIRAL_SEQUENCE,
		portKinds: STANDARD_PORT_KINDS,
	}),
	expanded: buildBoard({
		hexes: EXPANDED_HEXES,
		vertices: EXPANDED_VERTICES,
		edges: EXPANDED_EDGES,
		adjacentVertices: EXPANDED_adjacentVertices,
		portSlots: EXPANDED_PORT_SLOTS,
		resourceCounts: EXPANDED_RESOURCE_COUNTS,
		numbers: EXPANDED_NUMBERS,
		spiralNumberSequence: EXPANDED_SPIRAL_SEQUENCE,
		portKinds: EXPANDED_PORT_KINDS,
	}),
}

function boardFor(variant: Variant): Board {
	return BOARDS[variant]
}

// 5-6 player games use the expanded board; 2-4 use standard.
function variantForPlayerCount(playerCount: number): Variant {
	return playerCount >= 5 ? 'expanded' : 'standard'
}

// How big the table is, for bonus / curse tuning. Mirror of lib/catan/types.ts
// — deliberately separate from `Variant`, since a card may vary at 2 players
// where the board does not.
type GameSize = 'small' | 'standard' | 'expanded'

function gameSizeFor(playerCount: number): GameSize {
	if (playerCount <= 2) return 'small'
	return playerCount >= 5 ? 'expanded' : 'standard'
}

// --- Bonuses (must match lib/catan/bonuses) --------------------------------

type BonusId =
	| 'specialist'
	| 'merchant'
	| 'gambler'
	| 'veteran'
	| 'scout'
	| 'plutocrat'
	| 'accountant'
	| 'hoarder'
	| 'explorer'
	| 'ritualist'
	| 'fencer'
	| 'underdog'
	| 'nomad'
	| 'populist'
	| 'fortune_teller'
	| 'shepherd'
	| 'smith'
	| 'carpenter'
	| 'metropolitan'
	| 'investor'
	| 'curio_collector'
	| 'thrill_seeker'
	| 'bricklayer'
	| 'aristocrat'
	| 'magician'
	| 'forger'
	| 'haunt'
type CurseId =
	| 'age'
	| 'decadence'
	| 'ambition'
	| 'elitism'
	| 'asceticism'
	| 'nomadism'
	| 'avarice'
	| 'power'
	| 'compaction'
	| 'provinciality'
	| 'youth'

const BONUS_IDS: readonly BonusId[] = [
	'specialist',
	'merchant',
	'gambler',
	'veteran',
	'scout',
	'plutocrat',
	'accountant',
	'hoarder',
	'explorer',
	'ritualist',
	'fencer',
	'underdog',
	'nomad',
	'populist',
	'fortune_teller',
	'shepherd',
	'smith',
	'carpenter',
	'metropolitan',
	'investor',
	'curio_collector',
	'thrill_seeker',
	'bricklayer',
	'aristocrat',
	'magician',
	'forger',
	'haunt',
]
const CURSE_IDS: readonly CurseId[] = [
	'age',
	'decadence',
	'ambition',
	'elitism',
	'asceticism',
	'nomadism',
	'avarice',
	'power',
	'compaction',
	'provinciality',
	'youth',
]

// Mirror of lib/catan/types.ts SelectBonusHand. `curse` is the legacy
// single-curse field, still present on hands dealt before curse counts
// existed — read through handCurses / handChosenCurse, never directly.
type SelectBonusHand = {
	offered: BonusId[]
	curses: CurseId[]
	chosen: BonusId | null
	chosenCurse: CurseId | null
	curse?: CurseId
}

function handCurses(hand: SelectBonusHand): CurseId[] {
	if (hand.curses?.length) return hand.curses
	return hand.curse ? [hand.curse] : []
}

// The curse this hand ends up carrying, or null while it's still an open
// choice. A one-card deal needs no pick, so it resolves immediately.
function handChosenCurse(hand: SelectBonusHand): CurseId | null {
	if (hand.chosenCurse) return hand.chosenCurse
	const curses = handCurses(hand)
	return curses.length === 1 ? curses[0] : null
}

// Which set each bonus belongs to. Must stay in sync with
// lib/catan/bonuses/bonuses.ts. Used to filter the draw pool by
// config.bonusSets when dealing.
const BONUS_SET_OF: Record<BonusId, '1' | '2' | '3'> = {
	specialist: '1',
	merchant: '3',
	gambler: '1',
	veteran: '1',
	scout: '2',
	plutocrat: '3',
	accountant: '2',
	hoarder: '1',
	explorer: '2',
	ritualist: '2',
	fencer: '3',
	underdog: '1',
	nomad: '1',
	populist: '2',
	fortune_teller: '2',
	shepherd: '2',
	smith: '3',
	carpenter: '1',
	metropolitan: '2',
	investor: '3',
	curio_collector: '2',
	thrill_seeker: '1',
	bricklayer: '1',
	aristocrat: '1',
	magician: '3',
	forger: '2',
	haunt: '3',
}

// Bonus / curse pairings that shouldn't be dealt together. Mirror of
// lib/catan/bonuses/combos.ts. Enforced when `config.bannedCombos` is on.
const BANNED_BONUSES_BY_CURSE: Record<CurseId, readonly BonusId[]> = {
	age: ['accountant', 'investor'],
	decadence: ['metropolitan'],
	ambition: ['thrill_seeker'],
	elitism: ['metropolitan', 'haunt'],
	asceticism: [],
	nomadism: [],
	avarice: ['hoarder'],
	power: ['metropolitan', 'plutocrat'],
	compaction: ['explorer', 'fencer'],
	provinciality: ['specialist', 'merchant'],
	youth: [],
}

function isBannedCombo(curse: CurseId, bonus: BonusId): boolean {
	return BANNED_BONUSES_BY_CURSE[curse]?.includes(bonus) ?? false
}

// Per-player-count card variants. Mirror of lib/catan/bonuses/sizes.ts, minus
// the descriptions — the server holds no card copy. A card marked
// `available: false` at a size is not dealt at that size; params are carried
// over only for cards whose rules are enforced here.
const BONUS_SIZE_VARIANTS: Partial<
	Record<
		BonusId,
		Partial<
			Record<
				GameSize,
				{
					available?: boolean
					mode?: 'reroll' | 'choose_two'
					cardCost?: number
					gainMultiplier?: number
					activateVP?: number
					discardPlus?: number
					cooldown?: boolean
				}
			>
		>
	>
> = {
	gambler: {
		expanded: { mode: 'choose_two' },
	},
	ritualist: {
		small: { cardCost: 3 },
		expanded: { cardCost: 2 },
	},
	fortune_teller: {
		expanded: { gainMultiplier: 2 },
	},
	investor: {
		small: { available: false },
		expanded: { activateVP: 0 },
	},
	magician: {
		small: { cooldown: true },
		expanded: { discardPlus: 0 },
	},
}

const CURSE_SIZE_VARIANTS: Partial<
	Record<
		CurseId,
		Partial<
			Record<
				GameSize,
				{
					available?: boolean
					cardLimit?: number
					bankAccess?: 'surcharge' | 'flat_5' | 'none'
				}
			>
		>
	>
> = {
	age: {
		small: { cardLimit: 5 },
		expanded: { cardLimit: 7 },
	},
	provinciality: {
		small: { bankAccess: 'surcharge' },
		expanded: { bankAccess: 'none' },
	},
}

// How the gambler's bonus behaves at this table size. Mirror of
// lib/catan/bonus.ts gamblerModeFor.
function gamblerModeFor(size: GameSize): 'reroll' | 'choose_two' {
	return BONUS_SIZE_VARIANTS.gambler?.[size]?.mode ?? 'reroll'
}

function isBonusAvailableAt(id: BonusId, size: GameSize): boolean {
	return BONUS_SIZE_VARIANTS[id]?.[size]?.available !== false
}

function isCurseAvailableAt(id: CurseId, size: GameSize): boolean {
	return CURSE_SIZE_VARIANTS[id]?.[size]?.available !== false
}

// Mirror of lib/catan/generate.ts dealBonusHands: deal every player's hand at
// once — `bonusCount` bonuses + `curseCount` curses each — drawing WITHOUT
// replacement across the whole table so a card repeats only once the pool is
// exhausted. Curses go out first so each player's bonuses can be drawn from
// what's compatible with EVERY curse they hold (when `bannedCombos` is on),
// which makes whichever pair they keep legal by construction.
//
// Cards withheld at this table size (BONUS_SIZE_VARIANTS / CURSE_SIZE_VARIANTS,
// `available: false`) are dropped before the set filter. Both filters widen
// their net rather than failing to deal — see `pickPool`.
function dealBonusHands(
	playerCount: number,
	bonusSets: readonly string[],
	bannedCombos = true,
	bonusCount = DEFAULT_BONUS_COUNT,
	curseCount = DEFAULT_CURSE_COUNT
): Record<number, SelectBonusHand> {
	const bonusN = clampCardCount(bonusCount, DEFAULT_BONUS_COUNT)
	const curseN = clampCardCount(curseCount, DEFAULT_CURSE_COUNT)
	const size = gameSizeFor(playerCount)
	const available = BONUS_IDS.filter((id) => isBonusAvailableAt(id, size))
	const bonusPool = pickPool(
		bonusN,
		available.filter((id) => bonusSets.includes(BONUS_SET_OF[id])),
		available,
		BONUS_IDS
	)
	const cursePool = pickPool(
		curseN,
		CURSE_IDS.filter((id) => isCurseAvailableAt(id, size)),
		CURSE_IDS
	)
	const drawBonus = dealer(bonusPool)
	const drawCurse = dealer(cursePool)
	const hands: Record<number, SelectBonusHand> = {}
	for (let i = 0; i < playerCount; i++) {
		const curses: CurseId[] = []
		for (let n = 0; n < curseN; n++) {
			curses.push(drawCurse((c) => !curses.includes(c)))
		}
		const offered: BonusId[] = []
		for (let n = 0; n < bonusN; n++) {
			offered.push(
				drawBonus(
					(b) =>
						!offered.includes(b) &&
						(!bannedCombos ||
							curses.every((c) => !isBannedCombo(c, b)))
				)
			)
		}
		hands[i] = { offered, curses, chosen: null, chosenCurse: null }
	}
	return hands
}

// First candidate pool with enough cards to fill one hand, in order of
// preference. Every fallback ends at an unfiltered pool, so a filter can narrow
// the deal but never break it.
function pickPool<T>(
	need: number,
	...candidates: (readonly T[])[]
): readonly T[] {
	return (
		candidates.find((c) => c.length >= need) ??
		candidates[candidates.length - 1]
	)
}

// Deals from a shuffled pass over `pool`, reshuffling only once the pass is
// exhausted. `accept` filters to the cards the caller can take, keeping a
// hand's cards distinct — and its bonuses compatible with its curses — even
// when the pool is smaller than the table needs (set 3 alone is 7 cards;
// a 4-player table wants 8). When nothing in the pool is acceptable the filter
// is ignored rather than failing to deal.
function dealer<T>(pool: readonly T[]): (accept?: (x: T) => boolean) => T {
	if (pool.length < 1) throw new Error('pool too small to deal')
	let bag: T[] = []
	return (accept?: (x: T) => boolean) => {
		if (bag.length === 0) bag = shuffle(pool)
		let idx = accept ? bag.findIndex(accept) : 0
		if (idx < 0 && accept) {
			bag = shuffle(pool)
			idx = bag.findIndex(accept)
		}
		if (idx < 0) idx = 0
		return bag.splice(idx, 1)[0]
	}
}

// --- Config ----------------------------------------------------------------

type NumberLayout = 'spiral' | 'random'
type TradeMode = 'automatic' | 'confirm'

type BuildPhaseFrequency = 'every' | 'across'

// Special build phase config (5-6 player games only). Mirror of the client
// `ExtraBuildConfig` in lib/catan/types.ts. `enabled` = top-level on/off;
// `buildPhases` = cadence; `moreThanSeven` = only players holding >7 cards may
// build during the phase.
type ExtraBuildConfig = {
	enabled: boolean
	buildPhases: BuildPhaseFrequency
	moreThanSeven: boolean
}

// Bonus / curse cards dealt per player. Mirror of lib/catan/types.ts.
const DEFAULT_BONUS_COUNT = 2
const DEFAULT_CURSE_COUNT = 1
const MIN_CARD_COUNT = 1
const MAX_CARD_COUNT = 3

// `config` is stored as raw JSON and never validated on write, so every read of
// a card count goes through this.
function clampCardCount(raw: unknown, fallback: number): number {
	if (typeof raw !== 'number' || !Number.isInteger(raw)) return fallback
	return Math.max(MIN_CARD_COUNT, Math.min(MAX_CARD_COUNT, raw))
}

// Whether a game needs the simultaneous select_bonus phase at all. With one
// card of each kind nobody has a decision to make, so the cards are assigned at
// creation and the game opens on initial placement instead.
function needsBonusSelection(config: GameConfig): boolean {
	if (!config.bonuses) return false
	return (
		clampCardCount(config.bonusCount, DEFAULT_BONUS_COUNT) > 1 ||
		clampCardCount(config.curseCount, DEFAULT_CURSE_COUNT) > 1
	)
}

type GameConfig = {
	bonuses: boolean
	bonusSets: string[]
	// Absent on rows created before the option shipped — read defensively
	// (`!== false`), defaulting to on.
	bannedCombos?: boolean
	// How many bonus / curse cards each player chooses between (1..3). Absent
	// on rows created before the option shipped — read through clampCardCount,
	// which falls back to the 2 / 1 deal those games were played with.
	bonusCount?: number
	curseCount?: number
	devCards: boolean
	numberLayout: NumberLayout
	honk: boolean
	// When true, a 7 during the first full go-around (round < playerCount)
	// skips the whole robber chain — no discards, no move, no steal. Nomad
	// desert production still applies. Mirrors GameConfig in lib/catan/types.ts.
	friendlyRobber: boolean
	// When true, a Monopoly play takes at most `monopolyCap(playerCount)` of
	// the named resource from any single opponent; the aggregate is uncapped.
	// Absent on rows created before the option shipped — read defensively.
	limitMonopoly?: boolean
	// Absent on legacy rows — read defensively (`=== 'confirm'`), defaulting to
	// 'automatic' (today's immediate-swap behaviour).
	tradeMode?: TradeMode
	// Whether friends of any player may watch. Absent on legacy rows — read
	// defensively (`=== true`). The spectator RLS policies read this same field
	// off `games.config`, so this is the authority for access control.
	spectators?: boolean
	extraBuild: ExtraBuildConfig
	// How long the game may sit idle before whoever is holding it up is
	// skipped. Absent on every row created before timeouts shipped — read
	// through `timeoutOptionOf`, which defaults those to no clock at all.
	timeout?: TimeoutOption | null
}

// Per-opponent ceiling on a Monopoly haul when `config.limitMonopoly` is on.
// Mirror of monopolyCap in lib/catan/types.ts.
function monopolyCap(playerCount: number): number {
	return playerCount > 4 ? 2 : 3
}

type ResumePhase =
	| { kind: 'roll' }
	| { kind: 'main'; roll: DiceRoll; trade: TradeOffer | null }

type ForgerPickEntry = {
	idx: number
	hex: Hex
	gainsByCandidate: Record<number, ResourceHand>
}

type Phase =
	| { kind: 'select_bonus'; hands: Record<number, SelectBonusHand> }
	// `pick_last` is only ever reached with round 2 by the one seat that
	// places both settlements back-to-back: they nominate which they placed
	// last, and that one pays the starting resources.
	| {
			kind: 'initial_placement'
			round: 1 | 2
			step: 'settlement' | 'road' | 'pick_last'
	  }
	| {
			kind: 'post_placement'
			pending: {
				specialist: number[]
				explorer?: Partial<Record<number, number>>
				fencer?: Partial<Record<number, number>>
				haunt?: number[]
			}
	  }
	// `altDice` is the gambler's second option at a 5-6 player table: both
	// rolls are thrown up front and `confirm_roll` names which one counts.
	| { kind: 'roll'; pending?: { dice: DiceRoll; altDice?: DiceRoll } }
	| {
			kind: 'discard'
			resume: ResumePhase
			pending: Partial<Record<number, number>>
			// True iff the chain was triggered by a 7-roll (vs a knight).
			// Used to decide whether to snap forger tokens after move_robber
			// completes and to trigger fortune_teller bonus rolls on resume.
			from7?: boolean
	  }
	| { kind: 'move_robber'; resume: ResumePhase; from7?: boolean }
	| {
			kind: 'steal'
			resume: ResumePhase
			hex: Hex
			candidates: number[]
			from7?: boolean
	  }
	| { kind: 'road_building'; resume: ResumePhase; remaining: 1 | 2 }
	| { kind: 'main'; roll: DiceRoll; trade: TradeOffer | null }
	// `resume` also accepts a `special_build` snapshot, since a scout may buy
	// in their special-build slot and must land back on the queue it came from.
	| {
			kind: 'scout_pick'
			resume: ResumePhase | { kind: 'special_build'; queue: number[] }
			owner: number
			cards: DevCardId[]
	  }
	// curio_pick and forger_pick can chain: a roll that triggers both
	// enters forger_pick(resume=curio_pick(resume=main)). Their resume
	// therefore accepts any Phase (recursive) — not just ResumePhase —
	// since the next thing might itself be another sub-phase.
	| { kind: 'curio_pick'; resume: Phase; pending: number[] }
	| { kind: 'forger_pick'; resume: Phase; queue: ForgerPickEntry[] }
	// Set 3: magician post-roll window (own roll only). Fires before any
	// curio/forger reactions.
	| {
			kind: 'magician_pick'
			resume: Phase
			roller: number
			roll: DiceRoll
	  }
	// Special build phase (5-6 player games). queue[0] acts; end_special_build
	// pops the head; empty → roll for the already-advanced current_turn.
	| { kind: 'special_build'; queue: number[] }
	| { kind: 'game_over' }

type GameState = {
	variant: Variant
	hexes: Record<Hex, HexData>
	vertices: Partial<Record<Vertex, VertexState>>
	edges: Partial<Record<Edge, EdgeState>>
	players: PlayerState[]
	phase: Phase
	robber: Hex
	ports?: Port[]
	// Set 3 fencer: edge → owning fencer player index (reserved road spots).
	fenceTokens?: Partial<Record<Edge, number>>
	config: GameConfig
	devDeck: DevCardId[]
	largestArmy: number | null
	longestRoad: number | null
	round: number
}

function vertexStateOf(state: GameState, v: Vertex): VertexState {
	return state.vertices[v] ?? { occupied: false }
}

function edgeStateOf(state: GameState, e: Edge): EdgeState {
	return state.edges[e] ?? { occupied: false }
}

// --- Bonuses (must match lib/catan/bonus) ----------------------------------

function bonusOf(state: GameState, playerIdx: number): BonusId | undefined {
	return state.players[playerIdx]?.bonus
}

const BRICKLAYER_COST: ResourceHand = {
	brick: 4,
	wood: 0,
	sheep: 0,
	wheat: 0,
	ore: 0,
}

// Nomad: every 7-roll picks a random resource via a d5. The desert behaves
// like a regular hex for nomad players — they collect that resource per
// adjacent building (settlement = 1, city = 2, super_city = 3). No buildings
// on desert means no production (and no event). Boards with more than one
// desert (5-6 players) roll the d5 separately per desert, so a nomad
// building on both can collect two different resources.
const NOMAD_RESOURCES: readonly Resource[] = [
	'brick',
	'wood',
	'sheep',
	'wheat',
	'ore',
]

function nomadDie(): Resource {
	return NOMAD_RESOURCES[Math.floor(Math.random() * 5)]
}

function nomadProductionAt(
	state: GameState,
	playerIdx: number,
	hex: Hex
): number {
	let n = 0
	for (const v of boardFor(state.variant).adjacentVertices[hex]) {
		const vs = vertexStateOf(state, v)
		if (!vs.occupied || vs.player !== playerIdx) continue
		n += vs.building === 'super_city' ? 3 : vs.building === 'city' ? 2 : 1
	}
	return n
}

function applyNomadProduce(state: GameState): {
	players: PlayerState[]
	events: unknown[]
} {
	const events: unknown[] = []
	const desertHexes = boardFor(state.variant).hexes.filter(
		(h) => state.hexes[h].resource === null
	)
	const nextPlayers = state.players.map((p, i) => {
		if (p.bonus !== 'nomad') return p
		const resources = { ...p.resources }
		let gained = false
		for (const h of desertHexes) {
			const count = nomadProductionAt(state, i, h)
			if (count <= 0) continue
			const resource = nomadDie()
			resources[resource] += count
			gained = true
			events.push({
				kind: 'nomad_produce',
				player: i,
				resource,
				count,
				at: new Date().toISOString(),
			})
		}
		return gained ? { ...p, resources } : p
	})
	return { players: nextPlayers, events }
}

// Resolve the cost for a build/dev-card purchase. If `useBricklayer` is
// true and the player has the bricklayer bonus and enough brick, pay 4
// Brick; otherwise pay `standardCost`. Returns null if neither option is
// affordable given the hand.
function resolvePurchaseCost(
	p: PlayerState,
	standardCost: ResourceHand,
	useBricklayer: boolean,
	smithSwap: number = 0
): ResourceHand | null {
	if (useBricklayer) {
		if (p.bonus !== 'bricklayer') return null
		if (p.resources.brick < BRICKLAYER_COST.brick) return null
		return BRICKLAYER_COST
	}
	if (p.bonus === 'smith') {
		if (!isValidSmithSwap(standardCost, smithSwap)) return null
		const cost = smithCostOf(p.bonus, standardCost, smithSwap)
		if (!canAfford(p.resources, cost)) return null
		return cost
	}
	if (!canAfford(p.resources, standardCost)) return null
	return standardCost
}

// --- Curses (must match lib/catan/curses) ----------------------------------

const AGE_CARD_LIMIT = 6
const POWER_HEX_LIMIT = 3
const POWER_MAX_HEXES = 2

function curseOf(state: GameState, playerIdx: number): CurseId | undefined {
	return state.players[playerIdx]?.curse
}

function maxRoadsFor(curse: CurseId | undefined): number {
	return curse === 'compaction' ? 7 : 15
}

function maxCitiesFor(curse: CurseId | undefined): number {
	return curse === 'decadence' ? 2 : 4
}

function maxSettlementsFor(
	curse: CurseId | undefined,
	currentCities: number
): number {
	if (curse === 'elitism') return currentCities >= 1 ? 2 : 3
	return 5
}

function winVPThresholdFor(
	bonus: BonusId | undefined,
	curse: CurseId | undefined
): number {
	if (curse === 'ambition') return 11
	if (bonus === 'thrill_seeker') return 9
	return 10
}

function winRoadsRequiredFor(curse: CurseId | undefined): number {
	return curse === 'nomadism' ? 11 : 0
}

function roadCountFor(state: GameState, playerIdx: number): number {
	let n = 0
	for (const e of Object.values(state.edges)) {
		if (e?.occupied && e.player === playerIdx) n++
	}
	return n
}

function settlementCountFor(state: GameState, playerIdx: number): number {
	let n = 0
	for (const v of Object.values(state.vertices)) {
		if (
			v?.occupied &&
			v.player === playerIdx &&
			v.building === 'settlement'
		) {
			n++
		}
	}
	return n
}

function cityCountFor(state: GameState, playerIdx: number): number {
	let n = 0
	for (const v of Object.values(state.vertices)) {
		if (v?.occupied && v.player === playerIdx && v.building === 'city') n++
	}
	return n
}

// Settlements that have been upgraded to a city (or super_city) no longer
// occupy a "settlement slot". The settlement supply cap (5) is unchanged.

function effectiveLongestRoadLength(
	state: GameState,
	playerIdx: number,
	rawLength: number
): number {
	if (curseOf(state, playerIdx) === 'asceticism')
		return Math.max(0, rawLength - 2)
	return rawLength
}

function effectiveKnightsPlayed(
	curse: CurseId | undefined,
	rawCount: number
): number {
	if (curse === 'asceticism') return Math.max(0, rawCount - 1)
	return rawCount
}

function ageCardLimitFor(size: GameSize): number {
	return CURSE_SIZE_VARIANTS.age?.[size]?.cardLimit ?? AGE_CARD_LIMIT
}

function canSpendUnderAge(
	p: PlayerState,
	costSize: number,
	size: GameSize
): boolean {
	if (p.curse !== 'age') return true
	const spent = p.cardsSpentThisTurn ?? 0
	return spent + costSize <= ageCardLimitFor(size)
}

function costSize(cost: ResourceHand): number {
	let n = 0
	for (const r of RESOURCES) n += cost[r]
	return n
}

function hexPowerForPlayer(
	state: GameState,
	playerIdx: number,
	hex: Hex
): number {
	let power = 0
	for (const v of boardFor(state.variant).adjacentVertices[hex]) {
		const vs = vertexStateOf(state, v)
		if (!vs.occupied || vs.player !== playerIdx) continue
		power +=
			vs.building === 'super_city' ? 3 : vs.building === 'city' ? 2 : 1
	}
	return power
}

function countHexesAtMaxPower(state: GameState, playerIdx: number): number {
	let n = 0
	for (const h of boardFor(state.variant).hexes) {
		if (hexPowerForPlayer(state, playerIdx, h) === POWER_HEX_LIMIT) n++
	}
	return n
}

function canPlaceUnderPower(
	state: GameState,
	playerIdx: number,
	vertex: Vertex
): boolean {
	if (curseOf(state, playerIdx) !== 'power') return true
	let hexesAtMax = countHexesAtMaxPower(state, playerIdx)
	for (const h of boardFor(state.variant).adjacentHexes[vertex]) {
		const before = hexPowerForPlayer(state, playerIdx, h)
		const after = before + 1
		if (after > POWER_HEX_LIMIT) return false
		if (after === POWER_HEX_LIMIT && before < POWER_HEX_LIMIT) {
			hexesAtMax += 1
			if (hexesAtMax > POWER_MAX_HEXES) return false
		}
	}
	return true
}

function touchedResources(state: GameState, playerIdx: number): Set<Resource> {
	const out = new Set<Resource>()
	for (const [vid, vs] of Object.entries(state.vertices)) {
		if (!vs?.occupied || vs.player !== playerIdx) continue
		for (const h of boardFor(state.variant).adjacentHexes[vid as Vertex]) {
			const hd = state.hexes[h]
			if (hd.resource !== null) out.add(hd.resource)
		}
	}
	return out
}

function settlementKeepsYouthOK(
	state: GameState,
	playerIdx: number,
	vertex: Vertex
): boolean {
	if (curseOf(state, playerIdx) !== 'youth') return true
	const touched = touchedResources(state, playerIdx)
	if (touched.size === RESOURCES.length) return false
	const next = new Set(touched)
	for (const h of boardFor(state.variant).adjacentHexes[vertex]) {
		const hd = state.hexes[h]
		if (hd.resource !== null) next.add(hd.resource)
	}
	return next.size < RESOURCES.length
}

function canBuildMoreRoads(state: GameState, playerIdx: number): boolean {
	return (
		roadCountFor(state, playerIdx) < maxRoadsFor(curseOf(state, playerIdx))
	)
}

function canBuildMoreSettlements(state: GameState, playerIdx: number): boolean {
	const curse = curseOf(state, playerIdx)
	const cap = maxSettlementsFor(curse, cityCountFor(state, playerIdx))
	return settlementCountFor(state, playerIdx) < cap
}

function canBuildMoreCities(state: GameState, playerIdx: number): boolean {
	return (
		cityCountFor(state, playerIdx) < maxCitiesFor(curseOf(state, playerIdx))
	)
}

// --- Placement rules (must match lib/catan/placement) ----------------------

function isValidSettlementVertex(
	state: GameState,
	v: Vertex,
	playerIdx?: number
): boolean {
	if (vertexStateOf(state, v).occupied) return false
	for (const n of boardFor(state.variant).neighborVertices[v]) {
		const nvs = vertexStateOf(state, n)
		if (nvs.occupied && !isGhost(nvs)) return false
	}
	if (playerIdx !== undefined) {
		if (!canPlaceUnderPower(state, playerIdx, v)) return false
		if (!settlementKeepsYouthOK(state, playerIdx, v)) return false
	}
	return true
}

// Snake order makes the last seat of round 1 the first of round 2, so only
// that seat places both settlements back-to-back and gets to nominate which
// one it placed last (`step: 'pick_last'`).
function isDoublePlacementSeat(
	playerIdx: number,
	playerCount: number
): boolean {
	return playerIdx === playerCount - 1
}

// How many settlement+road pairs one `place_start` submission carries: two for
// that same back-to-back seat on its round-1 turn, one for everyone else.
function placementPairsExpected(
	round: 1 | 2,
	playerIdx: number,
	playerCount: number
): 1 | 2 {
	return round === 1 && isDoublePlacementSeat(playerIdx, playerCount) ? 2 : 1
}

function ownSettlementVertices(state: GameState, playerIdx: number): Vertex[] {
	return boardFor(state.variant).vertices.filter((v) => {
		const vs = vertexStateOf(state, v)
		return (
			vs.occupied &&
			vs.player === playerIdx &&
			vs.building === 'settlement' &&
			!isGhost(vs)
		)
	})
}

function targetSettlement(state: GameState, playerIdx: number): Vertex | null {
	let found: Vertex | null = null
	for (const v of boardFor(state.variant).vertices) {
		const vs = vertexStateOf(state, v)
		if (!vs.occupied || vs.player !== playerIdx) continue
		const hasOwnRoad = boardFor(state.variant).adjacentEdges[v].some(
			(e) => {
				const es = edgeStateOf(state, e)
				return es.occupied && es.player === playerIdx
			}
		)
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
	if (!boardFor(state.variant).adjacentEdges[target].includes(edge))
		return false
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
	for (const h of boardFor(state.variant).adjacentHexes[vertex]) {
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

const UNDERDOG_NUMBERS = new Set<number>([2, 3, 11, 12])

function underdogMultiplierFor(
	bonus: BonusId | undefined,
	hexNumber: number
): 1 | 2 {
	if (bonus === 'underdog' && UNDERDOG_NUMBERS.has(hexNumber)) return 2
	return 1
}

// Mirror of lib/catan/roll.distributeResources, including its plutocrat bump.
// Only the magician's phantom production reads it now — the real roll path
// sums `distributeResourcesByHex` instead, and applies plutocrat itself once
// the per-hex gains are summed. Any new caller must pick one or the other:
// summing the per-hex breakdown without the bump is how plutocrat silently
// stopped applying.

function distributeResources(
	state: GameState,
	total: number
): Record<number, ResourceHand> {
	const result: Record<number, ResourceHand> = {}
	if (total === 7) return result
	for (const hex of boardFor(state.variant).hexes) {
		if (hex === state.robber) continue
		const hd = state.hexes[hex]
		if (hd.resource === null) continue
		if (hd.number !== total) continue
		for (const v of boardFor(state.variant).adjacentVertices[hex]) {
			const vs = vertexStateOf(state, v)
			if (!vs.occupied) continue
			const base =
				vs.building === 'super_city'
					? 3
					: vs.building === 'city'
						? 2
						: 1
			const mult = underdogMultiplierFor(
				state.players[vs.player]?.bonus,
				hd.number
			)
			const gain = base * mult
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
	for (const idxStr of Object.keys(result)) {
		const idx = Number(idxStr)
		if (state.players[idx]?.bonus === 'plutocrat') {
			result[idx] = plutocratGain(result[idx])
		}
	}
	return result
}

// What each player would gain from a SINGLE hex on `total`, IGNORING the
// robber. The forger copies through a blocked hex, so its candidate lookup
// can't go through distributeResourcesByHex — that one skips the robber's hex,
// which is exactly the case the forger bypasses. Plutocrat is deliberately
// absent: it bumps the summed per-roll gain, not a per-hex slice.
function gainsFromHex(
	state: GameState,
	hex: Hex,
	total: number
): Record<number, ResourceHand> {
	const perPlayer: Record<number, ResourceHand> = {}
	if (total === 7) return perPlayer
	const hd = state.hexes[hex]
	if (!hd || hd.resource === null) return perPlayer
	if (hd.number !== total) return perPlayer
	for (const v of boardFor(state.variant).adjacentVertices[hex]) {
		const vs = vertexStateOf(state, v)
		if (!vs.occupied) continue
		const base =
			vs.building === 'super_city' ? 3 : vs.building === 'city' ? 2 : 1
		const mult = underdogMultiplierFor(
			state.players[vs.player]?.bonus,
			hd.number
		)
		const hand =
			perPlayer[vs.player] ??
			(perPlayer[vs.player] = {
				brick: 0,
				wood: 0,
				sheep: 0,
				wheat: 0,
				ore: 0,
			})
		hand[hd.resource] += base * mult
	}
	return perPlayer
}

// Per-hex per-player gain for a roll — gainsFromHex over every hex, minus the
// one the robber sits on.
function distributeResourcesByHex(
	state: GameState,
	total: number
): Partial<Record<Hex, Record<number, ResourceHand>>> {
	const out: Partial<Record<Hex, Record<number, ResourceHand>>> = {}
	if (total === 7) return out
	for (const hex of boardFor(state.variant).hexes) {
		if (hex === state.robber) continue
		const perPlayer = gainsFromHex(state, hex, total)
		if (Object.keys(perPlayer).length > 0) out[hex] = perPlayer
	}
	return out
}

function isDoubles(d: DiceRoll): boolean {
	return d.a === d.b
}

function emptyHand(): ResourceHand {
	return { brick: 0, wood: 0, sheep: 0, wheat: 0, ore: 0 }
}

function addHandInto(target: ResourceHand, src: ResourceHand): ResourceHand {
	for (const r of RESOURCES) target[r] += src[r]
	return target
}

function handTotal(h: ResourceHand): number {
	let n = 0
	for (const r of RESOURCES) n += h[r]
	return n
}

function nextMainTurn(currentTurn: number, playerCount: number): number {
	return (currentTurn + 1) % playerCount
}

// --- Special build phase (must match lib/catan/roll + build + ports) --------

function acrossSeat(idx: number, n: number): number {
	return (idx + Math.floor(n / 2)) % n
}

// Special-build order after `enderIdx`, front (acts first) to back. Empty when
// the SBP doesn't apply. Auto-skip of players who can't act is applied by the
// caller (drainSpecialBuildQueue), not here.
function specialBuildQueue(
	eb: ExtraBuildConfig,
	enderIdx: number,
	n: number
): number[] {
	if (n <= 4 || !eb.enabled) return []
	if (eb.buildPhases === 'across') return [acrossSeat(enderIdx, n)]
	return Array.from({ length: n - 1 }, (_, k) => (enderIdx + 1 + k) % n)
}

function canAffordAnyCost(p: PlayerState, standardCost: ResourceHand): boolean {
	return (
		resolvePurchaseCost(p, standardCost, false) !== null ||
		resolvePurchaseCost(p, standardCost, true) !== null
	)
}

// Can player `idx` take ANY special-build action right now (build/buy)? Bank and
// port trades are not special-build actions — see the note on the client rule.
// Honors the `moreThanSeven` house rule. Mirror of build.canTakeSpecialBuildAction.
function canTakeSpecialBuildActionSrv(state: GameState, idx: number): boolean {
	const p = state.players[idx]
	if (!p) return false
	if (state.config.extraBuild?.moreThanSeven && handSize(p.resources) <= 7)
		return false
	if (payableBuildRoadEdges(state, idx).length > 0) return true
	if (
		canAffordAnyCost(p, BUILD_COSTS.settlement) &&
		boardFor(state.variant).vertices.some((v) =>
			isValidBuildSettlementVertex(state, idx, v)
		)
	)
		return true
	if (
		canAffordAnyCost(p, BUILD_COSTS.city) &&
		boardFor(state.variant).vertices.some((v) =>
			isValidBuildCityVertex(state, idx, v)
		)
	)
		return true
	// A scout can pay the dev-card cost with a swapped resource, so gate on
	// any affordable swap route rather than the standard cost alone.
	if (state.config.devCards && state.devDeck.length > 0) {
		if (
			p.bonus === 'scout'
				? canScoutAffordDevCard(p.resources)
				: canAffordAnyCost(p, DEV_CARD_COST)
		)
			return true
	}
	return false
}

// Drop leading queue members who cannot act, so the queue only ever stops on a
// player with a real option.
function drainSpecialBuildQueue(state: GameState, queue: number[]): number[] {
	let q = queue
	while (q.length > 0 && !canTakeSpecialBuildActionSrv(state, q[0])) {
		q = q.slice(1)
	}
	return q
}

// Gate for build/buy/bank handlers: is `meIdx` the acting special-build player
// and (under moreThanSeven) still over the discard threshold?
function isSpecialBuildActor(state: GameState, meIdx: number): boolean {
	if (state.phase.kind !== 'special_build') return false
	if (state.phase.queue[0] !== meIdx) return false
	if (
		state.config.extraBuild?.moreThanSeven &&
		handSize(state.players[meIdx].resources) <= 7
	)
		return false
	return true
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
	// A ghost (haunt bonus) is transparent — never blocks road chaining.
	if (vs.occupied && !isGhost(vs)) return vs.player === playerIdx
	for (const e of boardFor(state.variant).adjacentEdges[vertex]) {
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
	// A fence token (fencer bonus) reserves the edge for its owner.
	if (isFenceReservedAgainst(state, edge, playerIdx)) return false
	if (!canBuildMoreRoads(state, playerIdx)) return false
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
	if (!canBuildMoreSettlements(state, playerIdx)) return false
	if (vertexStateOf(state, vertex).occupied) return false
	for (const n of boardFor(state.variant).neighborVertices[vertex]) {
		const nvs = vertexStateOf(state, n)
		if (nvs.occupied && !isGhost(nvs)) return false
	}
	if (!canPlaceUnderPower(state, playerIdx, vertex)) return false
	if (!settlementKeepsYouthOK(state, playerIdx, vertex)) return false
	return boardFor(state.variant).adjacentEdges[vertex].some((e) => {
		const es = edgeStateOf(state, e)
		return es.occupied && es.player === playerIdx
	})
}

function isValidBuildCityVertex(
	state: GameState,
	playerIdx: number,
	vertex: Vertex
): boolean {
	if (!canBuildMoreCities(state, playerIdx)) return false
	const vs = vertexStateOf(state, vertex)
	if (
		!vs.occupied ||
		vs.player !== playerIdx ||
		vs.building !== 'settlement'
	) {
		return false
	}
	return canPlaceUnderPower(state, playerIdx, vertex)
}

// --- Robber rules (must match lib/catan/robber) ----------------------------

function handSize(hand: ResourceHand): number {
	let n = 0
	for (const r of RESOURCES) n += hand[r]
	return n
}

function requiredDiscards(players: PlayerState[]): Record<number, number> {
	const out: Record<number, number> = {}
	players.forEach((p, i) => {
		if (p.bonus === 'hoarder') return
		const total = handSize(p.resources)
		const effective =
			p.bonus === 'shepherd' ? total - p.resources.sheep : total
		if (effective > 7) {
			out[i] =
				p.curse === 'avarice' ? effective : Math.floor(effective / 2)
		}
	})
	return out
}

// A hoarder over the limit silently skips the discard, which from the table
// looks like the 7 never happened to them. Log it so the log explains itself.
function hoarderKeptEvents(players: PlayerState[]): unknown[] {
	const out: unknown[] = []
	players.forEach((p, i) => {
		if (p.bonus !== 'hoarder') return
		const total = handSize(p.resources)
		if (total <= 7) return
		out.push({
			kind: 'hoarder_kept',
			player: i,
			count: total,
			at: new Date().toISOString(),
		})
	})
	return out
}

// A discard that takes the whole hand isn't a choice — there is exactly one
// valid selection. Only `avarice` ever produces one: every other required
// count is floor(effective / 2), which is strictly below the hand size, and a
// shepherd under avarice still chooses (sheep are exempt from the count but
// not from the hand). Resolve those here so the player never gets a discard
// prompt with no decision in it — and so a table where the avarice player was
// the only one over the limit skips the discard phase entirely.
function isForcedFullDiscard(hand: ResourceHand, required: number): boolean {
	return required > 0 && required === handSize(hand)
}

function applyForcedDiscards(
	players: PlayerState[],
	pending: Record<number, number>
): {
	players: PlayerState[]
	pending: Record<number, number>
	events: unknown[]
} {
	const nextPending: Record<number, number> = { ...pending }
	const events: unknown[] = []
	const nextPlayers = players.map((p, i) => {
		const required = nextPending[i]
		if (required === undefined) return p
		if (!isForcedFullDiscard(p.resources, required)) return p
		delete nextPending[i]
		events.push({
			kind: 'discarded',
			player: i,
			count: required,
			at: new Date().toISOString(),
		})
		return { ...p, resources: emptyHand() }
	})
	return { players: nextPlayers, pending: nextPending, events }
}

function isValidDiscardSelection(
	hand: ResourceHand,
	selection: ResourceHand,
	required: number
): boolean {
	if (handSize(selection) !== required) return false
	for (const r of RESOURCES) {
		if (selection[r] < 0) return false
		if (selection[r] > hand[r]) return false
	}
	return true
}

function stealCandidates(state: GameState, hex: Hex, meIdx: number): number[] {
	const set = new Set<number>()
	for (const v of boardFor(state.variant).adjacentVertices[hex]) {
		const vs = vertexStateOf(state, v)
		if (!vs.occupied) continue
		if (vs.player === meIdx) continue
		if (handSize(state.players[vs.player].resources) <= 0) continue
		set.add(vs.player)
	}
	return Array.from(set)
}

// --- Dev-card rules (must match lib/catan/dev + devCards) ------------------

const DEV_CARD_IDS: readonly DevCardId[] = [
	'knight',
	'victory_point',
	'road_building',
	'year_of_plenty',
	'monopoly',
]

const DEV_DECK_COMPOSITION: Record<DevCardId, number> = {
	knight: 14,
	victory_point: 5,
	road_building: 2,
	year_of_plenty: 2,
	monopoly: 2,
}

const DEV_CARD_COST: ResourceHand = {
	brick: 0,
	wood: 0,
	sheep: 1,
	wheat: 1,
	ore: 1,
}

function buildInitialDevDeck(): DevCardId[] {
	const deck: DevCardId[] = []
	for (const id of DEV_CARD_IDS) {
		for (let i = 0; i < DEV_DECK_COMPOSITION[id]; i++) deck.push(id)
	}
	for (let i = deck.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		;[deck[i], deck[j]] = [deck[j], deck[i]]
	}
	return deck
}

function knightsPlayed(p: PlayerState): number {
	return p.devCardsPlayed.knight ?? 0
}

function recomputeLargestArmy(state: GameState): number | null {
	let bestIdx: number | null = null
	let best = 2
	state.players.forEach((p, i) => {
		const k = effectiveKnightsPlayed(p.curse, knightsPlayed(p))
		if (k > best) {
			best = k
			bestIdx = i
		} else if (k === best && state.largestArmy === i) {
			bestIdx = i
		}
	})
	return bestIdx !== null ? bestIdx : state.largestArmy
}

function validBuildRoadEdges(state: GameState, meIdx: number): Edge[] {
	const out: Edge[] = []
	const seen = new Set<Edge>()
	for (const v of boardFor(state.variant).vertices) {
		const vs = vertexStateOf(state, v)
		const ownsVertex = vs.occupied && vs.player === meIdx
		const hasAdjOwnRoad = boardFor(state.variant).adjacentEdges[v].some(
			(e) => {
				const es = edgeStateOf(state, e)
				return es.occupied && es.player === meIdx
			}
		)
		if (!ownsVertex && !hasAdjOwnRoad) continue
		if (vs.occupied && vs.player !== meIdx && !isGhost(vs)) continue
		for (const e of boardFor(state.variant).adjacentEdges[v]) {
			if (seen.has(e)) continue
			seen.add(e)
			if (isValidBuildRoadEdge(state, meIdx, e)) out.push(e)
		}
	}
	return out
}

function hasLegalRoadPlacement(state: GameState, meIdx: number): boolean {
	return validBuildRoadEdges(state, meIdx).length > 0
}

// Legal road targets `meIdx` can actually pay for. A fencer holding only one of
// Wood/Brick is narrowed to their own reserved edges, where a single card
// covers the build. Mirror of build.payableBuildRoadEdges.
function payableBuildRoadEdges(state: GameState, meIdx: number): Edge[] {
	const p = state.players[meIdx]
	if (!p) return []
	if (canAffordAnyCost(p, BUILD_COSTS.road))
		return validBuildRoadEdges(state, meIdx)
	if (p.bonus === 'fencer' && (p.resources.wood > 0 || p.resources.brick > 0))
		return validBuildRoadEdges(state, meIdx).filter(
			(e) => fenceOwner(state, e) === meIdx
		)
	return []
}

// --- Longest Road (must match lib/catan/longestRoad) -----------------------

const LONGEST_ROAD_THRESHOLD = 5

function longestRoadFor(state: GameState, playerIdx: number): number {
	const ownEdges: Edge[] = []
	for (const edge of boardFor(state.variant).edges) {
		const es = edgeStateOf(state, edge)
		if (es.occupied && es.player === playerIdx) ownEdges.push(edge)
	}
	if (ownEdges.length === 0) return 0

	let best = 0
	const used = new Set<Edge>()
	for (const start of ownEdges) {
		const [a, b] = edgeEndpoints(start)
		used.add(start)
		const lenA = longestRoadWalk(state, playerIdx, a, used)
		const lenB = longestRoadWalk(state, playerIdx, b, used)
		used.delete(start)
		const local = Math.max(lenA, lenB)
		if (local > best) best = local
		if (best === ownEdges.length) return best
	}
	return best
}

function longestRoadWalk(
	state: GameState,
	playerIdx: number,
	head: Vertex,
	used: Set<Edge>
): number {
	const vs = vertexStateOf(state, head)
	// A ghost (haunt bonus) is transparent — never blocks pass-through.
	if (vs.occupied && vs.player !== playerIdx && !isGhost(vs)) return used.size
	let best = used.size
	for (const e of boardFor(state.variant).adjacentEdges[head]) {
		if (used.has(e)) continue
		const es = edgeStateOf(state, e)
		if (!es.occupied || es.player !== playerIdx) continue
		const [a, b] = edgeEndpoints(e)
		const next = a === head ? b : a
		used.add(e)
		const len = longestRoadWalk(state, playerIdx, next, used)
		used.delete(e)
		if (len > best) best = len
	}
	return best
}

function recomputeLongestRoad(state: GameState): number | null {
	const lengths = state.players.map((_, i) =>
		effectiveLongestRoadLength(state, i, longestRoadFor(state, i))
	)
	let bestIdx: number | null = null
	let bestLen = LONGEST_ROAD_THRESHOLD - 1
	lengths.forEach((len, i) => {
		if (len > bestLen) {
			bestLen = len
			bestIdx = i
		}
	})
	if (bestIdx === null) return null
	const tiedAtLead = lengths
		.map((len, i) => ({ len, i }))
		.filter((e) => e.len === bestLen)
	if (tiedAtLead.length > 1) {
		if (
			state.longestRoad !== null &&
			tiedAtLead.some((e) => e.i === state.longestRoad)
		) {
			return state.longestRoad
		}
		return null
	}
	return bestIdx
}

// --- Victory (must match lib/catan/dev.totalVP) ----------------------------
//
// Threshold is 10 by default, 11 under the `ambition` curse, 9 under the
// `thrill_seeker` bonus — see winVPThresholdFor. findWinner does the
// comparison.

function totalVP(state: GameState, playerIdx: number): number {
	const p = state.players[playerIdx]
	let vp = 0
	for (const v of Object.values(state.vertices)) {
		if (v?.occupied && v.player === playerIdx) {
			vp +=
				v.building === 'ghost'
					? 0
					: v.building === 'super_city'
						? 3
						: v.building === 'city'
							? 2
							: 1
		}
	}
	if (state.largestArmy === playerIdx) vp += 2
	if (state.longestRoad === playerIdx) vp += 2
	vp += p.carpenterVP ?? 0
	vp += populistBonusVPFor(state, playerIdx)
	for (const e of p.devCards) {
		if (e.id === 'victory_point') vp += 1
	}
	return vp
}

// Populist: each settlement (NOT cities/super_cities) whose total adjacent
// producing-hex pips sum to < 5 is worth +1 VP.
function pipCountFor(hexNumber: number): number {
	switch (hexNumber) {
		case 2:
		case 12:
			return 1
		case 3:
		case 11:
			return 2
		case 4:
		case 10:
			return 3
		case 5:
		case 9:
			return 4
		case 6:
		case 8:
			return 5
	}
	return 0
}

function pipsAtVertex(state: GameState, vertex: Vertex): number {
	let pips = 0
	for (const h of boardFor(state.variant).adjacentHexes[vertex]) {
		const hd = state.hexes[h]
		if (hd.resource === null) continue
		pips += pipCountFor(hd.number)
	}
	return pips
}

function populistBonusVPFor(state: GameState, playerIdx: number): number {
	if (state.players[playerIdx]?.bonus !== 'populist') return 0
	let n = 0
	for (const [vid, vs] of Object.entries(state.vertices)) {
		if (!vs?.occupied) continue
		if (vs.player !== playerIdx) continue
		if (vs.building !== 'settlement') continue
		if (pipsAtVertex(state, vid as Vertex) < 5) n += 1
	}
	return n
}

function superCityCount(state: GameState, playerIdx: number): number {
	let n = 0
	for (const v of Object.values(state.vertices)) {
		if (
			v?.occupied &&
			v.player === playerIdx &&
			v.building === 'super_city'
		)
			n += 1
	}
	return n
}

const METROPOLITAN_SUPER_CITY_CAP = 1

function canBuildMoreSuperCities(state: GameState, playerIdx: number): boolean {
	if (state.players[playerIdx]?.bonus !== 'metropolitan') return false
	return superCityCount(state, playerIdx) < METROPOLITAN_SUPER_CITY_CAP
}

const WHEAT_IN_CITY_COST = 2

function metropolitanWheatSwapDelta(
	bonus: BonusId | undefined,
	requested: number
): number {
	if (bonus !== 'metropolitan') return 0
	if (!Number.isInteger(requested)) return 0
	if (requested < 0) return 0
	if (requested > WHEAT_IN_CITY_COST) return WHEAT_IN_CITY_COST
	return requested
}

function metropolitanCityCost(
	bonus: BonusId | undefined,
	delta: number
): ResourceHand {
	const d = metropolitanWheatSwapDelta(bonus, delta)
	return {
		brick: 0,
		wood: 0,
		sheep: 0,
		wheat: WHEAT_IN_CITY_COST - d,
		ore: 3 + d,
	}
}

// Inlined into `requiredDiscards`; kept here as the parallel mirror of
// the lib/catan/bonus helper so client and server stay symmetric.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function shepherdEffectiveHandSize(p: PlayerState): number {
	let n = 0
	for (const r of RESOURCES) {
		if (p.bonus === 'shepherd' && r === 'sheep') continue
		n += p.resources[r]
	}
	return n
}

// Flat where the table size says so; otherwise 2 before the player's first
// city, 3 after. Mirror of lib/catan/bonus.ts.
function ritualCardCost(state: GameState, playerIdx: number): number {
	const flat =
		BONUS_SIZE_VARIANTS.ritualist?.[gameSizeFor(state.players.length)]
			?.cardCost
	if (flat !== undefined) return flat
	let cities = 0
	for (const v of Object.values(state.vertices)) {
		if (!v?.occupied || v.player !== playerIdx) continue
		if (v.building === 'city' || v.building === 'super_city') cities += 1
	}
	return cities >= 1 ? 3 : 2
}

function isValidRitualTotal(total: unknown): total is number {
	if (typeof total !== 'number') return false
	if (!Number.isInteger(total)) return false
	if (total < 2 || total > 12) return false
	return total !== 7
}

function dicePairForTotal(total: number): DiceRoll {
	for (let a = 1; a <= 6; a++) {
		const b = total - a
		if (b >= 1 && b <= 6) {
			return { a: a as DieFace, b: b as DieFace }
		}
	}
	throw new Error(`no dice pair sums to ${total}`)
}

// Mirror of lib/catan/bonus.ts fortuneTellerGainMultiplier.
function fortuneTellerGainMultiplier(size: GameSize): number {
	return BONUS_SIZE_VARIANTS.fortune_teller?.[size]?.gainMultiplier ?? 1
}

function fortuneTellerTriggersOn(
	bonus: BonusId | undefined,
	dice: DiceRoll
): boolean {
	if (bonus !== 'fortune_teller') return false
	if (dice.a === dice.b) return true
	if (dice.a + dice.b === 7) return true
	return false
}

function curioCollectorTriggers(
	bonus: BonusId | undefined,
	total: number,
	gainedCount: number
): boolean {
	if (bonus !== 'curio_collector') return false
	if (total !== 2 && total !== 12) return false
	return gainedCount >= 1
}

function hexesAdjacentTo(hex: Hex, variant: Variant): Hex[] {
	const board = boardFor(variant)
	const seen = new Set<Hex>()
	for (const v of board.adjacentVertices[hex]) {
		for (const h of board.adjacentHexes[v]) {
			if (h === hex) continue
			seen.add(h)
		}
	}
	return Array.from(seen)
}

// Where a forger's token sits. Seeded to the robber's starting hex (the
// desert) at bonus lock-in, so the fallback only fires for a forger dealt
// before the seeding existed — there the token materialises on the robber's
// current hex the first time anything reads it.
function forgerTokenHex(p: PlayerState, robberHex: Hex): Hex {
	return p.forgerToken ?? robberHex
}

// The move is compulsory: a forger cannot roll until the token has left the
// hex it's standing on.
function mustMoveForgerToken(p: PlayerState): boolean {
	return p.bonus === 'forger' && !p.forgerMovedThisTurn
}

const SCOUT_COST_RESOURCES: readonly Resource[] = ['sheep', 'wheat', 'ore']

function isValidScoutSwap(swap: { from: Resource; to: Resource }): boolean {
	if (!SCOUT_COST_RESOURCES.includes(swap.from)) return false
	if (!SCOUT_COST_RESOURCES.includes(swap.to)) return false
	if (swap.from === swap.to) return false
	return true
}

function scoutDevCardCost(swap?: {
	from: Resource
	to: Resource
}): ResourceHand {
	const out: ResourceHand = {
		brick: 0,
		wood: 0,
		sheep: 1,
		wheat: 1,
		ore: 1,
	}
	if (swap && isValidScoutSwap(swap)) {
		out[swap.from] -= 1
		out[swap.to] += 1
	}
	return out
}

// True if a scout can buy a dev card by any swap route (or the standard cost).
function canScoutAffordDevCard(hand: ResourceHand): boolean {
	if (canAfford(hand, scoutDevCardCost())) return true
	for (const from of SCOUT_COST_RESOURCES) {
		for (const to of SCOUT_COST_RESOURCES) {
			if (from === to) continue
			if (canAfford(hand, scoutDevCardCost({ from, to }))) return true
		}
	}
	return false
}

const SCOUT_PEEK_SIZE = 2

const ROAD_REFUND: ResourceHand = {
	brick: 1,
	wood: 1,
	sheep: 0,
	wheat: 0,
	ore: 0,
}
const SETTLEMENT_REFUND: ResourceHand = {
	brick: 1,
	wood: 1,
	sheep: 1,
	wheat: 1,
	ore: 0,
}
const CITY_REFUND: ResourceHand = {
	brick: 0,
	wood: 0,
	sheep: 0,
	wheat: 2,
	ore: 3,
}
const SUPER_CITY_REFUND: ResourceHand = CITY_REFUND
const DEV_CARD_REFUND: ResourceHand = {
	brick: 0,
	wood: 0,
	sheep: 1,
	wheat: 1,
	ore: 1,
}

function roadLiquidationBlocked(
	state: GameState,
	playerIdx: number,
	edge: Edge
): boolean {
	const board = boardFor(state.variant)
	const [a, b] = edge.split(' - ') as [Vertex, Vertex]
	const endpointHeld = (v: Vertex): boolean => {
		const vs = state.vertices[v]
		if (vs?.occupied && vs.player === playerIdx) return true
		return board.adjacentEdges[v].some((e) => {
			if (e === edge) return false
			const es = state.edges[e]
			return !!es?.occupied && es.player === playerIdx
		})
	}
	return endpointHeld(a) && endpointHeld(b)
}

// --- Set 3 bonus helpers (must match lib/catan/bonus) ----------------------

// Plutocrat: bump every resource gained ≥ 2 of by 50% (floor).
function plutocratGain(hand: ResourceHand): ResourceHand {
	const out = { ...hand }
	for (const r of RESOURCES) {
		if (out[r] >= 2) out[r] += Math.floor(out[r] / 2)
	}
	return out
}

// Merchant: 1:1 side-conversion attached to a bank trade.
type MerchantAddon = { resource: Resource; count: number; take: ResourceHand }

function singleGiveResource(give: ResourceHand): Resource | null {
	let found: Resource | null = null
	for (const r of RESOURCES) {
		if (give[r] > 0) {
			if (found) return null
			found = r
		}
	}
	return found
}

function isValidMerchantAddon(
	give: ResourceHand,
	addon: MerchantAddon
): boolean {
	if (!Number.isInteger(addon.count) || addon.count < 1) return false
	const giveRes = singleGiveResource(give)
	if (giveRes === null || addon.resource !== giveRes) return false
	let takeTotal = 0
	for (const r of RESOURCES) {
		if (addon.take[r] < 0) return false
		takeTotal += addon.take[r]
	}
	return takeTotal === addon.count
}

// Fencer.
const FENCE_TOKEN_COUNT = 2

function fenceOwner(state: GameState, edge: Edge): number | null {
	const owner = state.fenceTokens?.[edge]
	return owner === undefined ? null : owner
}

function isFenceReservedAgainst(
	state: GameState,
	edge: Edge,
	playerIdx: number
): boolean {
	const owner = fenceOwner(state, edge)
	return owner !== null && owner !== playerIdx
}

function fenceRoadCost(pay: 'wood' | 'brick'): ResourceHand {
	return {
		brick: pay === 'brick' ? 1 : 0,
		wood: pay === 'wood' ? 1 : 0,
		sheep: 0,
		wheat: 0,
		ore: 0,
	}
}

// Smith: brick ↔ ore fungible for builds, dev cards, ports.
function smithComponent(cost: ResourceHand): 'brick' | 'ore' | null {
	if (cost.brick > 0) return 'brick'
	if (cost.ore > 0) return 'ore'
	return null
}

function isValidSmithSwap(standardCost: ResourceHand, swap: number): boolean {
	if (!Number.isInteger(swap) || swap < 0) return false
	const comp = smithComponent(standardCost)
	if (comp === null) return swap === 0
	return swap <= standardCost[comp]
}

function smithCostOf(
	bonus: BonusId | undefined,
	standardCost: ResourceHand,
	swap: number
): ResourceHand {
	if (bonus !== 'smith') return standardCost
	const comp = smithComponent(standardCost)
	if (comp === null) return standardCost
	const k = Math.max(0, Math.min(swap ?? 0, standardCost[comp]))
	const other: 'brick' | 'ore' = comp === 'brick' ? 'ore' : 'brick'
	const out = { ...standardCost }
	out[comp] = standardCost[comp] - k
	out[other] = standardCost[other] + k
	return out
}

function smithPortResourceOk(
	locked: Resource | null,
	giveResource: Resource,
	isSmith: boolean
): boolean {
	if (locked === null || giveResource === locked) return true
	if (!isSmith) return false
	if (locked === 'brick' && giveResource === 'ore') return true
	if (locked === 'ore' && giveResource === 'brick') return true
	return false
}

// Investor.
const INVESTOR_ACTIVATE_VP = 3
const INVESTOR_MAX_TOKENS = 6
const INVEST_TRIO = 3

function investorTokenCount(p: PlayerState): number {
	const inv = p.investments
	if (!inv) return 0
	let n = 0
	for (const r of RESOURCES) n += inv[r] ?? 0
	return n
}

// Mirror of lib/catan/bonus.ts investorActivateVPFor.
function investorActivateVPFor(size: GameSize): number {
	return (
		BONUS_SIZE_VARIANTS.investor?.[size]?.activateVP ?? INVESTOR_ACTIVATE_VP
	)
}

function canInvest(
	p: PlayerState,
	resource: Resource,
	vp: number,
	size: GameSize
): boolean {
	if (p.bonus !== 'investor') return false
	if (vp < investorActivateVPFor(size)) return false
	if (p.resources[resource] < INVEST_TRIO) return false
	return investorTokenCount(p) < INVESTOR_MAX_TOKENS
}

function investorPayout(p: PlayerState): ResourceHand {
	const out: ResourceHand = { brick: 0, wood: 0, sheep: 0, wheat: 0, ore: 0 }
	const inv = p.investments
	if (!inv) return out
	for (const r of RESOURCES) out[r] = inv[r] ?? 0
	return out
}

// Pay one card per investment token to `idx`. Applied once their roll has
// resolved — on a 7 that means after every owed discard is in — so the payout
// can never push the investor over the discard threshold (mirrors the nomad
// deferral in applyNomadProduce / handleDiscard).
function applyInvestorPayout(
	state: GameState,
	idx: number
): { players: PlayerState[]; events: unknown[] } {
	const p = state.players[idx]
	if (
		p?.bonus !== 'investor' ||
		investorTokenCount(p) === 0 ||
		totalVP(state, idx) <
			investorActivateVPFor(gameSizeFor(state.players.length))
	) {
		return { players: state.players, events: [] }
	}
	const payout = investorPayout(p)
	const players = state.players.map((pp, i) => {
		if (i !== idx) return pp
		const next = { ...pp.resources }
		for (const r of RESOURCES) next[r] += payout[r]
		return { ...pp, resources: next }
	})
	return {
		players,
		events: [
			{
				kind: 'investor_payout',
				player: idx,
				gain: payout,
				at: new Date().toISOString(),
			},
		],
	}
}

// Magician.
function isValidMagicTarget(actualTotal: number, target: number): boolean {
	if (!Number.isInteger(target)) return false
	if (target < 2 || target > 12) return false
	return target !== actualTotal
}

// Mirror of lib/catan/bonus.ts magicianCanCast: at a two-player table the
// magician must skip one of their own turns between casts. A player's turns
// are exactly `players.length` rounds apart.
function magicianCanCast(state: GameState, playerIdx: number): boolean {
	const p = state.players[playerIdx]
	if (p?.bonus !== 'magician') return false
	const size = gameSizeFor(state.players.length)
	if (!BONUS_SIZE_VARIANTS.magician?.[size]?.cooldown) return true
	if (p.lastMagicRound === undefined) return true
	return state.round > p.lastMagicRound + state.players.length
}

function magicDiscardCount(
	actualTotal: number,
	target: number,
	size: GameSize
): number {
	const plus = BONUS_SIZE_VARIANTS.magician?.[size]?.discardPlus ?? 1
	return Math.abs(target - actualTotal) + plus
}

// Haunt.
const HAUNT_SPOT_COUNT = 2

function isGhost(vs: VertexState): boolean {
	return vs.occupied && vs.building === 'ghost'
}

function resolveHauntGhosts(state: GameState): {
	state: GameState
	spawned: { player: number; vertex: Vertex }[]
} {
	const board = boardFor(state.variant)
	let vertices = state.vertices
	let players = state.players
	const spawned: { player: number; vertex: Vertex }[] = []

	let changed = true
	while (changed) {
		changed = false
		for (let idx = 0; idx < players.length; idx++) {
			const p = players[idx]
			if (p.bonus !== 'haunt') continue
			const spots = p.hauntSpots
			if (!spots || spots.length === 0) continue
			const remaining: Vertex[] = []
			for (const spot of spots) {
				const vs = vertices[spot]
				if (vs?.occupied) continue
				const blocked = board.neighborVertices[spot].some(
					(n) => !!vertices[n]?.occupied
				)
				if (!blocked) {
					remaining.push(spot)
					continue
				}
				vertices = {
					...vertices,
					[spot]: {
						occupied: true,
						player: idx,
						building: 'ghost',
						placedTurn: state.round,
					},
				}
				spawned.push({ player: idx, vertex: spot })
				changed = true
			}
			if (remaining.length !== spots.length) {
				players = players.map((pp, i) =>
					i === idx ? { ...pp, hauntSpots: remaining } : pp
				)
				changed = true
			}
		}
	}

	if (vertices === state.vertices && players === state.players) {
		return { state, spawned }
	}
	return { state: { ...state, vertices, players }, spawned }
}

function vpCardCountsByPlayer(state: GameState): Record<number, number> {
	const out: Record<number, number> = {}
	state.players.forEach((p, i) => {
		let n = 0
		for (const e of p.devCards) if (e.id === 'victory_point') n++
		if (n > 0) out[i] = n
	})
	return out
}

// Returns the first player (by index) who meets their victory conditions,
// or null. "Meets" = totalVP ≥ bonus/curse-specific VP threshold (10
// default, 11 under ambition, 9 under thrill_seeker) AND, if cursed with
// nomadism, ≥ 11 roads on the board. All VP (including hidden VP cards)
// counts.
function findWinner(state: GameState): number | null {
	for (let i = 0; i < state.players.length; i++) {
		const bonus = bonusOf(state, i)
		const curse = curseOf(state, i)
		if (totalVP(state, i) < winVPThresholdFor(bonus, curse)) continue
		const roadsNeeded = winRoadsRequiredFor(curse)
		if (roadsNeeded > 0 && roadCountFor(state, i) < roadsNeeded) continue
		return i
	}
	return null
}

// Runs the end-of-action bookkeeping shared by every handler that could
// shift Longest Road or push a player to victory:
//   1. Recompute Longest Road (opt-in — only handlers that touched the road
//      graph pass `recomputeRoads: true`). Pushes `longest_road_changed` event
//      + `longest_road` column update on change.
//   2. Scan for a winner (totalVP >= 10). If found, flip phase to `game_over`,
//      mark the games row as complete, and push `game_complete` event.
//
// Mutates `stateUpdate` + `events` in place. Returns the winner index (or
// null) so the caller can populate games.status / games.winner.
function applyEndOfActionChecks(
	nextState: GameState,
	stateUpdate: Record<string, unknown>,
	events: unknown[],
	opts: { recomputeRoads: boolean }
): number | null {
	const at = new Date().toISOString()
	let cur = nextState

	if (opts.recomputeRoads) {
		const newHolder = recomputeLongestRoad(cur)
		if (newHolder !== cur.longestRoad) {
			cur = { ...cur, longestRoad: newHolder }
			stateUpdate.longest_road = newHolder
			events.push({ kind: 'longest_road_changed', player: newHolder, at })
		}
	}

	const winner = findWinner(cur)
	if (winner !== null) {
		const gameOverPhase: Phase = { kind: 'game_over' }
		stateUpdate.phase = gameOverPhase
		events.push({
			kind: 'game_complete',
			winner,
			at,
			vpCards: vpCardCountsByPlayer(cur),
		})
	}
	return winner
}

// Commits `stateUpdate` to game_states and `events` (plus optional
// winner/status) to games. Matches the two-step write pattern used across
// handlers; factored out so end-of-action flows stay readable.
async function commitActionWrite(
	admin: SupabaseClient,
	game: GameRow,
	stateUpdate: Record<string, unknown>,
	events: unknown[],
	winner: number | null,
	// The post-action state, passed only so a completing game can be summarized
	// into game_results. Omitted by callers that can't finish a game.
	nextState?: GameState,
	opts?: {
		// Extra columns merged into the games update — `forfeits` / `end_votes`.
		gameFields?: Record<string, unknown>
		// Ends the game with no winner and no game_results rows. A canceled
		// game contributes nothing to anyone's stats, which is enforced by
		// never writing the summary in the first place.
		canceled?: boolean
		// Stamps game_results.forfeit. Only meaningful alongside a winner.
		byForfeit?: boolean
	}
): Promise<Response | null> {
	// A declaration that doesn't end the game touches only the games row, and
	// PostgREST rejects an empty PATCH body — so an empty update is a no-op,
	// not a write.
	if (Object.keys(stateUpdate).length > 0) {
		const { error: stateErr } = await admin
			.from('game_states')
			.update(stateUpdate)
			.eq('game_id', game.id)
		if (stateErr) return err(500, 'could not update state')
	}

	const gameUpdate: Record<string, unknown> = {
		events: [...(game.events ?? []), ...events],
		...opts?.gameFields,
	}
	if (opts?.canceled) {
		gameUpdate.status = 'canceled'
	} else if (winner !== null) {
		gameUpdate.status = 'complete'
		gameUpdate.winner = winner
	}
	const { error: gameErr } = await admin
		.from('games')
		.update(gameUpdate)
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')

	if (winner !== null && nextState && !opts?.canceled) {
		// `applyEndOfActionChecks` may have moved Longest Road after the caller
		// built `nextState`, and that's worth 2 VP — read the change back off
		// the state update rather than scoring a stale holder.
		const finalState: GameState =
			'longest_road' in stateUpdate
				? {
						...nextState,
						longestRoad: stateUpdate.longest_road as number | null,
					}
				: nextState
		await writeGameResults(
			admin,
			game,
			finalState,
			winner,
			events,
			opts?.byForfeit ?? false
		)
	}
	return null
}

// Per-player summary of a finished game, backing the Stats tab (final scores
// are otherwise unrecoverable — game_states stays live-shaped, not archival).
//
// Best-effort: the game is already over and the caller is owed its 200, so a
// failure here only logs. `dev/backfill-game-results.ts` can rebuild any row.
async function writeGameResults(
	admin: SupabaseClient,
	game: GameRow,
	state: GameState,
	winner: number,
	newEvents: unknown[],
	// The game ended because everyone else forfeited, not by play. Such a game
	// counts toward games played and win rate only — see lib/stats.ts.
	forfeit: boolean
): Promise<void> {
	const points = state.players.map((_, i) => totalVP(state, i))
	const offered = offeredCardsByPlayer([...(game.events ?? []), ...newEvents])
	const completedAt = new Date().toISOString()
	const rows = game.player_order.map((userId, i) => ({
		game_id: game.id,
		user_id: userId,
		player_index: i,
		points: points[i],
		// Ties share the better rank. The winner crossed the threshold, so
		// nobody is above them and this always yields 1 for them.
		placement: 1 + points.filter((p) => p > points[i]).length,
		won: i === winner,
		turns: state.round,
		player_count: game.player_order.length,
		bonus: bonusOf(state, i) ?? null,
		curse: curseOf(state, i) ?? null,
		offered_bonuses: offered[i]?.bonuses ?? null,
		offered_curses: offered[i]?.curses ?? null,
		completed_at: completedAt,
		forfeit,
	}))
	const { error } = await admin
		.from('game_results')
		.upsert(rows, { onConflict: 'game_id,user_id' })
	if (error) console.error('[game_results] write failed', error.message)
}

// What each seat was dealt, off their `bonus_chosen` event. `curses` is absent
// on games played before curses could be chosen.
function offeredCardsByPlayer(
	events: unknown[]
): Record<number, { bonuses: string[]; curses: string[] | undefined }> {
	const out: Record<
		number,
		{ bonuses: string[]; curses: string[] | undefined }
	> = {}
	for (const e of events) {
		const ev = e as {
			kind?: string
			player?: number
			offered?: string[]
			offeredCurses?: string[]
		}
		if (ev?.kind !== 'bonus_chosen') continue
		if (typeof ev.player !== 'number' || !Array.isArray(ev.offered))
			continue
		out[ev.player] = {
			bonuses: ev.offered,
			curses: Array.isArray(ev.offeredCurses)
				? ev.offeredCurses
				: undefined,
		}
	}
	return out
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
			!Number.isInteger(v) ||
			v < 0
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

// An empty `to` means "everyone but the proposer" — resolve it to real indexes.
function addresseesOf(offer: TradeOffer, playerCount: number): number[] {
	if (offer.to.length > 0) return [...offer.to]
	const out: number[] = []
	for (let i = 0; i < playerCount; i += 1) {
		if (i !== offer.from) out.push(i)
	}
	return out
}

function rejectedByOf(offer: TradeOffer): number[] {
	return offer.rejectedBy ?? []
}

function acceptedByOf(offer: TradeOffer): number[] {
	return offer.acceptedBy ?? []
}

function isOfferRejectedByAll(offer: TradeOffer, playerCount: number): boolean {
	const addressees = addresseesOf(offer, playerCount)
	if (addressees.length === 0) return false
	const rejected = new Set(rejectedByOf(offer))
	return addressees.every((idx) => rejected.has(idx))
}

function newTradeId(): string {
	return Math.random().toString(36).slice(2, 10)
}

// --- Port / bank-trade rules (must match lib/catan/ports) ------------------

function playerPortKinds(state: GameState, playerIdx: number): Set<PortKind> {
	const out = new Set<PortKind>()
	const ports = state.ports ?? []
	for (const p of ports) {
		const [a, b] = edgeEndpoints(p.edge)
		for (const v of [a, b]) {
			const vs = vertexStateOf(state, v)
			if (vs.occupied && vs.player === playerIdx) {
				out.add(p.kind)
				break
			}
		}
	}
	return out
}

function ratioOfBank(kind: BankKind): 2 | 3 | 4 | 5 {
	if (kind === '5:1') return 5
	if (kind === '4:1') return 4
	if (kind === '3:1') return 3
	return 2
}

// What the bank offers this player after the `provinciality` curse, which
// varies by table size. Mirror of lib/catan/ports.ts.
function bankAccessFor(
	state: GameState,
	playerIdx: number
): 'open' | 'surcharge' | 'flat_5' | 'none' {
	if (curseOf(state, playerIdx) !== 'provinciality') return 'open'
	const size = gameSizeFor(state.players.length)
	return CURSE_SIZE_VARIANTS.provinciality?.[size]?.bankAccess ?? 'flat_5'
}

// Extra input paid on every ratio — 1 under the small-table version of
// provinciality, 0 otherwise.
function bankSurchargeFor(state: GameState, playerIdx: number): number {
	return bankAccessFor(state, playerIdx) === 'surcharge' ? 1 : 0
}

// Given a give/receive hand, infer which bank kind the caller is trying to
// use — highest-quality ratio they can support. Returns null if the hand
// can't be parsed into any kind the player actually has access to. Under the
// `provinciality` curse that depends on the table size: 5:1 only, ports at a
// +1 surcharge, or no bank trade at all.
//
// Specialist discount: when the give is a single-resource stack of the
// player's declared specialty, the divisibility check uses
// `max(2, baseRatio - 1)` instead of baseRatio.
function inferBankKind(
	state: GameState,
	playerIdx: number,
	give: ResourceHand
): BankKind | null {
	const giveResources = RESOURCES.filter((r) => give[r] > 0)
	if (giveResources.length === 0) return null

	const access = bankAccessFor(state, playerIdx)
	if (access === 'none') return null
	if (access === 'flat_5') {
		const allDivBy5 = giveResources.every((r) => give[r] % 5 === 0)
		return allDivBy5 ? '5:1' : null
	}
	const surcharge = access === 'surcharge' ? 1 : 0

	const kinds = playerPortKinds(state, playerIdx)
	const specialistResource =
		state.players[playerIdx]?.specialistResource ?? null

	// Effective ratio for a give + candidate kind, applying specialist
	// discount only when give is a single-resource stack of the declared
	// specialty.
	const effective = (kind: BankKind) =>
		effectiveBankRatioFor(kind, give, specialistResource, surcharge)

	// Single-resource give → could be any; prefer 2:1 port for that resource,
	// then 3:1, then 4:1.
	if (giveResources.length === 1) {
		const only = giveResources[0]
		if (kinds.has(only)) {
			const kind = `2:1-${only}` as BankKind
			if (give[only] % effective(kind) === 0) return kind
		}
		if (kinds.has('3:1') && give[only] % effective('3:1') === 0)
			return '3:1'
		if (give[only] % effective('4:1') === 0) return '4:1'
		return null
	}

	// Multi-resource give → can't use a 2:1 specific port. Prefer 3:1 then 4:1.
	// Specialist discount never applies to multi-resource gives.
	const allDivBy3 = giveResources.every(
		(r) => give[r] % effective('3:1') === 0
	)
	if (kinds.has('3:1') && allDivBy3) return '3:1'
	const allDivBy4 = giveResources.every(
		(r) => give[r] % effective('4:1') === 0
	)
	if (allDivBy4) return '4:1'
	return null
}

function effectiveBankRatioFor(
	kind: BankKind,
	give: ResourceHand,
	specialistResource: Resource | null,
	surcharge: number = 0
): number {
	const base = ratioOfBank(kind) + surcharge
	if (!specialistResource) return base
	const givers = RESOURCES.filter((r) => give[r] > 0)
	if (givers.length !== 1) return base
	if (givers[0] !== specialistResource) return base
	return Math.max(1, base - 1)
}

function isValidBankTradeShape(
	give: ResourceHand,
	receive: ResourceHand,
	kind: BankKind,
	specialistResource: Resource | null = null,
	isSmith: boolean = false,
	surcharge: number = 0
): boolean {
	const ratio = effectiveBankRatioFor(
		kind,
		give,
		specialistResource,
		surcharge
	)
	const locked: Resource | null = kind.startsWith('2:1-')
		? (kind.slice(4) as Resource)
		: null
	let giveTotal = 0
	let receiveTotal = 0
	for (const r of RESOURCES) {
		if (give[r] < 0 || receive[r] < 0) return false
		if (give[r] > 0 && receive[r] > 0) return false
		if (give[r] % ratio !== 0) return false
		if (give[r] > 0 && !smithPortResourceOk(locked, r, isSmith))
			return false
		giveTotal += give[r]
		receiveTotal += receive[r]
	}
	return giveTotal > 0 && giveTotal === ratio * receiveTotal
}

function applyBankTradeToPlayer(
	players: PlayerState[],
	idx: number,
	give: ResourceHand,
	receive: ResourceHand
): PlayerState[] {
	return players.map((p, i) => {
		if (i !== idx) return p
		const next: ResourceHand = { ...p.resources }
		for (const r of RESOURCES) {
			next[r] = next[r] - give[r] + receive[r]
		}
		return { ...p, resources: next }
	})
}

// Standard: alternate 2:1 / 3:1 around the canonical ring (even = 2:1, odd =
// 3:1). Expanded: shuffle the 11-port composition onto the fixed slots.
// Matches lib/catan/generate.ts.
function generatePorts(variant: Variant): Port[] {
	const board = boardFor(variant)
	if (variant === 'standard') {
		const twoOnes = shuffle(RESOURCES) as Resource[]
		let twoIdx = 0
		return board.portSlots.map((edge, i) => {
			if (i % 2 === 0) return { edge, kind: twoOnes[twoIdx++] }
			return { edge, kind: '3:1' }
		})
	}
	// Reject any deal that lands the two sheep 2:1 ports next to each other
	// among the 2:1 ports (3:1s ignored) around the cyclic ring of slots.
	let kinds = shuffle(board.portKinds)
	while (sheepPortsAdjacent(kinds)) {
		kinds = shuffle(board.portKinds)
	}
	return board.portSlots.map((edge, i) => ({ edge, kind: kinds[i] }))
}

function sheepPortsAdjacent(kinds: PortKind[]): boolean {
	const twoOnes = kinds.filter((k) => k !== '3:1')
	const sheepIdx = twoOnes.flatMap((k, i) => (k === 'sheep' ? [i] : []))
	if (sheepIdx.length < 2) return false
	const [a, b] = sheepIdx
	const gap = b - a
	return gap === 1 || gap === twoOnes.length - 1
}

// --- Game generation -------------------------------------------------------

function generateHexes(
	variant: Variant,
	layout: NumberLayout
): {
	hexes: Record<Hex, HexData>
	desert: Hex
} {
	const board = boardFor(variant)
	const bag: (Resource | null)[] = []
	for (const r of RESOURCES) {
		for (let i = 0; i < board.resourceCounts[r]; i++) bag.push(r)
	}
	// Expanded has two deserts; the robber starts on the last one placed.
	const desertCount = board.hexes.length - bag.length
	for (let i = 0; i < desertCount; i++) bag.push(null)
	const resources = shuffle(bag)
	// Token per hex: shuffled bag ('random') or spiral sequence ('spiral').
	const numberFor =
		layout === 'random'
			? assignRandomNumbers(board, resources)
			: assignSpiralNumbers(board, resources)

	const out = {} as Record<Hex, HexData>
	let desert: Hex | null = null
	for (let i = 0; i < board.hexes.length; i++) {
		const hex = board.hexes[i]
		const r = resources[i]
		if (r === null) {
			out[hex] = { resource: null }
			desert = hex
		} else {
			out[hex] = { resource: r, number: numberFor.get(hex) as number }
		}
	}
	if (!desert) throw new Error('no desert generated')
	return { hexes: out, desert }
}

// Random layout: shuffle the token bag onto resource hexes in board order.
function assignRandomNumbers(
	board: Board,
	resources: readonly (Resource | null)[]
): Map<Hex, number> {
	const numbers = shuffle(board.numbers)
	const out = new Map<Hex, number>()
	let numIdx = 0
	for (let i = 0; i < board.hexes.length; i++) {
		if (resources[i] !== null) out.set(board.hexes[i], numbers[numIdx++])
	}
	return out
}

// Spiral layout: walk hexes outer ring → center (random corner + direction) and
// lay the fixed token sequence, skipping deserts. Mirror of lib/catan/generate.
function assignSpiralNumbers(
	board: Board,
	resources: readonly (Resource | null)[]
): Map<Hex, number> {
	const isDesert = new Map<Hex, boolean>()
	board.hexes.forEach((h, i) => isDesert.set(h, resources[i] === null))
	const order = spiralHexOrder(board)
	const seq = board.spiralNumberSequence
	const out = new Map<Hex, number>()
	let seqIdx = 0
	for (const hex of order) {
		if (isDesert.get(hex)) continue
		out.set(hex, seq[seqIdx++])
	}
	return out
}

type HexGeom = { hex: Hex; q: number; r: number; cx: number; cy: number }

const SQRT3 = Math.sqrt(3)

// Group the row-major hex list into rows by ID prefix (hex IDs are
// `<rowNumber><letter>`). Kept ID-derived so this stays identical to lib.
function boardRows(board: Board): Hex[][] {
	const rows: Hex[][] = []
	let lastRow = -1
	for (const hex of board.hexes) {
		const r = parseInt(hex, 10)
		if (r !== lastRow) {
			rows.push([])
			lastRow = r
		}
		rows[rows.length - 1].push(hex)
	}
	return rows
}

function hexGeometry(board: Board): HexGeom[] {
	const rows = boardRows(board)
	const maxW = Math.max(...rows.map((r) => r.length))
	const out: HexGeom[] = []
	rows.forEach((ids, r) => {
		const indent = (maxW - ids.length) / 2
		ids.forEach((hex, c) => {
			out.push({
				hex,
				q: indent + c - r / 2,
				r,
				cx: (indent + c + 0.5) * SQRT3,
				cy: r * 1.5 + 1,
			})
		})
	})
	return out
}

function ringDistance(a: HexGeom, b: HexGeom): number {
	const ax = a.q
	const az = a.r
	const bx = b.q
	const bz = b.r
	return (
		(Math.abs(ax - bx) +
			Math.abs(az - bz) +
			Math.abs(-ax - az - (-bx - bz))) /
		2
	)
}

function spiralHexOrder(board: Board): Hex[] {
	const geom = hexGeometry(board)
	const cxMean = geom.reduce((s, g) => s + g.cx, 0) / geom.length
	const cyMean = geom.reduce((s, g) => s + g.cy, 0) / geom.length
	const center = geom.reduce((best, g) => {
		const d = (g.cx - cxMean) ** 2 + (g.cy - cyMean) ** 2
		const bd = (best.cx - cxMean) ** 2 + (best.cy - cyMean) ** 2
		return d < bd ? g : best
	})
	const theta0 = Math.random() * 2 * Math.PI
	const dir = Math.random() < 0.5 ? 1 : -1
	const TWO_PI = 2 * Math.PI
	const angle = (g: HexGeom) => {
		const a = dir * Math.atan2(g.cy - cyMean, g.cx - cxMean) + theta0
		return ((a % TWO_PI) + TWO_PI) % TWO_PI
	}
	return [...geom]
		.sort((a, b) => {
			const rd = ringDistance(b, center) - ringDistance(a, center)
			if (rd !== 0) return rd
			return angle(a) - angle(b)
		})
		.map((g) => g.hex)
}

function initialPlayers(count: number): PlayerState[] {
	return Array.from({ length: count }, () => ({
		resources: { brick: 0, wood: 0, sheep: 0, wheat: 0, ore: 0 },
		devCards: [],
		devCardsPlayed: {},
		playedDevThisTurn: false,
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
		variant: stateRow.variant as Variant,
		hexes: stateRow.hexes,
		vertices: stateRow.vertices,
		edges: stateRow.edges,
		players: stateRow.players,
		phase,
		robber: stateRow.robber,
		ports: stateRow.ports ?? [],
		fenceTokens:
			(stateRow.fence_tokens as Partial<Record<Edge, number>> | null) ??
			undefined,
		config: game.config as GameConfig,
		devDeck: (stateRow.dev_deck as DevCardId[] | null) ?? [],
		largestArmy: (stateRow.largest_army as number | null) ?? null,
		longestRoad: (stateRow.longest_road as number | null) ?? null,
		round: (stateRow.round as number | null) ?? 0,
	}
	return { ok: true, game: game as GameRow, state }
}

type GameRow = {
	id: string
	participants: string[]
	player_order: string[]
	current_turn: number | null
	status: 'placement' | 'active' | 'complete' | 'canceled'
	winner: number | null
	events: unknown[]
	config: GameConfig
	// User ids holding a standing forfeit / end-game vote. See handleSetForfeit.
	forfeits: string[]
	end_votes: string[]
	// Move-timeout bookkeeping. See the timeout section below.
	deadline_at: string | null
	timeout_warned: number | null
	timed_out: string[] | null
}

function currentPlayerIndex(game: GameRow, me: string): number | null {
	const idx = game.player_order.indexOf(me)
	if (idx < 0) return null
	if (game.current_turn === null) return null
	return idx
}

async function handleProposeGame(
	admin: SupabaseClient,
	me: string,
	body: ProposeGameBody
): Promise<Response> {
	const invitedRaw = body.invited_user_ids
	if (!Array.isArray(invitedRaw) || invitedRaw.length === 0) {
		return err(400, 'must invite at least one user')
	}
	if (!invitedRaw.every((u): u is string => typeof u === 'string')) {
		return err(400, 'invited_user_ids must be strings')
	}
	const invitedIds = invitedRaw as string[]
	if (invitedIds.includes(me)) return err(400, 'cannot invite yourself')

	const config = body.config
	if (!config || typeof config !== 'object' || Array.isArray(config)) {
		return err(400, 'config must be an object')
	}

	const invited: InvitedEntry[] = invitedIds.map((u) => ({
		user: u,
		status: 'pending',
	}))

	const { data, error } = await admin
		.from('game_requests')
		.insert({ proposer: me, invited, config })
		.select('id')
		.single()
	if (error || !data) {
		return err(500, error?.message || 'could not create request')
	}

	EdgeRuntime.waitUntil(
		sendNotifications(
			admin,
			invitedIds.map((userId) => ({
				userId,
				kind: 'game_invite',
				gate: 'gameInvite',
				senderProfileId: me,
				// Deep-links the tap to the invite screen, which is where it
				// can be accepted or declined.
				requestId: data.id,
			}))
		)
	)

	return json({ ok: true, id: data.id })
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
		const config = request.config as GameConfig

		// One bonus and one curse each is nothing to choose between, so those
		// games skip the selection phase and open on placement with the cards
		// already assigned.
		const selecting = needsBonusSelection(config)
		const hands = config.bonuses
			? dealBonusHands(
					playerOrder.length,
					config.bonusSets,
					config.bannedCombos !== false,
					config.bonusCount,
					config.curseCount
				)
			: null

		let players = initialPlayers(playerOrder.length)
		let initialPhase: Phase = INITIAL_PHASE
		const startEvents: unknown[] = []
		if (hands && selecting) {
			initialPhase = { kind: 'select_bonus', hands }
		} else if (hands) {
			const at = new Date().toISOString()
			players = players.map((p, i) => ({
				...p,
				bonus: hands[i].offered[0],
				curse: handChosenCurse(hands[i]) ?? undefined,
			}))
			// Logged here rather than in handlePickBonus, which this path never
			// reaches — the action log and `game_results.offered_*` both read
			// these events.
			startEvents.push(
				...players.map((p, i) => ({
					kind: 'bonus_chosen',
					player: i,
					bonus: p.bonus,
					curse: p.curse,
					offered: hands[i].offered,
					offeredCurses: handCurses(hands[i]),
					at,
				}))
			)
		}

		const { data: inserted, error: insertErr } = await admin
			.from('games')
			.insert({
				participants,
				player_order: playerOrder,
				// Bonus selection is simultaneous — nobody holds the turn, and
				// naming a seat there is actively wrong (the header's tab strip
				// reads this column to badge "waiting on you"). Set to 0 when
				// the phase resolves to initial_placement in handlePickBonus.
				current_turn: selecting ? null : 0,
				status: 'placement',
				// Passed through whole rather than re-derived field by field —
				// the spectator policies read config.spectators off this row.
				config,
				...(startEvents.length > 0 ? { events: startEvents } : {}),
				// The clock starts the moment the game does. Whatever the
				// opening phase, it is waiting on somebody and nobody has been
				// skipped yet, so this is always the full window. Every action
				// after this one re-stamps it from `serve`.
				deadline_at: timeoutOptionOf(config)
					? new Date(
							Date.now() + TIMEOUT_MS[timeoutOptionOf(config)!]
						).toISOString()
					: null,
			})
			.select('id')
			.single()
		if (insertErr || !inserted) return err(500, 'could not create game')

		// 5-6 player games auto-select the expanded 30-hex board.
		const variant = variantForPlayerCount(playerOrder.length)
		// Older requests predate numberLayout — default to spiral.
		const { hexes: generatedHexes, desert } = generateHexes(
			variant,
			config.numberLayout ?? 'spiral'
		)
		// A forger's token starts on the robber's hex. Seeded here for the
		// auto-assign path — handlePickBonus does it for games that choose —
		// and it has to wait for generateHexes, which is what fixes the desert.
		const seatedPlayers = players.map((p) =>
			p.bonus === 'forger' ? { ...p, forgerToken: desert } : p
		)
		const { error: stateErr } = await admin.from('game_states').insert({
			game_id: inserted.id,
			variant,
			hexes: generatedHexes,
			vertices: {},
			edges: {},
			players: seatedPlayers,
			phase: initialPhase,
			robber: desert,
			ports: generatePorts(variant),
			dev_deck: config.devCards ? buildInitialDevDeck() : [],
			largest_army: null,
			longest_road: null,
			round: 0,
		})
		if (stateErr) return err(500, 'could not create game state')

		const { error: delErr } = await admin
			.from('game_requests')
			.delete()
			.eq('id', body.request_id)
		if (delErr) return err(500, 'could not clear request')

		const firstPlayerId = playerOrder[0]
		EdgeRuntime.waitUntil(
			sendNotifications(
				admin,
				participants.map((userId) => ({
					userId,
					kind: 'game_started',
					gate: 'yourTurn',
					gameId: inserted.id,
					firstPlayer: userId === firstPlayerId,
				}))
			)
		)

		return json({ ok: true, game_id: inserted.id })
	}

	const { error: updateErr } = await admin
		.from('game_requests')
		.update({ invited: nextInvited })
		.eq('id', body.request_id)
	if (updateErr) return err(500, 'could not update request')

	return json({ ok: true })
}

// The proposer withdraws their own invite. A game_requests row only exists
// before the game does — once every invitee accepts, handleRespond deletes it
// and inserts the game — so there is no started game to guard against here.
async function handleCancelRequest(
	admin: SupabaseClient,
	me: string,
	body: CancelRequestBody
): Promise<Response> {
	const { data: request, error: loadErr } = await admin
		.from('game_requests')
		.select('proposer')
		.eq('id', body.request_id)
		.maybeSingle()
	if (loadErr) return err(500, loadErr.message || 'load failed')
	if (!request) return err(404, 'request not found')
	if (request.proposer !== me) return err(403, 'not the proposer')

	const { error: delErr } = await admin
		.from('game_requests')
		.delete()
		.eq('id', body.request_id)
	if (delErr) return err(500, delErr.message || 'could not cancel request')

	return json({ ok: true })
}

// select_bonus: each player picks one of their offered bonuses, and one of
// their offered curses, to keep — both in the same call. Picks are parallel —
// no current_turn enforcement. When every hand's `chosen` is set, snapshot each
// player's kept cards onto PlayerState and advance to initial_placement.
async function handlePickBonus(
	admin: SupabaseClient,
	me: string,
	body: PickBonusBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	if (game.status !== 'placement') return err(400, 'not in placement')
	if (state.phase.kind !== 'select_bonus')
		return err(400, 'not in bonus selection')

	const meIdx = game.player_order.indexOf(me)
	if (meIdx < 0) return err(403, 'not a participant')

	const hand = state.phase.hands[meIdx]
	if (!hand) return err(400, 'no bonus hand')
	if (hand.chosen !== null) return err(400, 'already chosen')

	if (!(BONUS_IDS as readonly string[]).includes(body.bonus))
		return err(400, 'unknown bonus')
	const bonus = body.bonus as BonusId
	if (!hand.offered.includes(bonus)) return err(400, 'bonus not offered')

	// A hand holding one curse was decided at deal time, so the curse may be
	// omitted — which is also what a client predating curse choice sends.
	const offeredCurses = handCurses(hand)
	let curse: CurseId | null = null
	if (body.curse !== undefined) {
		if (!(CURSE_IDS as readonly string[]).includes(body.curse))
			return err(400, 'unknown curse')
		curse = body.curse as CurseId
		if (!offeredCurses.includes(curse)) return err(400, 'curse not offered')
	} else {
		curse = handChosenCurse(hand)
		if (curse === null) return err(400, 'must pick a curse')
	}

	const nextHands: Record<number, SelectBonusHand> = {
		...state.phase.hands,
		[meIdx]: { ...hand, chosen: bonus, chosenCurse: curse },
	}

	const allChosen = game.player_order.every(
		(_, i) => nextHands[i]?.chosen !== null
	)

	let nextPhase: Phase
	let nextPlayers = state.players
	if (allChosen) {
		nextPlayers = state.players.map((p, i) => {
			const chosen = nextHands[i]!.chosen!
			return {
				...p,
				bonus: chosen,
				curse: handChosenCurse(nextHands[i]!) ?? undefined,
				// A forger's token starts on the robber's hex (the desert) and
				// from here on moves only when the forger moves it — nothing
				// else on the board relocates it.
				...(chosen === 'forger' ? { forgerToken: state.robber } : {}),
			}
		})
		nextPhase = { kind: 'initial_placement', round: 1, step: 'settlement' }
	} else {
		nextPhase = { kind: 'select_bonus', hands: nextHands }
	}

	const { error: stateErr } = await admin
		.from('game_states')
		.update({ phase: nextPhase, players: nextPlayers })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	// Logged only once everyone has locked in, so the log can't leak an early
	// picker's bonus to players still choosing. Bonuses and curses are public
	// from that point on (the player strip shows them).
	if (allChosen) {
		const at = new Date().toISOString()
		// The offered cards are the only surviving record of what a player
		// turned down — the hands live in `phase`, which is replaced right here
		// by initial_placement. Stats reads them back for pick rate.
		const events = nextPlayers.map((p, i) => ({
			kind: 'bonus_chosen',
			player: i,
			bonus: p.bonus,
			curse: p.curse,
			offered: nextHands[i]!.offered,
			offeredCurses: handCurses(nextHands[i]!),
			at,
		}))
		const { error: gameErr } = await admin
			.from('games')
			.update({
				// Held null for the duration of the simultaneous phase; the
				// snake order starts now. See the insert in handleRespond.
				current_turn: 0,
				events: [...(game.events ?? []), ...events],
			})
			.eq('id', game.id)
		if (gameErr) return err(500, 'could not log event')
	}

	return json({ ok: true })
}

// The starting-resource grant for one settlement: 1 of each adjacent
// non-desert hex's resource. Nomad: a starting settlement on the desert
// produces a resource, same as a 7-roll. One d5 per adjacent desert hex
// (settlement = 1 each), and each rolls a `nomad_produce` event so the reveal
// animation plays. Shared by `place_settlement` and the deferred grant in
// `choose_last_settlement` so the two can't drift.
function applyStartingGrant(
	state: GameState,
	playerIdx: number,
	vertex: Vertex
): { players: GameState['players']; nomadEvents: unknown[] } {
	const grant = startingResourcesForVertex(state, vertex)
	const nomadEvents: unknown[] = []
	const nomadGrant: ResourceHand = {
		brick: 0,
		wood: 0,
		sheep: 0,
		wheat: 0,
		ore: 0,
	}
	if (bonusOf(state, playerIdx) === 'nomad') {
		for (const h of boardFor(state.variant).adjacentHexes[vertex]) {
			if (state.hexes[h].resource !== null) continue
			const resource = nomadDie()
			nomadGrant[resource] += 1
			nomadEvents.push({
				kind: 'nomad_produce',
				player: playerIdx,
				resource,
				count: 1,
				at: new Date().toISOString(),
			})
		}
	}
	const players = state.players.map((p, i) => {
		if (i !== playerIdx) return p
		const r = p.resources
		return {
			...p,
			resources: {
				wood: r.wood + grant.wood + nomadGrant.wood,
				wheat: r.wheat + grant.wheat + nomadGrant.wheat,
				sheep: r.sheep + grant.sheep + nomadGrant.sheep,
				brick: r.brick + grant.brick + nomadGrant.brick,
				ore: r.ore + grant.ore + nomadGrant.ore,
			},
		}
	})
	return { players, nomadEvents }
}

// One placed piece: the working state with it applied, and the events it
// produced. The piece helpers below are shared by `place_start` and the
// per-piece actions so the grant rule and the log shape can't drift between
// them; both validate against the state they're handed, which is what lets
// `place_start` apply a second pair on top of the first.
type PlacedPiece = { state: GameState; events: unknown[] }

function placeSettlementPiece(
	state: GameState,
	meIdx: number,
	round: 1 | 2,
	vertex: Vertex,
	playerCount: number
): PlacedPiece | { error: string } {
	if (!isValidSettlementVertex(state, vertex, meIdx))
		return { error: 'invalid settlement placement' }

	const myBonus = bonusOf(state, meIdx)
	// The seat that places both settlements back-to-back nominates which one it
	// placed last (`step: 'pick_last'`) and is granted there instead. An
	// aristocrat collects on both, so it has nothing to defer or choose.
	const deferGrant =
		round === 2 &&
		myBonus !== 'aristocrat' &&
		isDoublePlacementSeat(meIdx, playerCount)
	const granted =
		(round === 2 || myBonus === 'aristocrat') && !deferGrant
			? applyStartingGrant(state, meIdx, vertex)
			: null

	return {
		state: {
			...state,
			vertices: {
				...state.vertices,
				[vertex]: {
					occupied: true as const,
					player: meIdx,
					building: 'settlement' as const,
					placedTurn: state.round,
				},
			},
			players: granted ? granted.players : state.players,
		},
		events: [
			{
				kind: 'settlement_placed',
				player: meIdx,
				vertex,
				round,
				at: new Date().toISOString(),
			},
			...(granted?.nomadEvents ?? []),
		],
	}
}

function placeRoadPiece(
	state: GameState,
	meIdx: number,
	round: 1 | 2,
	edge: Edge
): PlacedPiece | { error: string } {
	if (!isValidRoadEdge(state, meIdx, edge))
		return { error: 'invalid road placement' }

	return {
		state: {
			...state,
			edges: {
				...state.edges,
				[edge]: {
					occupied: true as const,
					player: meIdx,
					placedTurn: state.round,
				},
			},
		},
		events: [
			{
				kind: 'road_placed',
				player: meIdx,
				edge,
				round,
				at: new Date().toISOString(),
			},
		],
	}
}

// The phase the game opens on once the last road is down: `post_placement` for
// any start-of-game bonus that needs a decision, `roll` otherwise.
function endOfPlacementPhase(state: GameState): Phase {
	const specialistIdxs: number[] = []
	const explorerOwed: Partial<Record<number, number>> = {}
	const fencerOwed: Partial<Record<number, number>> = {}
	const hauntIdxs: number[] = []
	state.players.forEach((p, i) => {
		if (p.bonus === 'specialist') specialistIdxs.push(i)
		if (p.bonus === 'explorer') explorerOwed[i] = 3
		if (p.bonus === 'fencer') fencerOwed[i] = FENCE_TOKEN_COUNT
		if (p.bonus === 'haunt') hauntIdxs.push(i)
	})
	const explorerHas = Object.keys(explorerOwed).length > 0
	const fencerHas = Object.keys(fencerOwed).length > 0
	const hauntHas = hauntIdxs.length > 0
	if (specialistIdxs.length === 0 && !explorerHas && !fencerHas && !hauntHas)
		return { kind: 'roll' }
	return {
		kind: 'post_placement',
		pending: {
			specialist: specialistIdxs,
			...(explorerHas ? { explorer: explorerOwed } : {}),
			...(fencerHas ? { fencer: fencerOwed } : {}),
			...(hauntHas ? { haunt: hauntIdxs } : {}),
		},
	}
}

// A whole placement turn in one write: one settlement+road pair, or two for
// the seat the snake order hands both of its turns to back-to-back. The client
// chooses every piece locally first, so nobody else sees a half-placed turn
// and the player can take a piece back before anything is sent.
async function handlePlaceStart(
	admin: SupabaseClient,
	me: string,
	body: PlaceStartBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	if (game.status !== 'placement') return err(400, 'not in placement')
	if (state.phase.kind !== 'initial_placement') return err(400, 'wrong phase')
	// A game left mid-turn by the per-piece actions — one already deployed when
	// this shipped, or one the timeout sweep stepped through — finishes its
	// road with `place_road`. `pick_last` has its own action.
	if (state.phase.step !== 'settlement')
		return err(400, 'expected settlement step')

	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (game.current_turn !== meIdx) return err(403, 'not your turn')

	const playerCount = game.player_order.length
	const round = state.phase.round
	const pairs = Array.isArray(body.placements) ? body.placements : null
	// Exact, not "one or two": a client that miscounts fails here rather than
	// half-placing a turn.
	if (
		!pairs ||
		pairs.length !== placementPairsExpected(round, meIdx, playerCount)
	)
		return err(400, 'wrong number of placements')

	const board = boardFor(state.variant)
	let working = state
	let lastRound = round
	const events: unknown[] = []
	for (let i = 0; i < pairs.length; i++) {
		const pair = pairs[i] as { vertex?: unknown; edge?: unknown }
		if (typeof pair?.vertex !== 'string' || typeof pair?.edge !== 'string')
			return err(400, 'malformed placement')
		if (!(board.vertices as readonly string[]).includes(pair.vertex))
			return err(400, 'unknown vertex')
		if (!(board.edges as readonly string[]).includes(pair.edge))
			return err(400, 'unknown edge')

		// The second pair is that seat's round-2 turn, which the snake order
		// hands straight back to it — the events have to say so, since
		// `pick_last` reads the round stamp to find the round-2 settlement.
		const pairRound: 1 | 2 = i === 0 ? round : 2
		const settled = placeSettlementPiece(
			working,
			meIdx,
			pairRound,
			pair.vertex as Vertex,
			playerCount
		)
		if ('error' in settled) return err(400, settled.error)
		const roaded = placeRoadPiece(
			settled.state,
			meIdx,
			pairRound,
			pair.edge as Edge
		)
		if ('error' in roaded) return err(400, roaded.error)

		working = roaded.state
		lastRound = pairRound
		events.push(...settled.events, ...roaded.events)
	}

	const pieces = {
		vertices: working.vertices,
		edges: working.edges,
		players: working.players,
	}

	// Both of this seat's settlements are now down and its grant was deferred:
	// it nominates which one it placed last, and that one pays. The turn stays
	// put, and there's no notification — the player who acts next is the one
	// who just acted.
	const pickLast =
		lastRound === 2 &&
		isDoublePlacementSeat(meIdx, playerCount) &&
		bonusOf(state, meIdx) !== 'aristocrat'
	if (pickLast) {
		const { error: stateErr } = await admin
			.from('game_states')
			.update({
				...pieces,
				phase: {
					kind: 'initial_placement',
					round: 2,
					step: 'pick_last',
				} satisfies Phase,
			})
			.eq('game_id', game.id)
		if (stateErr) return err(500, 'could not update state')

		const { error: gameErr } = await admin
			.from('games')
			.update({ events: [...(game.events ?? []), ...events] })
			.eq('id', game.id)
		if (gameErr) return err(500, 'could not log event')

		return json({ ok: true })
	}

	const next = nextPlacementTurn(lastRound, meIdx, playerCount)

	if (next === null) {
		const { error: stateErr } = await admin
			.from('game_states')
			.update({ ...pieces, phase: endOfPlacementPhase(working) })
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
				events: [...(game.events ?? []), ...events, completeEvent],
			})
			.eq('id', game.id)
		if (gameErr) return err(500, 'could not update game')

		return json({ ok: true })
	}

	const { error: stateErr } = await admin
		.from('game_states')
		.update({
			...pieces,
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
			events: [...(game.events ?? []), ...events],
		})
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not update game')

	const nextUserId = game.player_order[next.currentTurn]
	if (nextUserId) {
		EdgeRuntime.waitUntil(
			sendNotifications(admin, [
				{
					userId: nextUserId,
					kind: 'your_turn',
					gate: 'yourTurn',
					gameId: game.id,
				},
			])
		)
	}

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

	if (
		!(boardFor(state.variant).vertices as readonly string[]).includes(
			body.vertex
		)
	)
		return err(400, 'unknown vertex')
	const vertex = body.vertex as Vertex

	const round = state.phase.round
	const applied = placeSettlementPiece(
		state,
		meIdx,
		round,
		vertex,
		game.player_order.length
	)
	if ('error' in applied) return err(400, applied.error)

	const nextPhase: Phase = {
		kind: 'initial_placement',
		round,
		step: 'road',
	}

	const { error: stateErr } = await admin
		.from('game_states')
		.update({
			vertices: applied.state.vertices,
			players: applied.state.players,
			phase: nextPhase,
		})
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	const { error: gameErr } = await admin
		.from('games')
		.update({ events: [...(game.events ?? []), ...applied.events] })
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

	if (
		!(boardFor(state.variant).edges as readonly string[]).includes(
			body.edge
		)
	)
		return err(400, 'unknown edge')
	const edge = body.edge as Edge

	const round = state.phase.round
	const playerCount = game.player_order.length
	const next = nextPlacementTurn(round, game.current_turn!, playerCount)

	const applied = placeRoadPiece(state, meIdx, round, edge)
	if ('error' in applied) return err(400, applied.error)
	const nextEdges = applied.state.edges
	const roadEvents = applied.events

	// A game that was already past its round-2 `place_settlement` when this
	// feature deployed was granted under the old rule, and offering the pick
	// now would either double the grant or leave the log disagreeing with the
	// hand. During initial placement a non-aristocrat seat has no other way to
	// hold cards, so a non-empty hand is an exact test for "already granted".
	const alreadyGranted =
		Object.values(state.players[meIdx]!.resources).reduce(
			(a, b) => a + b,
			0
		) > 0

	// Both of this seat's settlements are now down, and nothing fixed which it
	// placed first — it nominates one, and that one pays the starting
	// resources (deferred from `place_settlement`). The turn stays put.
	if (
		round === 2 &&
		isDoublePlacementSeat(meIdx, playerCount) &&
		bonusOf(state, meIdx) !== 'aristocrat' &&
		!alreadyGranted
	) {
		const { error: stateErr } = await admin
			.from('game_states')
			.update({
				edges: nextEdges,
				phase: {
					kind: 'initial_placement',
					round: 2,
					step: 'pick_last',
				} satisfies Phase,
			})
			.eq('game_id', game.id)
		if (stateErr) return err(500, 'could not update state')

		const { error: gameErr } = await admin
			.from('games')
			.update({ events: [...(game.events ?? []), ...roadEvents] })
			.eq('id', game.id)
		if (gameErr) return err(500, 'could not log event')

		// No notification: the player who has to act next is the one who just
		// acted, and they're looking at the screen.
		return json({ ok: true })
	}

	if (next === null) {
		const { error: stateErr } = await admin
			.from('game_states')
			.update({
				edges: nextEdges,
				phase: endOfPlacementPhase(state),
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
				events: [...(game.events ?? []), ...roadEvents, completeEvent],
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
			events: [...(game.events ?? []), ...roadEvents],
		})
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not update game')

	const nextUserId = game.player_order[next.currentTurn]
	if (nextUserId) {
		EdgeRuntime.waitUntil(
			sendNotifications(admin, [
				{
					userId: nextUserId,
					kind: 'your_turn',
					gate: 'yourTurn',
					gameId: game.id,
				},
			])
		)
	}

	return json({ ok: true })
}

// Mirror of `swapPlacementPairs` in lib/catan/placement.ts — rewrites the
// acting seat's two placement pairs in `games.events` so the log shows the
// order the player just nominated. Only the payloads move: `round` and `at`
// stay put, which keeps timestamps monotonic and each road with its own
// settlement. Located by scanning backwards rather than by index arithmetic,
// so an unrelated event landing between them can't corrupt the swap.
function swapPlacementPairs(events: unknown[], playerIdx: number): unknown[] {
	const indicesOf = (kind: string) => {
		const out: number[] = []
		for (let i = events.length - 1; i >= 0 && out.length < 2; i--) {
			const e = events[i] as { kind?: string; player?: number }
			if (e?.kind === kind && e.player === playerIdx) out.unshift(i)
		}
		return out
	}
	const settlements = indicesOf('settlement_placed')
	const roads = indicesOf('road_placed')
	// A legacy or hand-edited log that doesn't have both pairs: leave it be.
	// The grant is the part that matters and it applies either way.
	if (settlements.length < 2 || roads.length < 2) return events.slice()

	const next = events.slice()
	const swap = (idxs: number[], key: 'vertex' | 'edge') => {
		const a = { ...(next[idxs[0]] as Record<string, unknown>) }
		const b = { ...(next[idxs[1]] as Record<string, unknown>) }
		const tmp = a[key]
		a[key] = b[key]
		b[key] = tmp
		next[idxs[0]] = a
		next[idxs[1]] = b
	}
	swap(settlements, 'vertex')
	swap(roads, 'edge')
	return next
}

async function handleChooseLastSettlement(
	admin: SupabaseClient,
	me: string,
	body: ChooseLastSettlementBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	if (game.status !== 'placement') return err(400, 'not in placement')
	if (state.phase.kind !== 'initial_placement') return err(400, 'wrong phase')
	if (state.phase.step !== 'pick_last')
		return err(400, 'expected pick_last step')

	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (game.current_turn !== meIdx) return err(403, 'not your turn')

	const mine = ownSettlementVertices(state, meIdx)
	if (!mine.includes(body.vertex as Vertex))
		return err(400, 'not your settlement')
	const vertex = body.vertex as Vertex

	const applied = applyStartingGrant(state, meIdx, vertex)

	const playerCount = game.player_order.length
	// Round 2 with meIdx = playerCount - 1, so this is never the final
	// placement — round 2 still has to walk back down to seat 0.
	const next = nextPlacementTurn(2, meIdx, playerCount)
	if (next === null) return err(500, 'unexpected end of placement')

	const { error: stateErr } = await admin
		.from('game_states')
		.update({
			players: applied.players,
			phase: {
				kind: 'initial_placement',
				round: next.round,
				step: 'settlement',
			} satisfies Phase,
		})
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	// The round-2 settlement is the one already recorded last, so nominating
	// it is a no-op for the log.
	const roundTwoVertex = (game.events ?? []).reduce<string | null>(
		(found, e) => {
			const ev = e as {
				kind?: string
				player?: number
				round?: number
				vertex?: string
			}
			return ev?.kind === 'settlement_placed' &&
				ev.player === meIdx &&
				ev.round === 2
				? (ev.vertex ?? null)
				: found
		},
		null
	)
	const events =
		roundTwoVertex === vertex
			? (game.events ?? [])
			: swapPlacementPairs(game.events ?? [], meIdx)

	const { error: gameErr } = await admin
		.from('games')
		.update({
			current_turn: next.currentTurn,
			events: [...events, ...applied.nomadEvents],
		})
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not update game')

	const nextUserId = game.player_order[next.currentTurn]
	if (nextUserId) {
		EdgeRuntime.waitUntil(
			sendNotifications(admin, [
				{
					userId: nextUserId,
					kind: 'your_turn',
					gate: 'yourTurn',
					gameId: game.id,
				},
			])
		)
	}

	return json({ ok: true })
}

// Applies the downstream effect of a roll — distribution for non-7s, or
// the 7-chain (discard / move_robber) for 7s. Factored out so that the
// `confirm_roll` gambler handler and `handleRoll` (non-gambler) can share
// the tail logic. The caller is responsible for having already appended a
// `rolled` event for this dice value.
// Wrap a resolved `main` phase in the magician post-roll window when the
// roller holds the magician bonus (used where a 7-chain resolves to main).
// No-op otherwise. The non-7 path wraps inline (outside curio/forger).
function wrapMagicianWindow(
	phase: Phase,
	state: GameState,
	rollerIdx: number,
	roll: DiceRoll
): Phase {
	if (phase.kind !== 'main') return phase
	// Not just "are they the magician" — the two-player cooldown is enforced
	// by never opening the window, so the player is never shown a sheet they
	// cannot act on.
	if (!magicianCanCast(state, rollerIdx)) return phase
	return { kind: 'magician_pick', resume: phase, roller: rollerIdx, roll }
}

async function applyRollOutcome(
	admin: SupabaseClient,
	game: {
		id: string
		events: unknown[] | null
		current_turn: number | null
		player_order: string[]
	},
	state: GameState,
	dice: DiceRoll,
	extraEvents: unknown[] = [],
	options: { distributeOnlyTo?: number } = {}
): Promise<Response> {
	const total = dice.a + dice.b
	const existingEvents = [...(game.events ?? []), ...extraEvents]
	const activeIdx = game.current_turn ?? 0

	if (total === 7) {
		// Friendly robber: during the first full go-around (every seat's opening
		// turn, `round < playerCount`) a 7 does not activate the robber — no
		// discards, no move, no steal. Nomad desert production still applies and
		// the roller simply continues in `main`.
		if (
			state.config.friendlyRobber &&
			state.round < game.player_order.length
		) {
			const nomadResult = applyNomadProduce(state)
			const investorResult = applyInvestorPayout(
				{ ...state, players: nomadResult.players },
				activeIdx
			)
			const rollEvents = [...nomadResult.events, ...investorResult.events]
			const mainPhase: Phase = { kind: 'main', roll: dice, trade: null }
			const nextPhase = wrapMagicianWindow(
				mainPhase,
				{ ...state, players: investorResult.players },
				activeIdx,
				dice
			)
			const stateUpdate: Record<string, unknown> = { phase: nextPhase }
			if (rollEvents.length > 0) {
				stateUpdate.players = investorResult.players
			}
			const { error: stateErr } = await admin
				.from('game_states')
				.update(stateUpdate)
				.eq('game_id', game.id)
			if (stateErr) return err(500, 'could not update state')

			const { error: gameErr } = await admin
				.from('games')
				.update({ events: [...existingEvents, ...rollEvents] })
				.eq('id', game.id)
			if (gameErr) return err(500, 'could not log event')

			return json({ ok: true, dice, total })
		}

		// Discards are computed from the pre-nomad hands, so a nomad's own
		// desert production can never push them into discard range. Nomad
		// production is applied once every owed discard has been submitted
		// (see handleDiscard), or immediately when nobody owes one. The
		// investor's token payout rides the same deferral.
		const hoarderEvents = hoarderKeptEvents(state.players)
		// A player owing their entire hand (avarice) has nothing to decide, so
		// their discard is taken here rather than prompted for. That can empty
		// the pending set outright, in which case the discard phase is skipped.
		const forced = applyForcedDiscards(
			state.players,
			requiredDiscards(state.players)
		)
		const pending = forced.pending
		const afterForced: GameState = { ...state, players: forced.players }
		const resume: ResumePhase = { kind: 'main', roll: dice, trade: null }
		const hasDiscards = Object.keys(pending).length > 0
		const nomadResult = hasDiscards
			? { players: forced.players, events: [] as unknown[] }
			: applyNomadProduce(afterForced)
		const investorResult = hasDiscards
			? { players: nomadResult.players, events: [] as unknown[] }
			: applyInvestorPayout(
					{ ...afterForced, players: nomadResult.players },
					activeIdx
				)
		const rollEvents = [
			...forced.events,
			...nomadResult.events,
			...investorResult.events,
		]
		const nextPhase: Phase = hasDiscards
			? { kind: 'discard', resume, pending, from7: true }
			: { kind: 'move_robber', resume, from7: true }

		const stateUpdate: Record<string, unknown> = { phase: nextPhase }
		if (rollEvents.length > 0) {
			stateUpdate.players = investorResult.players
		}
		const { error: stateErr } = await admin
			.from('game_states')
			.update(stateUpdate)
			.eq('game_id', game.id)
		if (stateErr) return err(500, 'could not update state')

		const { error: gameErr } = await admin
			.from('games')
			.update({
				events: [...existingEvents, ...hoarderEvents, ...rollEvents],
			})
			.eq('id', game.id)
		if (gameErr) return err(500, 'could not log event')

		if (nextPhase.kind === 'discard') {
			const targets = Object.keys(pending)
				.map((idxStr) => game.player_order[Number(idxStr)])
				.filter((id): id is string => typeof id === 'string')
			if (targets.length > 0) {
				EdgeRuntime.waitUntil(
					sendNotifications(
						admin,
						targets.map((userId) => ({
							userId,
							kind: 'discard_required' as const,
							gate: 'yourTurn' as const,
							gameId: game.id,
						}))
					)
				)
			}
		}

		return json({ ok: true, dice, total })
	}

	const perHex = distributeResourcesByHex(state, total)
	const gains: Record<number, ResourceHand> = {}
	for (const hex of Object.keys(perHex) as Hex[]) {
		const perPlayer = perHex[hex]!
		for (const idxStr of Object.keys(perPlayer)) {
			const idx = Number(idxStr)
			if (
				options.distributeOnlyTo !== undefined &&
				idx !== options.distributeOnlyTo
			) {
				continue
			}
			gains[idx] = addHandInto(gains[idx] ?? emptyHand(), perPlayer[idx])
		}
	}

	// Plutocrat: +50% on every resource the player gained ≥ 2 of. It applies to
	// the SUMMED roll gain, so it has to land here rather than inside
	// `distributeResourcesByHex` — the per-hex breakdown feeds the forger,
	// which copies base production.
	for (const idxStr of Object.keys(gains)) {
		const idx = Number(idxStr)
		if (state.players[idx]?.bonus === 'plutocrat') {
			gains[idx] = plutocratGain(gains[idx])
		}
	}

	// Production is public at the table but nothing else in the log records
	// it, so hang the per-seat gains off the roll event itself for the action
	// log to expand. Mutating the caller's event object is safe: it was built
	// moments ago and only spread (shallow) into `existingEvents`, never
	// persisted yet. A 7 returns above, so it never reaches here.
	for (let i = extraEvents.length - 1; i >= 0; i--) {
		const e = extraEvents[i] as { kind?: string; gains?: unknown }
		if (e?.kind === 'rolled' || e?.kind === 'ritual_roll') {
			e.gains = gains
			break
		}
	}

	let nextPlayers = state.players.map((p, i) => {
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
	let stateAfter: GameState = { ...state, players: nextPlayers }
	const events: unknown[] = [...existingEvents]

	// Investor: the roller collects 1 resource per investment token with the
	// roll rather than at the top of the turn, so the payout lands after the
	// 7-chain's discard check (which returns above) can ever see it.
	const investorResult = applyInvestorPayout(stateAfter, activeIdx)
	if (investorResult.events.length > 0) {
		nextPlayers = investorResult.players
		stateAfter = { ...stateAfter, players: nextPlayers }
		events.push(...investorResult.events)
	}

	// Curio collector: queue picks for any curio_collector who gained ≥ 1
	// card from this 2/12 original roll. Skipped on bonus rolls
	// (distributeOnlyTo set), and skipped on totals other than 2/12.
	const curioPending: number[] = []
	if (
		options.distributeOnlyTo === undefined &&
		(total === 2 || total === 12)
	) {
		for (const idxStr of Object.keys(gains)) {
			const idx = Number(idxStr)
			if (
				curioCollectorTriggers(
					stateAfter.players[idx]?.bonus,
					total,
					handTotal(gains[idx])
				)
			) {
				curioPending.push(idx)
			}
		}
	}

	// Forger: queue picks for any forger whose token's hex rolled AND for whom
	// two or more other players would gain from that hex this roll (a lone
	// candidate is copied outright). Skipped on bonus rolls. Sourced from
	// `gainsFromHex`, NOT `perHex` — the forger copies through the robber, so
	// a blocked token hex still pays them.
	const forgerQueue: ForgerPickEntry[] = []
	if (options.distributeOnlyTo === undefined) {
		stateAfter.players.forEach((p, idx) => {
			if (p.bonus !== 'forger') return
			const hex = forgerTokenHex(p, state.robber)
			const perPlayer = gainsFromHex(state, hex, total)
			const candidates: Record<number, ResourceHand> = {}
			for (const cidStr of Object.keys(perPlayer)) {
				const cid = Number(cidStr)
				if (cid === idx) continue
				if (handTotal(perPlayer[cid]) <= 0) continue
				candidates[cid] = perPlayer[cid]
			}
			const candidateIds = Object.keys(candidates).map(Number)
			if (candidateIds.length === 1) {
				// Only one player to copy from — there's nothing to choose, so
				// resolve it immediately instead of prompting.
				const target = candidateIds[0]
				const gain = candidates[target]
				nextPlayers = nextPlayers.map((p, i) => {
					if (i !== idx) return p
					const r = p.resources
					return {
						...p,
						resources: {
							brick: r.brick + gain.brick,
							wood: r.wood + gain.wood,
							sheep: r.sheep + gain.sheep,
							wheat: r.wheat + gain.wheat,
							ore: r.ore + gain.ore,
						},
					}
				})
				events.push({
					kind: 'forger_copy',
					player: idx,
					target,
					gain,
					at: new Date().toISOString(),
				})
			} else if (candidateIds.length > 1) {
				forgerQueue.push({ idx, hex, gainsByCandidate: candidates })
			}
		})
	}

	const mainPhase: Phase = { kind: 'main', roll: dice, trade: null }
	let nextPhase: Phase = mainPhase

	// On a bonus roll, no sub-phases fire and we don't want to stomp the
	// active main phase (we're already inside it). Skip the phase update.
	if (options.distributeOnlyTo === undefined) {
		// Resolution order: forger first, then curio, then main. We chain
		// via the recursive `resume` field on the sub-phase variants.
		const afterForger: Phase =
			curioPending.length > 0
				? {
						kind: 'curio_pick',
						resume: mainPhase,
						pending: curioPending,
					}
				: mainPhase
		nextPhase =
			forgerQueue.length > 0
				? {
						kind: 'forger_pick',
						resume: afterForger,
						queue: forgerQueue,
					}
				: afterForger
		// Magician: if the roller is a magician, open the post-roll window
		// first (outermost), before any curio/forger reactions from others.
		if (stateAfter.players[activeIdx]?.bonus === 'magician') {
			nextPhase = {
				kind: 'magician_pick',
				resume: nextPhase,
				roller: activeIdx,
				roll: dice,
			}
		}
	}

	stateAfter = { ...stateAfter, players: nextPlayers, phase: nextPhase }

	// Fortune teller: if no pending sub-phases and active player is FT and
	// the original roll was doubles or 7, run the bonus chain synchronously.
	// Bonus rolls give resources only to FT, no robber, no curio/forger
	// triggers. Chain on doubles/7.
	if (
		nextPhase.kind === 'main' &&
		options.distributeOnlyTo === undefined &&
		fortuneTellerTriggersOn(stateAfter.players[activeIdx]?.bonus, dice)
	) {
		const ftResult = await runFortuneTellerChain(
			stateAfter,
			activeIdx,
			events
		)
		stateAfter = ftResult.state
	}

	const { error: stateErr } = await admin
		.from('game_states')
		.update({
			players: stateAfter.players,
			phase: stateAfter.phase,
		})
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	const { error: gameErr } = await admin
		.from('games')
		.update({ events })
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')

	return json({ ok: true, dice, total })
}

// Synchronous fortune-teller bonus chain. Each iteration rolls fresh dice
// and applies distribution to the FT player only (no robber, no other
// triggers). Continues while the rolled dice are doubles or sum to 7.
async function runFortuneTellerChain(
	state: GameState,
	ftIdx: number,
	events: unknown[]
): Promise<{ state: GameState }> {
	let cur = state
	// Cap the chain at 64 iterations as a safety guardrail. The expected
	// chain length is small (< 1.5) since each step has a ~1/3 chance of
	// re-triggering.
	for (let step = 0; step < 64; step++) {
		const dice = rollDice()
		const total = dice.a + dice.b
		const perHex = distributeResourcesByHex(cur, total)
		const ftGain: ResourceHand = emptyHand()
		for (const hex of Object.keys(perHex) as Hex[]) {
			const perPlayer = perHex[hex]!
			const g = perPlayer[ftIdx]
			if (g) addHandInto(ftGain, g)
		}
		// At a 5-6 player table the bonus roll pays double. Applied before the
		// hand update and the event, so the log reports what was received.
		const multiplier = fortuneTellerGainMultiplier(
			gameSizeFor(cur.players.length)
		)
		if (multiplier !== 1) {
			for (const r of RESOURCES) ftGain[r] *= multiplier
		}
		cur = {
			...cur,
			players: cur.players.map((p, i) => {
				if (i !== ftIdx) return p
				const r = p.resources
				return {
					...p,
					resources: {
						brick: r.brick + ftGain.brick,
						wood: r.wood + ftGain.wood,
						sheep: r.sheep + ftGain.sheep,
						wheat: r.wheat + ftGain.wheat,
						ore: r.ore + ftGain.ore,
					},
				}
			}),
		}
		events.push({
			kind: 'fortune_teller_roll',
			player: ftIdx,
			dice: [dice.a, dice.b],
			total,
			gain: ftGain,
			at: new Date().toISOString(),
		})
		if (!isDoubles(dice) && total !== 7) break
	}
	return { state: cur }
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
	if (state.phase.pending?.dice)
		return err(400, 'dice are already rolled; confirm or reroll')

	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (game.current_turn !== meIdx) return err(403, 'not your turn')

	// Forger: moving the token is compulsory and gates the roll. The client
	// disables Roll for the same reason, so this only catches a forged body.
	if (mustMoveForgerToken(state.players[meIdx]))
		return err(400, 'move your forger token first')

	// Admin testing: a seat flagged `dev: true` (set by hand in the row) may
	// name its own total. Silently ignored for anyone else, so a forged body
	// can't force a roll.
	let dice = rollDice()
	if (body.total !== undefined && state.players[meIdx]?.dev === true) {
		const forced = body.total
		if (
			typeof forced !== 'number' ||
			!Number.isInteger(forced) ||
			forced < 2 ||
			forced > 12
		)
			return err(400, 'invalid total (must be 2..12)')
		dice = dicePairForTotal(forced)
	}
	const total = dice.a + dice.b

	const rollEvent = {
		kind: 'rolled',
		player: meIdx,
		dice: [dice.a, dice.b],
		total,
		at: new Date().toISOString(),
	}

	// Gambler: hold the dice in phase.pending so the player can confirm or
	// reroll before distribution / 7-chain fires. No event is logged until
	// the player commits via confirm_roll. At a 5-6 player table the bonus is
	// choose-of-two instead, so a second pair is thrown now and both sit in
	// pending until confirm_roll names the winner. A dev-forced total pins the
	// first pair only, leaving the choice meaningful.
	if (bonusOf(state, meIdx) === 'gambler') {
		const chooseTwo =
			gamblerModeFor(gameSizeFor(state.players.length)) === 'choose_two'
		const pending = chooseTwo ? { dice, altDice: rollDice() } : { dice }
		const { error: stateErr } = await admin
			.from('game_states')
			.update({
				phase: { kind: 'roll', pending } satisfies Phase,
			})
			.eq('game_id', game.id)
		if (stateErr) return err(500, 'could not update state')
		return json({ ok: true, dice, total, pending: true })
	}

	return applyRollOutcome(admin, game, state, dice, [rollEvent])
}

async function handleConfirmRoll(
	admin: SupabaseClient,
	me: string,
	body: ConfirmRollBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	if (game.status !== 'active') return err(400, 'not active')
	if (state.phase.kind !== 'roll') return err(400, 'expected roll phase')
	if (!state.phase.pending?.dice)
		return err(400, 'no pending roll to confirm')

	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (game.current_turn !== meIdx) return err(403, 'not your turn')

	// `which` names the pending pair to keep — only meaningful when the
	// gambler was dealt two (choose-of-two at a 5-6 player table). Anything
	// else keeps the single pending pair, so an old client's body still works.
	const { dice: firstDice, altDice } = state.phase.pending
	const takeAlt = body.which === 1 && !!altDice
	const dice = takeAlt && altDice ? altDice : firstDice
	const total = dice.a + dice.b
	const events: Record<string, unknown>[] = []
	if (altDice) {
		const discarded = takeAlt ? firstDice : altDice
		events.push({
			kind: 'roll_choice',
			player: meIdx,
			kept_dice: [dice.a, dice.b],
			discarded_dice: [discarded.a, discarded.b],
			at: new Date().toISOString(),
		})
	}
	events.push({
		kind: 'rolled',
		player: meIdx,
		dice: [dice.a, dice.b],
		total,
		at: new Date().toISOString(),
	})
	return applyRollOutcome(admin, game, state, dice, events)
}

async function handleRerollDice(
	admin: SupabaseClient,
	me: string,
	body: RerollDiceBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	if (game.status !== 'active') return err(400, 'not active')
	if (state.phase.kind !== 'roll') return err(400, 'expected roll phase')
	if (!state.phase.pending?.dice)
		return err(400, 'nothing to reroll — roll first')

	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (game.current_turn !== meIdx) return err(403, 'not your turn')
	if (bonusOf(state, meIdx) !== 'gambler') return err(400, 'not a gambler')
	if (gamblerModeFor(gameSizeFor(state.players.length)) === 'choose_two')
		return err(400, 'gambler chooses between two rolls at this table size')

	const p = state.players[meIdx]
	if (p.rerolledThisTurn) return err(400, 'already rerolled this turn')

	const oldDice = state.phase.pending.dice
	const newDice = rollDice()
	const nextPlayers = state.players.map((pp, i) => {
		if (i !== meIdx) return pp
		return { ...pp, rerolledThisTurn: true }
	})
	// The reroll is the gambler's last roll for the turn — apply outcome
	// directly instead of holding it pending again. The UI shows it like any
	// other roll, with no further confirm/reroll affordance.
	const newState: GameState = { ...state, players: nextPlayers }
	const rerollEvent = {
		kind: 'reroll',
		player: meIdx,
		old_dice: [oldDice.a, oldDice.b],
		new_dice: [newDice.a, newDice.b],
		at: new Date().toISOString(),
	}
	const rolledEvent = {
		kind: 'rolled',
		player: meIdx,
		dice: [newDice.a, newDice.b],
		total: newDice.a + newDice.b,
		at: new Date().toISOString(),
	}
	return applyRollOutcome(admin, game, newState, newDice, [
		rerollEvent,
		rolledEvent,
	])
}

// --- Honk (mirror of lib/catan/honk.ts) ---------------------------------

const HONK_IDLE_MS = 60 * 1000

type LoggedEvent = {
	kind?: string
	at?: string
	from?: number
	player?: number
}

// Newest non-honk event timestamp. Honks are excluded on purpose: a honk isn't
// activity, and counting it would let the first honker's ping restart the idle
// window and lock every other player out for another full idle window.
function lastActivityAt(events: unknown[]): number | null {
	let newest: number | null = null
	for (const raw of events) {
		const e = raw as LoggedEvent
		if (!e || e.kind === 'honked' || typeof e.at !== 'string') continue
		const t = Date.parse(e.at)
		if (Number.isNaN(t)) continue
		if (newest === null || t > newest) newest = t
	}
	return newest
}

// Seats that already honked `target` this turn. The window is everything after
// the most recent `turn_ended`, so the allowance resets on turn advance with no
// stored state. Before the first `turn_ended` the whole log is the window. The
// allowance is per-target because one turn window can hold several stalled
// players: every special builder in the queue, then the roller.
function honkersThisTurn(events: unknown[], target: number): Set<number> {
	let start = 0
	for (let i = events.length - 1; i >= 0; i--) {
		if ((events[i] as LoggedEvent)?.kind === 'turn_ended') {
			start = i + 1
			break
		}
	}
	const honkers = new Set<number>()
	for (let i = start; i < events.length; i++) {
		const e = events[i] as LoggedEvent
		if (
			e?.kind === 'honked' &&
			typeof e.from === 'number' &&
			e.player === target
		)
			honkers.add(e.from)
	}
	return honkers
}

// The seat a honk would target right now, or null when nobody is honkable.
// During the special build phase the stalled player is the head of the build
// queue, NOT `current_turn` (which has already advanced to the next roller).
function honkTargetFor(phase: Phase, currentTurn: number): number | null {
	if (phase.kind === 'roll' || phase.kind === 'main') return currentTurn
	if (phase.kind === 'special_build') return phase.queue[0] ?? null
	return null
}

async function handleHonk(
	admin: SupabaseClient,
	me: string,
	body: HonkBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	if (game.status !== 'active') return err(400, 'not active')

	// Honking is opt-out per game. Legacy games predate the flag — treat a
	// missing value as enabled. Mirrors `gameState.config.honk !== false`.
	if (state.config.honk === false) return err(400, 'honking disabled')

	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')

	const currentTurn = game.current_turn
	if (currentTurn === null) return err(400, 'no current turn')

	// Both halves of a normal turn are honkable, plus the special build phase —
	// where the stalled player is the build-queue head, not `current_turn`. See
	// lib/catan/honk.ts.
	const target = honkTargetFor(state.phase, currentTurn)
	if (target === null) return err(400, 'not a honkable phase')
	if (target === meIdx) return err(400, 'cannot honk yourself')

	// The client gates the button on the same rules, but its clock is untrusted
	// — a stale tick or a hand-rolled call must fail here too.
	const events = game.events ?? []
	if (honkersThisTurn(events, target).has(meIdx))
		return err(400, 'already honked this turn')
	const last = lastActivityAt(events)
	if (last === null || Date.now() - last < HONK_IDLE_MS)
		return err(400, 'not idle long enough')

	const event = {
		kind: 'honked',
		player: target,
		from: meIdx,
		at: new Date().toISOString(),
	}
	const { error } = await admin
		.from('games')
		.update({ events: [...events, event] })
		.eq('id', game.id)
	if (error) return err(500, error.message)

	// Ungated by design — a honk always gets through.
	EdgeRuntime.waitUntil(
		sendNotifications(admin, [
			{
				userId: game.player_order[target],
				kind: 'honk',
				gameId: game.id,
				senderProfileId: me,
			},
		])
	)

	return json({ ok: true })
}

// --- Forfeiting and ending -------------------------------------------------
//
// Two withdrawable, per-player declarations, both stored as user-id arrays on
// the games row. Neither has any mechanical effect: a player holding a standing
// forfeit keeps their seat, their turn, their resources and every action they
// could take before. The only thing that reads them is the threshold below.
// See .claude/specs/forfeit-and-end-game.md.

// The window in which a declaration can be submitted or withdrawn: the whole
// time the game is in progress.
function inProgress(game: GameRow): boolean {
	return game.status === 'placement' || game.status === 'active'
}

// The seat this user occupies, or null. Deliberately NOT `currentPlayerIndex`,
// which returns null whenever `games.current_turn` is null — that is the entire
// simultaneous bonus-selection phase, and neither declaration has anything to
// do with holding the turn.
function seatOf(game: GameRow, me: string): number | null {
	const idx = game.player_order.indexOf(me)
	return idx < 0 ? null : idx
}

// Adds or removes `me`, returning null when the array already says what the
// caller is asking for — an idempotent re-send writes nothing and notifies
// nobody.
function toggleMembership(
	ids: string[],
	me: string,
	on: boolean
): string[] | null {
	const has = ids.includes(me)
	if (has === on) return null
	return on ? [...ids, me] : ids.filter((id) => id !== me)
}

async function handleSetForfeit(
	admin: SupabaseClient,
	me: string,
	body: SetForfeitBody
): Promise<Response> {
	if (typeof body.on !== 'boolean') return err(400, 'invalid on')

	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	if (!inProgress(game)) return err(400, 'game is over')

	const meIdx = seatOf(game, me)
	if (meIdx === null) return err(403, 'not a participant')

	const next = toggleMembership(game.forfeits ?? [], me, body.on)
	if (next === null) return json({ ok: true })

	const at = new Date().toISOString()
	const events: unknown[] = [
		{
			kind: body.on ? 'forfeit_submitted' : 'forfeit_withdrawn',
			player: meIdx,
			at,
		},
	]
	const stateUpdate: Record<string, unknown> = {}

	// Every seat but one has forfeited: the survivor wins, regardless of VP —
	// `findWinner` is not consulted. An all-N-forfeited state is unreachable,
	// since the (N-1)th forfeit always ends the game here.
	const remaining = game.player_order.filter((id) => !next.includes(id))
	const endsGame = body.on && remaining.length === 1
	const winner = endsGame ? game.player_order.indexOf(remaining[0]) : null

	if (winner !== null) {
		const gameOverPhase: Phase = { kind: 'game_over' }
		stateUpdate.phase = gameOverPhase
		events.push({
			kind: 'game_complete',
			winner,
			at,
			vpCards: vpCardCountsByPlayer(state),
			by_forfeit: true,
		})
	}

	const commitErr = await commitActionWrite(
		admin,
		game,
		stateUpdate,
		events,
		winner,
		state,
		{ gameFields: { forfeits: next }, byForfeit: true }
	)
	if (commitErr) return commitErr

	// Only the winner is told when a forfeit ends the game: everyone else chose
	// to forfeit and already knows what that means. Withdrawals notify nobody.
	const targets: NotifyTarget[] =
		winner !== null
			? [
					{
						userId: game.player_order[winner],
						kind: 'game_won_by_forfeit',
						gameId: game.id,
					},
				]
			: body.on
				? game.player_order
						.filter((id) => id !== me)
						.map((userId) => ({
							userId,
							kind: 'game_forfeited' as const,
							gameId: game.id,
							senderProfileId: me,
						}))
				: []
	if (targets.length > 0)
		EdgeRuntime.waitUntil(sendNotifications(admin, targets))

	return json({ ok: true })
}

async function handleSetEndVote(
	admin: SupabaseClient,
	me: string,
	body: SetEndVoteBody
): Promise<Response> {
	if (typeof body.on !== 'boolean') return err(400, 'invalid on')

	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	if (!inProgress(game)) return err(400, 'game is over')

	const meIdx = seatOf(game, me)
	if (meIdx === null) return err(403, 'not a participant')

	const next = toggleMembership(game.end_votes ?? [], me, body.on)
	if (next === null) return json({ ok: true })

	const at = new Date().toISOString()
	const events: unknown[] = [
		{
			kind: body.on ? 'end_game_proposed' : 'end_game_withdrawn',
			player: meIdx,
			at,
		},
	]
	const stateUpdate: Record<string, unknown> = {}

	// Ending needs the whole table, so the threshold is every seat.
	const canceled = body.on && next.length === game.player_order.length

	if (canceled) {
		const gameOverPhase: Phase = { kind: 'game_over' }
		stateUpdate.phase = gameOverPhase
		// Deliberately not a `game_complete` event: a canceled game has no
		// winner and no scoreboard to announce, and nothing downstream should
		// treat it as a completion.
		events.push({ kind: 'game_canceled', at })
	}

	const commitErr = await commitActionWrite(
		admin,
		game,
		stateUpdate,
		events,
		null,
		state,
		{ gameFields: { end_votes: next }, canceled }
	)
	if (commitErr) return commitErr

	// The last voter just tapped it; everyone else is told.
	const targets: NotifyTarget[] = canceled
		? game.player_order
				.filter((id) => id !== me)
				.map((userId) => ({
					userId,
					kind: 'game_canceled' as const,
					gameId: game.id,
				}))
		: body.on
			? game.player_order
					.filter((id) => id !== me)
					.map((userId) => ({
						userId,
						kind: 'end_game_proposed' as const,
						gameId: game.id,
						senderProfileId: me,
					}))
			: []
	if (targets.length > 0)
		EdgeRuntime.waitUntil(sendNotifications(admin, targets))

	return json({ ok: true })
}

// --- Move timeouts ---------------------------------------------------------
//
// Mirror of lib/catan/timeout.ts, plus the two halves the client has no
// business owning: stamping `games.deadline_at` after every action, and the
// cron-driven sweep that warns, then acts. See .claude/specs/move-timeouts.md.

type TimeoutOption =
	'1h' | '3h' | '12h' | '1d' | '2d' | '3d' | '4d' | '5d' | '6d' | '7d'

const T_HOUR = 60 * 60 * 1000
const T_DAY = 24 * T_HOUR

const TIMEOUT_MS: Record<TimeoutOption, number> = {
	'1h': T_HOUR,
	'3h': 3 * T_HOUR,
	'12h': 12 * T_HOUR,
	'1d': T_DAY,
	'2d': 2 * T_DAY,
	'3d': 3 * T_DAY,
	'4d': 4 * T_DAY,
	'5d': 5 * T_DAY,
	'6d': 6 * T_DAY,
	'7d': 7 * T_DAY,
}

// The window a seat gets once it has already been skipped, until it acts
// again — so an absent player is skipped about once a minute rather than
// stalling the table for another full window every go-around.
const TIMEOUT_PENALTY_MS = 60 * 1000
const WARN_HOUR_MS = T_HOUR
const WARN_TEN_MIN_MS = 10 * 60 * 1000
// Timeouts at or above this get the extra one-hour warning; 1h and 3h games
// get only the ten-minute one.
const HOUR_WARNING_MIN_TIMEOUT_MS = 12 * T_HOUR
// How many auto actions one sweep will drive through a single game. Enough to
// clear an abandoned turn that rolled a 7 (roll → discard → move robber →
// steal → end turn) in one pass. Hitting it is not a failure — the next tick
// continues.
const MAX_TIMEOUT_STEPS = 12
// Games handled per sweep tick, most overdue first.
const SWEEP_BATCH = 100

// Every row created before timeouts shipped is missing the key, and must parse
// to no clock — an in-flight game can never acquire one.
function timeoutOptionOf(config: GameConfig): TimeoutOption | null {
	const t = config?.timeout
	return typeof t === 'string' && t in TIMEOUT_MS
		? (t as TimeoutOption)
		: null
}

/**
 * Every seat the game is waiting on right now — who gets warned, who gets
 * skipped, and (client-side) whose countdown shows. Deliberately NOT
 * `current_turn`, which names the wrong seat during `special_build` and is null
 * for the whole simultaneous bonus-selection phase.
 */
function pendingSeats(phase: Phase, currentTurn: number | null): number[] {
	const turn = currentTurn === null ? [] : [currentTurn]
	switch (phase.kind) {
		case 'select_bonus':
			return Object.entries(phase.hands)
				.filter(([, hand]) => hand.chosen === null)
				.map(([idx]) => Number(idx))
		case 'post_placement': {
			const p = phase.pending
			const seats = new Set<number>(p.specialist)
			for (const idx of p.haunt ?? []) seats.add(idx)
			for (const [idx, owed] of Object.entries(p.explorer ?? {})) {
				if ((owed ?? 0) > 0) seats.add(Number(idx))
			}
			for (const [idx, owed] of Object.entries(p.fencer ?? {})) {
				if ((owed ?? 0) > 0) seats.add(Number(idx))
			}
			return [...seats].sort((a, b) => a - b)
		}
		case 'discard':
			return Object.keys(phase.pending).map(Number)
		case 'scout_pick':
			return [phase.owner]
		case 'curio_pick':
			return [...phase.pending]
		case 'forger_pick':
			return phase.queue.length > 0 ? [phase.queue[0].idx] : []
		case 'magician_pick':
			return [phase.roller]
		case 'special_build':
			return phase.queue.length > 0 ? [phase.queue[0]] : []
		case 'game_over':
			return []
		default:
			// initial_placement, roll, main, move_robber, steal, road_building
			return turn
	}
}

function deadlineFor(args: {
	timeout: TimeoutOption | null
	phase: Phase
	currentTurn: number | null
	playerOrder: string[]
	timedOut: string[]
	now: number
}): string | null {
	const { timeout, phase, currentTurn, playerOrder, timedOut, now } = args
	if (timeout === null) return null
	const pending = pendingSeats(phase, currentTurn)
	if (pending.length === 0) return null
	const penalized = pending.some((idx) => {
		const userId = playerOrder[idx]
		return userId !== undefined && timedOut.includes(userId)
	})
	const window = penalized ? TIMEOUT_PENALTY_MS : TIMEOUT_MS[timeout]
	return new Date(now + window).toISOString()
}

// The warning stage a game is due, or null. Stages never repeat and never go
// backwards, so a game first seen inside its final ten minutes just gets
// stage 2 rather than both.
function warningStageDue(args: {
	timeout: TimeoutOption
	deadlineAt: number
	warned: number
	now: number
}): 1 | 2 | null {
	const { timeout, deadlineAt, warned, now } = args
	const remaining = deadlineAt - now
	if (warned < 2 && remaining <= WARN_TEN_MIN_MS) return 2
	if (
		warned < 1 &&
		TIMEOUT_MS[timeout] >= HOUR_WARNING_MIN_TIMEOUT_MS &&
		remaining <= WARN_HOUR_MS
	)
		return 1
	return null
}

/**
 * Re-stamps `games.deadline_at` after an action. Called from `serve` for every
 * successful game action — one place, rather than in each of the fifty
 * handlers — and inside `EdgeRuntime.waitUntil`, since nothing is waiting on it.
 *
 * `actor` is dropped from `timed_out`: taking any real action is what returns a
 * skipped player to the full window.
 *
 * Honk and chat deliberately never reach here (see `serve`). A honk writes a
 * `games.events` entry but must not push the deadline out — the same reason
 * `lastActivityAt` ignores honks: the nudge is a complaint about the stall, not
 * an escape from it.
 */
async function refreshDeadline(
	admin: SupabaseClient,
	gameId: string,
	actor: string | null
): Promise<void> {
	// Deliberately not `loadGame`: this runs after every action, and a game with
	// no timeout — the default, and most of them — must not pay for a
	// `game_states` read it will do nothing with.
	const { data: row, error: loadErr } = await admin
		.from('games')
		.select(
			'id, status, config, current_turn, player_order, deadline_at, timed_out'
		)
		.eq('id', gameId)
		.maybeSingle()
	if (loadErr || !row) return
	const game = row as Pick<
		GameRow,
		| 'id'
		| 'status'
		| 'config'
		| 'current_turn'
		| 'player_order'
		| 'deadline_at'
		| 'timed_out'
	>

	const prevTimedOut = game.timed_out ?? []
	const timedOut = actor
		? prevTimedOut.filter((id) => id !== actor)
		: prevTimedOut
	const timeout = timeoutOptionOf(game.config)
	const live =
		timeout !== null &&
		(game.status === 'placement' || game.status === 'active')

	let deadline: string | null = null
	if (live) {
		const { data: stateRow } = await admin
			.from('game_states')
			.select('phase')
			.eq('game_id', gameId)
			.maybeSingle()
		if (!stateRow) return
		deadline = deadlineFor({
			timeout,
			phase: stateRow.phase as Phase,
			currentTurn: game.current_turn,
			playerOrder: game.player_order,
			timedOut,
			now: Date.now(),
		})
	}

	const update: Record<string, unknown> = {}
	// Both null is the overwhelmingly common case — a game with no clock — and
	// writes nothing at all rather than emitting a realtime event per action.
	if (deadline !== null || game.deadline_at !== null) {
		update.deadline_at = deadline
		update.timeout_warned = 0
	}
	if (timedOut.length !== prevTimedOut.length) update.timed_out = timedOut
	if (Object.keys(update).length === 0) return

	const { error } = await admin.from('games').update(update).eq('id', gameId)
	if (error) console.warn('[timeouts] deadline refresh failed', error.message)
}

/**
 * The cron sweep. Runs every minute (see the migration), authorized by the
 * service-role key rather than a user JWT — there is no user behind it.
 *
 * Each game is swept independently: one failure never aborts the others.
 */
async function handleRunTimeouts(admin: SupabaseClient): Promise<Response> {
	// One indexed query. The horizon is the widest warning lead plus a tick of
	// slack, so a sweep only loads games that could owe something.
	const horizon = new Date(Date.now() + WARN_HOUR_MS + 60_000).toISOString()
	const { data, error } = await admin
		.from('games')
		.select('id')
		.in('status', ['placement', 'active'])
		.not('deadline_at', 'is', null)
		.lte('deadline_at', horizon)
		// Most overdue first, and bounded: a sweep that ran past the function's
		// own limit would drop whatever it hadn't reached anyway. Anything left
		// over is still expired a minute later, so the next tick takes it.
		.order('deadline_at', { ascending: true })
		.limit(SWEEP_BATCH)
	if (error) return err(500, 'timeout sweep failed')

	const rows = (data ?? []) as { id: string }[]
	if (rows.length === SWEEP_BATCH) {
		console.warn('[timeouts] sweep batch full', SWEEP_BATCH)
	}
	let warned = 0
	let expired = 0
	for (const row of rows) {
		try {
			const outcome = await sweepGame(admin, row.id)
			if (outcome === 'warned') warned++
			else if (outcome === 'expired') expired++
		} catch (e) {
			console.error('[timeouts] sweep failed', row.id, e)
		}
	}
	return json({ ok: true, scanned: rows.length, warned, expired })
}

async function sweepGame(
	admin: SupabaseClient,
	gameId: string
): Promise<'warned' | 'expired' | 'none'> {
	const loaded = await loadGame(admin, gameId)
	if (!loaded.ok) return 'none'
	const { game, state } = loaded

	const timeout = timeoutOptionOf(game.config)
	const pending = pendingSeats(state.phase, game.current_turn)
	// The row can't have a live deadline — clear it so the sweep stops
	// selecting it. (Reachable if a game ends through a path that somehow
	// skipped the refresh, or sits in a phase waiting on nobody.)
	if (
		!inProgress(game) ||
		timeout === null ||
		!game.deadline_at ||
		pending.length === 0
	) {
		if (game.deadline_at !== null) {
			await admin
				.from('games')
				.update({ deadline_at: null })
				.eq('id', gameId)
		}
		return 'none'
	}

	const deadlineAt = Date.parse(game.deadline_at)
	const now = Date.now()

	if (now < deadlineAt) {
		// A seat inside its one-minute penalty window is never warned — there
		// is no room for a ten-minute warning in a one-minute window.
		const flagged = new Set(game.timed_out ?? [])
		const targets = pending
			.map((idx) => game.player_order[idx])
			.filter((id) => id !== undefined && !flagged.has(id))
		if (targets.length === 0) return 'none'
		const stage = warningStageDue({
			timeout,
			deadlineAt,
			warned: game.timeout_warned ?? 0,
			now,
		})
		if (stage === null) return 'none'

		const { error } = await admin
			.from('games')
			.update({ timeout_warned: stage })
			.eq('id', gameId)
		if (error) return 'none'
		EdgeRuntime.waitUntil(
			sendNotifications(
				admin,
				targets.map((userId) => ({
					userId,
					kind: 'turn_timeout_warning' as const,
					gameId,
					bodyOverride:
						stage === 1
							? 'Your turn ends in an hour.'
							: 'Your turn ends in 10 minutes.',
				}))
			)
		)
		return 'warned'
	}

	await applyTimeout(admin, game, state, pending)
	return 'expired'
}

/**
 * The deadline passed. At two players that ends the game; above two the
 * expired seats are auto-resolved and the turn moves on.
 */
async function applyTimeout(
	admin: SupabaseClient,
	game: GameRow,
	state: GameState,
	pending: number[]
): Promise<void> {
	const expiredIds = pending
		.map((idx) => game.player_order[idx])
		.filter((id): id is string => typeof id === 'string')
	if (expiredIds.length === 0) return

	if (game.player_order.length === 2) {
		await applyTwoPlayerTimeout(admin, game, state, pending, expiredIds)
		return
	}

	// Three or more: skip. Every auto action goes through the ordinary handler
	// via `dispatch`, so no game rule is re-implemented here and the action is
	// indistinguishable from that player having tapped the button.
	const expired = new Set(expiredIds)
	// Seats we actually moved past. A phase that offered no legal choice leaves
	// its seat out of this, so it is neither flagged nor told its turn was
	// skipped — nothing was.
	const skipped = new Set<string>()
	let cur = { game, state }
	for (let step = 0; step < MAX_TIMEOUT_STEPS; step++) {
		const seats = pendingSeats(
			cur.state.phase,
			cur.game.current_turn
		).filter((idx) => expired.has(cur.game.player_order[idx]))
		// Nobody expired is on the clock any more — the game is waiting on
		// someone who still has their own full window.
		if (seats.length === 0) break

		const body = autoActionFor(cur.state, cur.game, seats[0])
		if (!body) {
			// A state a human couldn't act on either. Leave it for the next
			// tick rather than throwing and taking the sweep down.
			console.warn('[timeouts] no legal auto action', {
				game: cur.game.id,
				phase: cur.state.phase.kind,
				seat: seats[0],
			})
			break
		}
		const res = await dispatch(admin, cur.game.player_order[seats[0]], body)
		if (!res.ok) {
			console.warn('[timeouts] auto action rejected', {
				game: cur.game.id,
				action: body.action,
				status: res.status,
			})
			break
		}
		skipped.add(cur.game.player_order[seats[0]])
		const reloaded = await loadGame(admin, cur.game.id)
		if (!reloaded.ok) return
		cur = reloaded
		if (!inProgress(cur.game)) break
	}

	// Nothing was legal to do. Leave the row untouched so the next tick tries
	// again rather than telling anyone their turn was skipped.
	if (skipped.size === 0) return

	// `dispatch` was called directly, so serve's post-action bookkeeping never
	// ran — the runner owns it. The skipped seats stay flagged (they did not
	// act; only a real action clears that), which is what shortens their next
	// window to a minute.
	const timedOut = [...new Set([...(cur.game.timed_out ?? []), ...skipped])]
	const deadline = inProgress(cur.game)
		? deadlineFor({
				timeout: timeoutOptionOf(cur.game.config),
				phase: cur.state.phase,
				currentTurn: cur.game.current_turn,
				playerOrder: cur.game.player_order,
				timedOut,
				now: Date.now(),
			})
		: null
	await admin
		.from('games')
		.update({
			timed_out: timedOut,
			deadline_at: deadline,
			timeout_warned: 0,
		})
		.eq('id', cur.game.id)
	// An auto action must not leave an undo snapshot behind for the next player
	// to take back. Guarded, so the usual case matches no rows.
	await admin
		.from('game_states')
		.update({ undo: null })
		.eq('game_id', cur.game.id)
		.not('undo', 'is', null)

	EdgeRuntime.waitUntil(
		sendNotifications(
			admin,
			[...skipped].map((userId) => ({
				userId,
				kind: 'turn_timed_out' as const,
				gameId: game.id,
			}))
		)
	)
}

/**
 * Two players: running out of time is losing. Reuses the forfeit machinery
 * wholesale — the timed-out player joins `games.forfeits` and the game
 * completes with the other as winner — so a timeout counts toward games played
 * and win rate exactly like a manual forfeit and needs no new stats shape.
 *
 * With both seats pending (only reachable in the simultaneous phases) nobody
 * was there to win, so the game is canceled instead: no winner, no
 * `game_results` rows.
 */
async function applyTwoPlayerTimeout(
	admin: SupabaseClient,
	game: GameRow,
	state: GameState,
	pending: number[],
	expiredIds: string[]
): Promise<void> {
	const at = new Date().toISOString()
	const gameOverPhase: Phase = { kind: 'game_over' }
	const everyoneIdle = expiredIds.length >= game.player_order.length

	if (everyoneIdle) {
		await commitActionWrite(
			admin,
			game,
			{ phase: gameOverPhase },
			[{ kind: 'game_canceled', at }],
			null,
			state,
			{
				canceled: true,
				gameFields: { deadline_at: null, timed_out: expiredIds },
			}
		)
		EdgeRuntime.waitUntil(
			sendNotifications(
				admin,
				game.player_order.map((userId) => ({
					userId,
					kind: 'game_canceled' as const,
					gameId: game.id,
				}))
			)
		)
		return
	}

	const loserIdx = pending[0]
	const loserId = game.player_order[loserIdx]
	// An in-progress 2-player game can't already hold a forfeit: the first one
	// would have ended it. So the survivor is the other seat, full stop.
	const forfeits = [...new Set([...(game.forfeits ?? []), loserId])]
	const winner = game.player_order.findIndex((id) => !forfeits.includes(id))
	if (winner < 0) return

	await commitActionWrite(
		admin,
		game,
		{ phase: gameOverPhase },
		[
			// The seat really is in `games.forfeits` now, so the log and the
			// array agree — and PlayerStrip's forfeit flag stays truthful.
			{ kind: 'forfeit_submitted', player: loserIdx, at },
			{
				kind: 'game_complete',
				winner,
				at,
				vpCards: vpCardCountsByPlayer(state),
				by_forfeit: true,
			},
		],
		winner,
		state,
		{
			byForfeit: true,
			gameFields: {
				forfeits,
				deadline_at: null,
				timed_out: [...new Set([...(game.timed_out ?? []), loserId])],
			},
		}
	)

	EdgeRuntime.waitUntil(
		sendNotifications(admin, [
			{
				userId: loserId,
				kind: 'turn_timed_out',
				gameId: game.id,
				bodyOverride: 'You ran out of time and lost the game.',
			},
			{
				userId: game.player_order[winner],
				kind: 'game_won_by_forfeit',
				gameId: game.id,
			},
		])
	)
}

/**
 * An arbitrary legal choice for the seat that ran out of time, as a body for
 * its ordinary handler. Returns null when the phase offers no legal option —
 * a state a human couldn't act on either.
 *
 * Exhaustive over `Phase['kind']`: a new phase must fail to compile rather than
 * silently becoming un-timeout-able.
 */
function autoActionFor(
	state: GameState,
	game: GameRow,
	seat: number
): Body | null {
	const gid = game.id
	const board = boardFor(state.variant)
	const phase = state.phase

	switch (phase.kind) {
		case 'select_bonus': {
			const hand = phase.hands[seat]
			if (!hand) return null
			// The curse rides along: a hand dealt more than one is only
			// resolved by naming it here.
			return {
				action: 'pick_bonus',
				game_id: gid,
				bonus: hand.offered[0],
				curse: handCurses(hand)[0],
			}
		}
		case 'initial_placement': {
			if (phase.step === 'settlement') {
				const v = randomOf(
					board.vertices.filter((v) =>
						isValidSettlementVertex(state, v, seat)
					)
				)
				return v
					? { action: 'place_settlement', game_id: gid, vertex: v }
					: null
			}
			if (phase.step === 'road') {
				const e = randomOf(
					board.edges.filter((e) => isValidRoadEdge(state, seat, e))
				)
				return e
					? { action: 'place_road', game_id: gid, edge: e }
					: null
			}
			// pick_last: nominate the round-2 settlement — the value the UI
			// pre-seeds, and a no-op against today's rules.
			const v = roundTwoSettlementOf(game.events ?? [], seat)
			return v
				? { action: 'choose_last_settlement', game_id: gid, vertex: v }
				: null
		}
		case 'post_placement': {
			const p = phase.pending
			if (p.specialist.includes(seat)) {
				return {
					action: 'set_specialist_resource',
					game_id: gid,
					resource: 'brick',
				}
			}
			if ((p.explorer?.[seat] ?? 0) > 0) {
				const e = randomOf(validBuildRoadEdges(state, seat))
				return e
					? { action: 'place_explorer_road', game_id: gid, edge: e }
					: null
			}
			if ((p.fencer?.[seat] ?? 0) > 0) {
				const e = randomOf(
					board.edges.filter(
						(e) =>
							!edgeStateOf(state, e).occupied &&
							state.fenceTokens?.[e] === undefined
					)
				)
				return e
					? { action: 'place_fence_token', game_id: gid, edge: e }
					: null
			}
			if ((p.haunt ?? []).includes(seat)) {
				const spots = shuffle(
					board.vertices.filter((v) =>
						isValidSettlementVertex(state, v)
					)
				).slice(0, HAUNT_SPOT_COUNT)
				return spots.length === HAUNT_SPOT_COUNT
					? { action: 'set_haunt_spots', game_id: gid, spots }
					: null
			}
			return null
		}
		case 'roll':
			// A gambler's dice are already thrown and waiting on a decision;
			// take the first pair. Everyone else just rolls.
			return phase.pending
				? { action: 'confirm_roll', game_id: gid, which: 0 }
				: { action: 'roll', game_id: gid }
		case 'main':
			return { action: 'end_turn', game_id: gid }
		case 'discard': {
			const required = phase.pending[seat]
			if (!required) return null
			const discard = arbitraryDiscard(
				state.players[seat]?.resources,
				required
			)
			return discard ? { action: 'discard', game_id: gid, discard } : null
		}
		case 'move_robber': {
			const hex = randomOf(board.hexes.filter((h) => h !== state.robber))
			return hex ? { action: 'move_robber', game_id: gid, hex } : null
		}
		case 'steal': {
			const victim = randomOf(phase.candidates)
			return victim === null
				? null
				: { action: 'steal', game_id: gid, victim }
		}
		case 'road_building': {
			const e = randomOf(validBuildRoadEdges(state, seat))
			return e ? { action: 'build_road', game_id: gid, edge: e } : null
		}
		case 'scout_pick':
			return { action: 'confirm_scout_card', game_id: gid, index: 0 }
		case 'curio_pick':
			return {
				action: 'claim_curio',
				game_id: gid,
				take: ['brick', 'wood', 'sheep'],
			}
		case 'forger_pick': {
			const head = phase.queue[0]
			if (!head) return null
			const target = Object.keys(head.gainsByCandidate)[0]
			return target === undefined
				? null
				: {
						action: 'pick_forger_target',
						game_id: gid,
						target: Number(target),
					}
		}
		case 'magician_pick':
			return { action: 'skip_magic', game_id: gid }
		case 'special_build':
			return { action: 'end_special_build', game_id: gid }
		case 'game_over':
			return null
	}
}

function randomOf<T>(xs: readonly T[]): T | null {
	if (xs.length === 0) return null
	return xs[Math.floor(Math.random() * xs.length)]
}

// The settlement this seat placed on round 2 — the default answer on the
// `pick_last` step. Mirrors roundTwoSettlementOf in lib/game/gameScreenContext.
function roundTwoSettlementOf(events: unknown[], seat: number): string | null {
	for (let i = events.length - 1; i >= 0; i--) {
		const e = events[i] as {
			kind?: string
			player?: number
			round?: number
			vertex?: string
		}
		if (
			e?.kind === 'settlement_placed' &&
			e.player === seat &&
			e.round === 2 &&
			typeof e.vertex === 'string'
		)
			return e.vertex
	}
	return null
}

// Any legal discard of `required` cards, taken off the hand in resource order.
function arbitraryDiscard(
	hand: ResourceHand | undefined,
	required: number
): ResourceHand | null {
	if (!hand) return null
	const out = emptyHand()
	let left = required
	for (const r of RESOURCES) {
		const take = Math.min(left, hand[r])
		out[r] = take
		left -= take
		if (left === 0) break
	}
	return left === 0 ? out : null
}

// Chat has no rules layer, so unlike every other handler here it mirrors
// nothing from lib/catan/. See .claude/specs/game-chat.md.

const CHAT_MAX_CHARS = 500
// Mirrors CHAT_PRESENCE_MS in lib/catan/chatContext.tsx. The client heartbeats
// last_read_at every 15s while the panel is open, so a 30s window tolerates one
// missed beat before we consider someone away.
const CHAT_PRESENCE_MS = 30_000

// Service-role mirror of the spectator RLS predicate (see the migration and
// .claude/specs/spectating.md): the game opted in, the caller is not seated,
// and they are friends with at least one player. The admin client bypasses RLS,
// so this check is the whole authorization — keep it in step with the policy.
async function isGameSpectator(
	admin: SupabaseClient,
	participants: string[],
	spectatorsEnabled: boolean,
	me: string
): Promise<boolean> {
	if (!spectatorsEnabled) return false
	if (participants.includes(me)) return false

	const { data } = await admin
		.from('friends')
		.select('user_id_a, user_id_b')
		.or(`user_id_a.eq.${me},user_id_b.eq.${me}`)

	const friendIds = new Set(
		((data ?? []) as { user_id_a: string; user_id_b: string }[]).map((r) =>
			r.user_id_a === me ? r.user_id_b : r.user_id_a
		)
	)
	return participants.some((p) => friendIds.has(p))
}

async function handleSendMessage(
	admin: SupabaseClient,
	me: string,
	body: SendMessageBody
): Promise<Response> {
	if (typeof body.body !== 'string') return err(400, 'bad body')
	const text = body.body.trim()
	if (!text) return err(400, 'empty message')
	if (text.length > CHAT_MAX_CHARS) return err(400, 'message too long')

	// Deliberately not loadGame: chat needs no game_state, and it stays open on
	// completed games, so there is no status precondition to check.
	const { data: game, error: gameErr } = await admin
		.from('games')
		.select('id, participants, config')
		.eq('id', body.game_id)
		.maybeSingle()
	if (gameErr) return err(500, gameErr.message)
	if (!game) return err(404, 'game not found')

	const participants = (game.participants ?? []) as string[]
	if (
		!participants.includes(me) &&
		!(await isGameSpectator(
			admin,
			participants,
			(game.config as GameConfig | null)?.spectators === true,
			me
		))
	) {
		return err(403, 'not a participant')
	}

	const { data: inserted, error } = await admin
		.from('game_messages')
		.insert({ game_id: game.id, sender: me, body: text })
		.select('id')
		.single()
	if (error) return err(500, error.message)

	EdgeRuntime.waitUntil(notifyChat(admin, game.id, participants, me, text))

	return json({ ok: true, id: inserted.id })
}

// Everyone in the game except the sender and anyone whose read cursor says they
// are looking at the thread right now.
//
// Spectators send into this thread but are never targets: they are not
// enumerable server-side (presence is ephemeral, and game_chat_reads would only
// cover ones who had opened the panel once, then keep pushing them long after
// they stopped watching). Watching is a foreground activity — realtime covers
// it. A spectator's message still pushes the players, per the spec.
async function notifyChat(
	admin: SupabaseClient,
	gameId: string,
	participants: string[],
	sender: string,
	text: string
): Promise<void> {
	const { data: reads } = await admin
		.from('game_chat_reads')
		.select('user_id, last_read_at')
		.eq('game_id', gameId)

	const cutoff = Date.now() - CHAT_PRESENCE_MS
	const reading = new Set<string>()
	for (const row of (reads ?? []) as {
		user_id: string
		last_read_at: string
	}[]) {
		if (Date.parse(row.last_read_at) >= cutoff) reading.add(row.user_id)
	}

	const targets = participants
		.filter((id) => id !== sender && !reading.has(id))
		.map((userId) => ({
			userId,
			kind: 'chat_message' as const,
			gate: 'chatMessage' as const,
			gameId,
			senderProfileId: sender,
			titleFrom: 'sender' as const,
			bodyOverride: text,
		}))

	await sendNotifications(admin, targets)
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

	// Clear the outgoing active player's one-per-turn dev flag so they can
	// play again when it becomes their turn again. Round bumps monotonically
	// so dev-cards bought last turn become playable now. Also reset the
	// age-curse per-turn spend counter, the gambler reroll flag, and the
	// carpenter per-turn flag.
	const nextPlayers = state.players.map((p, i) => {
		if (i !== meIdx) return p
		const next: PlayerState = { ...p, playedDevThisTurn: false }
		if (p.curse === 'age') next.cardsSpentThisTurn = 0
		if (p.rerolledThisTurn) next.rerolledThisTurn = false
		if (p.boughtCarpenterVPThisTurn) next.boughtCarpenterVPThisTurn = false
		if (p.ritualWasUsedThisTurn) next.ritualWasUsedThisTurn = false
		if (p.shepherdUsedThisTurn) next.shepherdUsedThisTurn = false
		if (p.forgerMovedThisTurn) next.forgerMovedThisTurn = false
		return next
	})
	const nextRound = state.round + 1

	// The investor's token payout is not applied here: it lands once the
	// incoming player's roll has resolved (see applyInvestorPayout) so the
	// gained cards can't count towards their 7-card discard.
	const events: unknown[] = [
		{ kind: 'turn_ended', player: meIdx, at: new Date().toISOString() },
	]

	// A 5-6 player game may insert a special build phase between this turn and
	// the next player's roll (config.extraBuild). Build the queue from the seat
	// that just finished, then drop leading players who can't act.
	const sbState: GameState = {
		...state,
		players: nextPlayers,
		round: nextRound,
	}
	// Games created before this feature have no `extraBuild` in their stored
	// config — default to disabled so an in-flight game is never disrupted.
	const eb: ExtraBuildConfig = state.config.extraBuild ?? {
		enabled: false,
		buildPhases: 'every',
		moreThanSeven: false,
	}
	const sbQueue = drainSpecialBuildQueue(
		sbState,
		specialBuildQueue(eb, meIdx, game.player_order.length)
	)
	const nextPhase: Phase =
		sbQueue.length > 0
			? { kind: 'special_build', queue: sbQueue }
			: { kind: 'roll' }

	const { error: stateErr } = await admin
		.from('game_states')
		.update({
			phase: nextPhase,
			players: nextPlayers,
			round: nextRound,
		})
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	const { error: gameErr } = await admin
		.from('games')
		.update({
			current_turn: nextTurn,
			events: [...(game.events ?? []), ...events],
		})
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not update game')

	// Notify whoever acts next: the first special-builder, else the next roller.
	const notifyIdx = sbQueue.length > 0 ? sbQueue[0] : nextTurn
	const nextUserId = game.player_order[notifyIdx]
	if (nextUserId) {
		EdgeRuntime.waitUntil(
			sendNotifications(admin, [
				{
					userId: nextUserId,
					kind: 'your_turn',
					gate: 'yourTurn',
					gameId: game.id,
				},
			])
		)
	}

	return json({ ok: true })
}

async function handleEndSpecialBuild(
	admin: SupabaseClient,
	me: string,
	body: EndSpecialBuildBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	if (game.status !== 'active') return err(400, 'not active')
	if (state.phase.kind !== 'special_build')
		return err(400, 'expected special build phase')

	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (state.phase.queue[0] !== meIdx) return err(403, 'not your build')

	// Age-cursed SBP spend is NOT a self-contained window: it accumulates in
	// `cardsSpentThisTurn` and counts toward the card limit of the builder's own
	// following turn. The counter is only cleared on their `end_turn`.
	const nextPlayers = state.players

	// Pop the head, then skip any following players who cannot act.
	const remaining = drainSpecialBuildQueue(
		{ ...state, players: nextPlayers },
		state.phase.queue.slice(1)
	)
	const nextPhase: Phase =
		remaining.length > 0
			? { kind: 'special_build', queue: remaining }
			: { kind: 'roll' }

	const { error: stateErr } = await admin
		.from('game_states')
		.update({ phase: nextPhase, players: nextPlayers })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	// Notify the next actor: the next builder, else the roller (current_turn).
	const notifyIdx =
		remaining.length > 0 ? remaining[0] : (game.current_turn ?? 0)
	const nextUserId = game.player_order[notifyIdx]
	if (nextUserId) {
		EdgeRuntime.waitUntil(
			sendNotifications(admin, [
				{
					userId: nextUserId,
					kind: 'your_turn',
					gate: 'yourTurn',
					gameId: game.id,
				},
			])
		)
	}

	return json({ ok: true })
}

async function preflightBuild(
	admin: SupabaseClient,
	me: string,
	gameId: string,
	// When true, the acting player of a `special_build` phase (not the
	// turn-holder) is also allowed. Only road/settlement/city/dev/bank permit
	// this — super-city and liquidate stay main-only (pass false / omit).
	allowSpecialBuild = false
): Promise<
	| { ok: true; game: GameRow; state: GameState; meIdx: number }
	| { ok: false; response: Response }
> {
	const loaded = await loadGame(admin, gameId)
	if (!loaded.ok) return loaded
	const { game, state } = loaded
	if (game.status !== 'active')
		return { ok: false, response: err(400, 'not active') }
	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null)
		return { ok: false, response: err(403, 'not a participant') }
	const inMain = state.phase.kind === 'main' && game.current_turn === meIdx
	const inSpecial = allowSpecialBuild && isSpecialBuildActor(state, meIdx)
	if (!inMain && !inSpecial) {
		if (state.phase.kind !== 'main' && state.phase.kind !== 'special_build')
			return { ok: false, response: err(400, 'expected main phase') }
		return { ok: false, response: err(403, 'not your turn') }
	}
	return { ok: true, game, state, meIdx }
}

function applyCost(
	players: PlayerState[],
	meIdx: number,
	cost: ResourceHand
): PlayerState[] {
	const size = costSize(cost)
	return players.map((p, i) => {
		if (i !== meIdx) return p
		const next: PlayerState = {
			...p,
			resources: deductHand(p.resources, cost),
		}
		// Age-cursed players accumulate their turn spend; everyone else skips
		// the field entirely (it's sparse).
		if (p.curse === 'age') {
			next.cardsSpentThisTurn = (p.cardsSpentThisTurn ?? 0) + size
		}
		return next
	})
}

async function handleBuildRoad(
	admin: SupabaseClient,
	me: string,
	body: BuildRoadBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	if (game.status !== 'active') return err(400, 'not active')
	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')

	const phase = state.phase
	const isRoadBuilding = phase.kind === 'road_building'
	// A special-build actor may pay for a road out of turn; main/road_building
	// still require it be your turn.
	const isSpecial = isSpecialBuildActor(state, meIdx)
	if (phase.kind !== 'main' && !isRoadBuilding && !isSpecial)
		return err(400, 'expected main, road_building, or special_build phase')
	if (!isSpecial && game.current_turn !== meIdx)
		return err(403, 'not your turn')

	if (
		!(boardFor(state.variant).edges as readonly string[]).includes(
			body.edge
		)
	)
		return err(400, 'unknown edge')
	const edge = body.edge as Edge

	if (!isValidBuildRoadEdge(state, meIdx, edge))
		return err(400, 'invalid road')

	let nextPlayers: PlayerState[]
	let nextPhase: Phase | null = null
	if (isRoadBuilding) {
		nextPlayers = state.players
		// Speculatively place the new edge so we can check for legal follow-up
		// placements before committing the phase transition.
		const afterPlace: GameState = {
			...state,
			edges: {
				...state.edges,
				[edge]: {
					occupied: true as const,
					player: meIdx,
					placedTurn: state.round,
				},
			},
		}
		const remainingAfter = phase.remaining - 1
		if (remainingAfter === 0 || !hasLegalRoadPlacement(afterPlace, meIdx)) {
			nextPhase = phase.resume
		} else {
			nextPhase = {
				kind: 'road_building',
				resume: phase.resume,
				remaining: remainingAfter as 1,
			}
		}
	} else {
		const meP = state.players[meIdx]
		// Fencer building on their own reserved edge → pay 1 Wood or Brick.
		const onOwnFence =
			meP.bonus === 'fencer' && fenceOwner(state, edge) === meIdx
		let cost: ResourceHand | null
		if (onOwnFence) {
			const want = body.fence_pay === 'brick' ? 'brick' : 'wood'
			// Fall back to the other card when the requested one isn't in hand:
			// a fencer holding only one of the two has no choice to express.
			const pay =
				meP.resources[want] > 0
					? want
					: want === 'wood'
						? 'brick'
						: 'wood'
			cost = fenceRoadCost(pay)
			if (!canAfford(meP.resources, cost))
				return err(400, 'insufficient resources')
		} else {
			cost = resolvePurchaseCost(
				meP,
				BUILD_COSTS.road,
				!!body.use_bricklayer,
				body.smith_swap ?? 0
			)
		}
		if (!cost) return err(400, 'insufficient resources')
		if (
			!canSpendUnderAge(
				meP,
				costSize(cost),
				gameSizeFor(state.players.length)
			)
		)
			return err(400, 'age limit reached this turn')
		nextPlayers = applyCost(state.players, meIdx, cost)
	}

	const nextEdges = {
		...state.edges,
		[edge]: {
			occupied: true as const,
			player: meIdx,
			placedTurn: state.round,
		},
	}

	// Consume the fence token once the fencer builds a road on the reserved
	// edge (whether paid or a free Road Building placement).
	let nextFenceTokens = state.fenceTokens
	if (state.fenceTokens?.[edge] === meIdx) {
		nextFenceTokens = { ...state.fenceTokens }
		delete nextFenceTokens[edge]
	}

	const update: Record<string, unknown> = {
		edges: nextEdges,
		players: nextPlayers,
	}
	if (nextFenceTokens !== state.fenceTokens)
		update.fence_tokens = nextFenceTokens
	if (nextPhase) update.phase = nextPhase

	const nextState: GameState = {
		...state,
		players: nextPlayers,
		edges: nextEdges,
		phase: nextPhase ?? state.phase,
	}
	const events: unknown[] = [
		{
			kind: 'road_built',
			player: meIdx,
			edge,
			at: new Date().toISOString(),
		},
	]
	const winner = applyEndOfActionChecks(nextState, update, events, {
		recomputeRoads: true,
	})
	const commitErr = await commitActionWrite(
		admin,
		game,
		update,
		events,
		winner,
		nextState
	)
	if (commitErr) return commitErr

	return json({ ok: true })
}

async function handleBuildSettlement(
	admin: SupabaseClient,
	me: string,
	body: BuildSettlementBody
): Promise<Response> {
	const pre = await preflightBuild(admin, me, body.game_id, true)
	if (!pre.ok) return pre.response
	const { game, state, meIdx } = pre

	if (
		!(boardFor(state.variant).vertices as readonly string[]).includes(
			body.vertex
		)
	)
		return err(400, 'unknown vertex')
	const vertex = body.vertex as Vertex

	if (!isValidBuildSettlementVertex(state, meIdx, vertex))
		return err(400, 'invalid settlement')
	const cost = resolvePurchaseCost(
		state.players[meIdx],
		BUILD_COSTS.settlement,
		!!body.use_bricklayer,
		body.smith_swap ?? 0
	)
	if (!cost) return err(400, 'insufficient resources')
	if (
		!canSpendUnderAge(
			state.players[meIdx],
			costSize(cost),
			gameSizeFor(state.players.length)
		)
	)
		return err(400, 'age limit reached this turn')

	const nextVertices = {
		...state.vertices,
		[vertex]: {
			occupied: true as const,
			player: meIdx,
			building: 'settlement' as const,
			placedTurn: state.round,
		},
	}
	const nextPlayers = applyCost(state.players, meIdx, cost)

	const events: unknown[] = [
		{
			kind: 'settlement_built',
			player: meIdx,
			vertex,
			at: new Date().toISOString(),
		},
	]
	// A new settlement (or its neighbors) may make a haunt player's secret
	// spot unbuildable → spawn a ghost there.
	let nextState: GameState = {
		...state,
		vertices: nextVertices,
		players: nextPlayers,
	}
	const haunt = resolveHauntGhosts(nextState)
	nextState = haunt.state
	for (const s of haunt.spawned) {
		events.push({
			kind: 'ghost_spawned',
			player: s.player,
			vertex: s.vertex,
			at: new Date().toISOString(),
		})
	}

	const update: Record<string, unknown> = {
		vertices: nextState.vertices,
		players: nextState.players,
	}
	// An opponent's settlement can split a chain, so Longest Road gets
	// recomputed here too (not just on road builds).
	const winner = applyEndOfActionChecks(nextState, update, events, {
		recomputeRoads: true,
	})
	const commitErr = await commitActionWrite(
		admin,
		game,
		update,
		events,
		winner,
		nextState
	)
	if (commitErr) return commitErr

	return json({ ok: true })
}

async function handleBuildCity(
	admin: SupabaseClient,
	me: string,
	body: BuildCityBody
): Promise<Response> {
	const pre = await preflightBuild(admin, me, body.game_id, true)
	if (!pre.ok) return pre.response
	const { game, state, meIdx } = pre

	if (
		!(boardFor(state.variant).vertices as readonly string[]).includes(
			body.vertex
		)
	)
		return err(400, 'unknown vertex')
	const vertex = body.vertex as Vertex

	if (!isValidBuildCityVertex(state, meIdx, vertex))
		return err(400, 'invalid city target')
	const meP = state.players[meIdx]
	const useBricklayer = !!body.use_bricklayer
	const requestedSwap = Number.isFinite(body.swap_wheat_to_ore)
		? Number(body.swap_wheat_to_ore)
		: 0
	const swapDelta = metropolitanWheatSwapDelta(meP.bonus, requestedSwap)
	let cost: ResourceHand | null
	if (useBricklayer) {
		cost = resolvePurchaseCost(meP, BUILD_COSTS.city, true)
	} else if (swapDelta > 0) {
		const altCost = metropolitanCityCost(meP.bonus, swapDelta)
		cost = canAfford(meP.resources, altCost) ? altCost : null
	} else {
		cost = resolvePurchaseCost(
			meP,
			BUILD_COSTS.city,
			false,
			body.smith_swap ?? 0
		)
	}
	if (!cost) return err(400, 'insufficient resources')
	if (
		!canSpendUnderAge(
			meP,
			costSize(cost),
			gameSizeFor(state.players.length)
		)
	)
		return err(400, 'age limit reached this turn')

	const nextVertices = {
		...state.vertices,
		[vertex]: {
			occupied: true as const,
			player: meIdx,
			building: 'city' as const,
			placedTurn: state.round,
		},
	}
	const nextPlayers = applyCost(state.players, meIdx, cost)

	const update: Record<string, unknown> = {
		vertices: nextVertices,
		players: nextPlayers,
	}
	const nextState: GameState = {
		...state,
		vertices: nextVertices,
		players: nextPlayers,
	}
	const events: unknown[] = [
		{
			kind: 'city_built',
			player: meIdx,
			vertex,
			at: new Date().toISOString(),
		},
	]
	// Cities don't touch the road graph; skip Longest Road recompute.
	const winner = applyEndOfActionChecks(nextState, update, events, {
		recomputeRoads: false,
	})
	const commitErr = await commitActionWrite(
		admin,
		game,
		update,
		events,
		winner,
		nextState
	)
	if (commitErr) return commitErr

	return json({ ok: true })
}

async function handleDiscard(
	admin: SupabaseClient,
	me: string,
	body: DiscardBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	if (game.status !== 'active') return err(400, 'not active')
	if (state.phase.kind !== 'discard')
		return err(400, 'expected discard phase')

	const meIdx = game.player_order.indexOf(me)
	if (meIdx < 0) return err(403, 'not a participant')

	const required = state.phase.pending[meIdx]
	if (required === undefined) return err(400, 'nothing to discard')

	const selection = normalizeHand(body.discard)
	if (!selection) return err(400, 'invalid discard shape')

	const hand = state.players[meIdx].resources
	if (!isValidDiscardSelection(hand, selection, required))
		return err(400, 'invalid discard selection')

	const nextPlayers = state.players.map((p, i) => {
		if (i !== meIdx) return p
		const r = p.resources
		return {
			...p,
			resources: {
				brick: r.brick - selection.brick,
				wood: r.wood - selection.wood,
				sheep: r.sheep - selection.sheep,
				wheat: r.wheat - selection.wheat,
				ore: r.ore - selection.ore,
			},
		}
	})

	const nextPending: Partial<Record<number, number>> = {
		...state.phase.pending,
	}
	delete nextPending[meIdx]

	const discardsRemain = Object.keys(nextPending).length > 0
	const nextPhase: Phase = discardsRemain
		? {
				kind: 'discard',
				resume: state.phase.resume,
				pending: nextPending,
				from7: state.phase.from7,
			}
		: {
				kind: 'move_robber',
				resume: state.phase.resume,
				from7: state.phase.from7,
			}

	// Nomad production and the investor's token payout are deferred until every
	// owed discard is in, so neither gain can be discarded away (or force a
	// bigger discard).
	const settled = !discardsRemain && state.phase.from7
	const nomadResult = settled
		? applyNomadProduce({ ...state, players: nextPlayers })
		: { players: nextPlayers, events: [] as unknown[] }
	const investorResult = settled
		? applyInvestorPayout(
				{ ...state, players: nomadResult.players },
				game.current_turn ?? 0
			)
		: { players: nomadResult.players, events: [] as unknown[] }

	const { error: stateErr } = await admin
		.from('game_states')
		.update({ players: investorResult.players, phase: nextPhase })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	const count =
		selection.brick +
		selection.wood +
		selection.sheep +
		selection.wheat +
		selection.ore
	const event = {
		kind: 'discarded',
		player: meIdx,
		count,
		at: new Date().toISOString(),
	}
	const { error: gameErr } = await admin
		.from('games')
		.update({
			events: [
				...(game.events ?? []),
				event,
				...nomadResult.events,
				...investorResult.events,
			],
		})
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')

	return json({ ok: true })
}

async function handleMoveRobber(
	admin: SupabaseClient,
	me: string,
	body: MoveRobberBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	if (game.status !== 'active') return err(400, 'not active')
	if (state.phase.kind !== 'move_robber')
		return err(400, 'expected move_robber phase')

	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (game.current_turn !== meIdx) return err(403, 'not your turn')

	if (
		!(boardFor(state.variant).hexes as readonly string[]).includes(body.hex)
	)
		return err(400, 'unknown hex')
	const hex = body.hex as Hex
	if (hex === state.robber) return err(400, 'robber must move')

	const candidates = stealCandidates(state, hex, meIdx)
	const now = new Date().toISOString()
	const events: unknown[] = [
		{ kind: 'robber_moved', player: meIdx, hex, at: now },
	]

	// Three cases:
	//   0 candidates → straight to main, no steal.
	//   1 candidate  → auto-steal (skip the extra selection step).
	//   2+ candidates → steal phase with a picker.
	let nextPlayers: PlayerState[] = state.players
	let nextPhase: Phase = state.phase.resume

	if (candidates.length === 1) {
		const victim = candidates[0]
		const stolen = pickStolenResource(state.players[victim].resources)
		if (stolen) {
			nextPlayers = state.players.map((p, i) => {
				if (i === victim) {
					return {
						...p,
						resources: {
							...p.resources,
							[stolen]: p.resources[stolen] - 1,
						},
					}
				}
				if (i === meIdx) {
					return {
						...p,
						resources: {
							...p.resources,
							[stolen]: p.resources[stolen] + 1,
						},
					}
				}
				return p
			})
			events.push({
				kind: 'stolen',
				thief: meIdx,
				victim,
				at: now,
			})
		}
	} else if (candidates.length > 1) {
		nextPhase = {
			kind: 'steal',
			resume: state.phase.resume,
			hex,
			candidates,
			from7: state.phase.from7,
		}
	}

	// If we're transitioning straight to main (no steal needed), apply
	// the post-roll FT chain for the active player.
	const stateAfterRobber: GameState = {
		...state,
		players: nextPlayers,
		robber: hex,
		phase: nextPhase,
	}
	let finalState = stateAfterRobber
	if (
		state.phase.from7 &&
		nextPhase.kind === 'main' &&
		fortuneTellerTriggersOn(
			stateAfterRobber.players[game.current_turn ?? 0]?.bonus,
			nextPhase.roll
		)
	) {
		const ft = await runFortuneTellerChain(
			stateAfterRobber,
			game.current_turn ?? 0,
			events
		)
		finalState = ft.state
	}

	// Magician: a 7-roll resolving to main opens the magician's window.
	if (state.phase.from7 && finalState.phase.kind === 'main') {
		finalState = {
			...finalState,
			phase: wrapMagicianWindow(
				finalState.phase,
				finalState,
				game.current_turn ?? 0,
				finalState.phase.roll
			),
		}
	}

	const { error: stateErr } = await admin
		.from('game_states')
		.update({
			robber: hex,
			phase: finalState.phase,
			players: finalState.players,
		})
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	const { error: gameErr } = await admin
		.from('games')
		.update({ events: [...(game.events ?? []), ...events] })
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')

	return json({ ok: true })
}

function pickStolenResource(hand: ResourceHand): Resource | null {
	const total = handSize(hand)
	if (total <= 0) return null
	let pick = Math.floor(Math.random() * total)
	for (const r of RESOURCES) {
		if (pick < hand[r]) return r
		pick -= hand[r]
	}
	return null
}

async function handleSteal(
	admin: SupabaseClient,
	me: string,
	body: StealBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	if (game.status !== 'active') return err(400, 'not active')
	if (state.phase.kind !== 'steal') return err(400, 'expected steal phase')

	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (game.current_turn !== meIdx) return err(403, 'not your turn')

	if (!state.phase.candidates.includes(body.victim))
		return err(400, 'invalid victim')

	const victimHand = state.players[body.victim].resources
	const stolen = pickStolenResource(victimHand)
	if (!stolen) return err(400, 'victim has no cards')

	const nextPlayers = state.players.map((p, i) => {
		if (i === body.victim) {
			return {
				...p,
				resources: {
					...p.resources,
					[stolen]: p.resources[stolen] - 1,
				},
			}
		}
		if (i === meIdx) {
			return {
				...p,
				resources: {
					...p.resources,
					[stolen]: p.resources[stolen] + 1,
				},
			}
		}
		return p
	})

	const nextPhase: Phase = state.phase.resume

	const events: unknown[] = [
		{
			kind: 'stolen',
			thief: meIdx,
			victim: body.victim,
			at: new Date().toISOString(),
		},
	]

	// FT chain after a 7 → steal → main transition.
	let finalState: GameState = {
		...state,
		players: nextPlayers,
		phase: nextPhase,
	}
	if (
		state.phase.from7 &&
		nextPhase.kind === 'main' &&
		fortuneTellerTriggersOn(
			nextPlayers[game.current_turn ?? 0]?.bonus,
			nextPhase.roll
		)
	) {
		const ft = await runFortuneTellerChain(
			finalState,
			game.current_turn ?? 0,
			events
		)
		finalState = ft.state
	}

	// Magician: a 7-roll resolving to main opens the magician's window.
	if (state.phase.from7 && finalState.phase.kind === 'main') {
		finalState = {
			...finalState,
			phase: wrapMagicianWindow(
				finalState.phase,
				finalState,
				game.current_turn ?? 0,
				finalState.phase.roll
			),
		}
	}

	const { error: stateErr } = await admin
		.from('game_states')
		.update({ players: finalState.players, phase: finalState.phase })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	const { error: gameErr } = await admin
		.from('games')
		.update({ events: [...(game.events ?? []), ...events] })
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
		rejectedBy: [],
		acceptedBy: [],
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

	const toUserIds = addresseesOf(offer, state.players.length)
		.map((idx) => game.player_order[idx])
		.filter((id): id is string => typeof id === 'string')
	if (toUserIds.length > 0) {
		EdgeRuntime.waitUntil(
			sendNotifications(
				admin,
				toUserIds.map((userId) => ({
					userId,
					kind: 'trade_proposed',
					gate: 'trade',
					senderProfileId: me,
					gameId: game.id,
				}))
			)
		)
	}

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

	// Confirm mode: an Accept only registers the acceptance; the proposer picks
	// one to execute via confirm_trade. Automatic mode (default / legacy) swaps
	// immediately, as below.
	if (state.config.tradeMode === 'confirm') {
		const existingAccepted = acceptedByOf(offer)
		if (existingAccepted.includes(meIdx)) return json({ ok: true })
		const nextOffer: TradeOffer = {
			...offer,
			acceptedBy: [...existingAccepted, meIdx],
			// Accepting clears any prior rejection (defensive — a rejecter's
			// banner is hidden, so re-accepting is unusual).
			rejectedBy: rejectedByOf(offer).filter((i) => i !== meIdx),
		}
		const nextPhase: Phase = { ...phase, trade: nextOffer }
		const { error: acceptErr } = await admin
			.from('game_states')
			.update({ phase: nextPhase })
			.eq('game_id', game.id)
		if (acceptErr) return err(500, 'could not update state')

		const acceptEvent = {
			kind: 'trade_accept_offered',
			offer_id: offer.id,
			from: offer.from,
			by: meIdx,
			at: new Date().toISOString(),
		}
		const { error: acceptLogErr } = await admin
			.from('games')
			.update({ events: [...(game.events ?? []), acceptEvent] })
			.eq('id', game.id)
		if (acceptLogErr) return err(500, 'could not log event')

		const proposer = game.player_order[offer.from]
		if (proposer && proposer !== me) {
			EdgeRuntime.waitUntil(
				sendNotifications(admin, [
					{
						userId: proposer,
						kind: 'trade_accept_offered',
						gate: 'trade',
						senderProfileId: me,
						gameId: game.id,
					},
				])
			)
		}

		return json({ ok: true })
	}

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

	const proposerId = game.player_order[offer.from]
	if (proposerId && proposerId !== me) {
		EdgeRuntime.waitUntil(
			sendNotifications(admin, [
				{
					userId: proposerId,
					kind: 'trade_accepted',
					gate: 'trade',
					senderProfileId: me,
					gameId: game.id,
				},
			])
		)
	}

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

async function handleRejectTrade(
	admin: SupabaseClient,
	me: string,
	body: RejectTradeBody
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
	if (!isOfferAddressedTo(offer, meIdx))
		return err(403, 'not addressed to you')

	const existing = rejectedByOf(offer)
	if (existing.includes(meIdx)) return json({ ok: true })

	const nextOffer: TradeOffer = {
		...offer,
		rejectedBy: [...existing, meIdx],
		// Reject doubles as "withdraw" in confirm mode: drop any pending
		// acceptance so backing out fully removes this player from the offer.
		acceptedBy: acceptedByOf(offer).filter((i) => i !== meIdx),
	}
	const nextPhase: Phase = { ...phase, trade: nextOffer }
	const { error: stateErr } = await admin
		.from('game_states')
		.update({ phase: nextPhase })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	const event = {
		kind: 'trade_rejected',
		offer_id: offer.id,
		from: offer.from,
		by: meIdx,
		at: new Date().toISOString(),
	}
	const { error: gameErr } = await admin
		.from('games')
		.update({ events: [...(game.events ?? []), event] })
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')

	// Only the rejection that kills the offer notifies the proposer, so an
	// offer produces at most one response push. The duplicate-rejection guard
	// above means this transition is reached exactly once.
	const proposerId = game.player_order[offer.from]
	if (proposerId && isOfferRejectedByAll(nextOffer, state.players.length)) {
		EdgeRuntime.waitUntil(
			sendNotifications(admin, [
				{
					userId: proposerId,
					kind: 'trade_rejected_all',
					gate: 'trade',
					gameId: game.id,
				},
			])
		)
	}

	return json({ ok: true })
}

// Confirm mode: the proposer executes the swap with one accepter from
// offer.acceptedBy. Closes the offer; other pending acceptances are discarded.
async function handleConfirmTrade(
	admin: SupabaseClient,
	me: string,
	body: ConfirmTradeBody
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
	if (offer.from !== meIdx) return err(403, 'not your offer')

	const withIdx = body.with
	if (typeof withIdx !== 'number' || !Number.isInteger(withIdx))
		return err(400, 'invalid accepter')
	if (!acceptedByOf(offer).includes(withIdx))
		return err(400, 'player has not accepted')
	if (!canAfford(state.players[offer.from].resources, offer.give))
		return err(400, 'you can no longer afford')
	if (!canAfford(state.players[withIdx].resources, offer.receive))
		return err(400, 'accepter can no longer afford')

	const nextPlayers = applyTradeToPlayers(
		state.players,
		offer.from,
		withIdx,
		offer.give,
		offer.receive
	)
	const nextPhase: Phase = { ...phase, trade: null }

	const { error: stateErr } = await admin
		.from('game_states')
		.update({ players: nextPlayers, phase: nextPhase })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	// Same event shape automatic-mode Accept emits — keeps ActionLog + stats
	// (Friendliest/Antisocial) identical across both trade modes.
	const event = {
		kind: 'trade_accepted',
		offer_id: offer.id,
		from: offer.from,
		to: withIdx,
		give: offer.give,
		receive: offer.receive,
		at: new Date().toISOString(),
	}
	const { error: gameErr } = await admin
		.from('games')
		.update({ events: [...(game.events ?? []), event] })
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')

	const accepterId = game.player_order[withIdx]
	if (accepterId && accepterId !== me) {
		EdgeRuntime.waitUntil(
			sendNotifications(admin, [
				{
					userId: accepterId,
					kind: 'trade_confirmed',
					gate: 'trade',
					senderProfileId: me,
					gameId: game.id,
				},
			])
		)
	}

	return json({ ok: true })
}

async function handleBankTrade(
	admin: SupabaseClient,
	me: string,
	body: BankTradeBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	if (game.status !== 'active') return err(400, 'not active')

	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	// Bank/port trades are a main-turn action only — not available in a
	// special-build slot.
	const inMain = state.phase.kind === 'main' && game.current_turn === meIdx
	if (!inMain) {
		if (state.phase.kind === 'special_build')
			return err(400, 'no trading during special build')
		if (state.phase.kind !== 'main') return err(400, 'expected main phase')
		return err(403, 'not your turn')
	}

	const give = normalizeHand(body.give)
	const receive = normalizeHand(body.receive)
	if (!give || !receive) return err(400, 'invalid resource hand')

	const meP = state.players[meIdx]
	const isSmith = meP.bonus === 'smith'
	const kind = inferBankKind(state, meIdx, give)
	if (!kind) return err(400, 'no valid bank ratio for this give hand')
	const specialistResource = meP.specialistResource ?? null
	const surcharge = bankSurchargeFor(state, meIdx)
	if (
		!isValidBankTradeShape(
			give,
			receive,
			kind,
			specialistResource,
			isSmith,
			surcharge
		)
	)
		return err(400, 'invalid bank trade shape')

	// Merchant: optional 1:1 side-conversion of extra input resource.
	let merchantAddon: MerchantAddon | null = null
	if (body.merchant && meP.bonus === 'merchant') {
		const resource = parseResource(body.merchant.resource)
		const take = normalizeHand(body.merchant.take)
		const count = Number(body.merchant.count)
		if (!resource || !take) return err(400, 'invalid merchant add-on')
		const addon: MerchantAddon = { resource, count, take }
		if (!isValidMerchantAddon(give, addon))
			return err(400, 'invalid merchant add-on')
		merchantAddon = addon
	}

	// Afford the base give plus any merchant extra of the input resource.
	const totalGive: ResourceHand = { ...give }
	if (merchantAddon) totalGive[merchantAddon.resource] += merchantAddon.count
	if (!canAfford(meP.resources, totalGive))
		return err(400, 'insufficient resources')

	let nextPlayers = applyBankTradeToPlayer(
		state.players,
		meIdx,
		give,
		receive
	)
	if (merchantAddon) {
		const addon = merchantAddon
		nextPlayers = nextPlayers.map((p, i) => {
			if (i !== meIdx) return p
			const next = { ...p.resources }
			next[addon.resource] -= addon.count
			for (const r of RESOURCES) next[r] += addon.take[r]
			return { ...p, resources: next }
		})
	}
	const { error: stateErr } = await admin
		.from('game_states')
		.update({ players: nextPlayers })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	const ratio = effectiveBankRatioFor(
		kind,
		give,
		specialistResource,
		surcharge
	)
	const event = {
		kind: 'bank_trade',
		player: meIdx,
		give,
		receive,
		ratio,
		merchant: merchantAddon,
		at: new Date().toISOString(),
	}
	const { error: gameErr } = await admin
		.from('games')
		.update({ events: [...(game.events ?? []), event] })
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')

	return json({ ok: true, ratio })
}

async function handleBuyDevCard(
	admin: SupabaseClient,
	me: string,
	body: BuyDevCardBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	if (game.status !== 'active') return err(400, 'not active')
	if (!state.config.devCards) return err(400, 'dev cards disabled')

	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	// Buyable on your own main turn or in your special-build slot. The phase
	// check leads so that `phase` stays narrowed to those two for the scout
	// resume below; `isSpecialBuildActor` is false off `special_build` anyway.
	if (state.phase.kind !== 'main' && state.phase.kind !== 'special_build')
		return err(400, 'expected main phase')
	const phase = state.phase
	const inMain = phase.kind === 'main' && game.current_turn === meIdx
	if (!inMain && !isSpecialBuildActor(state, meIdx))
		return err(403, 'not your turn')

	if (state.devDeck.length === 0) return err(400, 'dev deck empty')
	const useBricklayer = !!body.use_bricklayer

	// Scout: optionally swap one of the standard cost resources for a
	// duplicate of one of the others. Mutually exclusive with bricklayer.
	let scoutSwap: { from: Resource; to: Resource } | null = null
	if (body.scout_swap && bonusOf(state, meIdx) === 'scout') {
		const from = parseResource(body.scout_swap.from)
		const to = parseResource(body.scout_swap.to)
		if (!from || !to) return err(400, 'invalid scout swap resource')
		const swap = { from, to }
		if (!isValidScoutSwap(swap)) return err(400, 'invalid scout swap')
		if (useBricklayer)
			return err(400, 'scout swap and bricklayer are exclusive')
		scoutSwap = swap
	}

	let cost: ResourceHand | null
	if (scoutSwap) {
		const altCost = scoutDevCardCost(scoutSwap)
		cost = canAfford(state.players[meIdx].resources, altCost)
			? altCost
			: null
	} else {
		cost = resolvePurchaseCost(
			state.players[meIdx],
			DEV_CARD_COST,
			useBricklayer,
			body.smith_swap ?? 0
		)
	}
	if (!cost) return err(400, 'insufficient resources')
	if (
		!canSpendUnderAge(
			state.players[meIdx],
			costSize(cost),
			gameSizeFor(state.players.length)
		)
	)
		return err(400, 'age limit reached this turn')

	const devSpend = costSize(cost)

	// Scout: peek at the top up-to-2 cards rather than committing the top.
	// The buyer enters the scout_pick sub-phase to choose one; the rest
	// flush back to the bottom in their drawn order on confirm.
	if (bonusOf(state, meIdx) === 'scout') {
		const peekCount = Math.min(SCOUT_PEEK_SIZE, state.devDeck.length)
		const peek = state.devDeck.slice(0, peekCount)
		// Deck is rewritten only on confirm. We cannot leave the cards in
		// the deck (they'd be visible to the next buyer). Stash them on
		// the phase and remove from the deck immediately. The unchosen
		// cards return to the bottom on confirm.
		const remaining = state.devDeck.slice(peekCount)
		const nextPlayers = state.players.map((p, i) => {
			if (i !== meIdx) return p
			const next: PlayerState = {
				...p,
				resources: deductHand(p.resources, cost),
			}
			if (p.curse === 'age') {
				next.cardsSpentThisTurn = (p.cardsSpentThisTurn ?? 0) + devSpend
			}
			return next
		})
		// A scout buying in their special-build slot returns to that slot (the
		// queue is unchanged — only end_special_build pops it).
		const scoutPhase: Phase = {
			kind: 'scout_pick',
			resume:
				phase.kind === 'special_build'
					? { kind: 'special_build', queue: phase.queue }
					: { kind: 'main', roll: phase.roll, trade: null },
			owner: meIdx,
			cards: peek,
		}
		const update: Record<string, unknown> = {
			players: nextPlayers,
			dev_deck: remaining,
			phase: scoutPhase,
		}
		const events: unknown[] = [
			{
				kind: 'scout_buy',
				player: meIdx,
				swap: scoutSwap,
				at: new Date().toISOString(),
			},
		]
		const { error: stateErr } = await admin
			.from('game_states')
			.update(update)
			.eq('game_id', game.id)
		if (stateErr) return err(500, 'could not update state')
		const { error: gameErr } = await admin
			.from('games')
			.update({ events: [...(game.events ?? []), ...events] })
			.eq('id', game.id)
		if (gameErr) return err(500, 'could not log event')
		return json({ ok: true })
	}

	const card = state.devDeck[0]
	const nextDeck = state.devDeck.slice(1)
	const nextPlayers = state.players.map((p, i) => {
		if (i !== meIdx) return p
		const next: PlayerState = {
			...p,
			resources: deductHand(p.resources, cost),
			devCards: [...p.devCards, { id: card, purchasedTurn: state.round }],
		}
		if (p.curse === 'age') {
			next.cardsSpentThisTurn = (p.cardsSpentThisTurn ?? 0) + devSpend
		}
		return next
	})

	const update: Record<string, unknown> = {
		players: nextPlayers,
		dev_deck: nextDeck,
	}
	const nextState: GameState = {
		...state,
		players: nextPlayers,
		devDeck: nextDeck,
	}
	// No card id in the event — the draw stays private.
	const events: unknown[] = [
		{
			kind: 'dev_bought',
			player: meIdx,
			at: new Date().toISOString(),
		},
	]
	// A VP card can push the buyer over 10; no road-graph change here.
	const winner = applyEndOfActionChecks(nextState, update, events, {
		recomputeRoads: false,
	})
	const commitErr = await commitActionWrite(
		admin,
		game,
		update,
		events,
		winner,
		nextState
	)
	if (commitErr) return commitErr

	return json({ ok: true })
}

async function handleConfirmScoutCard(
	admin: SupabaseClient,
	me: string,
	body: ConfirmScoutCardBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded
	if (state.phase.kind !== 'scout_pick')
		return err(400, 'expected scout_pick phase')
	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (state.phase.owner !== meIdx) return err(403, 'not your scout pick')
	const idx = body.index
	if (typeof idx !== 'number' || !Number.isInteger(idx))
		return err(400, 'invalid index')
	if (idx < 0 || idx >= state.phase.cards.length)
		return err(400, 'index out of range')

	const chosen = state.phase.cards[idx]
	const returned = state.phase.cards.filter((_, i) => i !== idx)
	const nextDeck = [...state.devDeck, ...returned]
	const nextPlayers = state.players.map((p, i) => {
		if (i !== meIdx) return p
		return {
			...p,
			devCards: [
				...p.devCards,
				{ id: chosen, purchasedTurn: state.round },
			],
		}
	})
	const update: Record<string, unknown> = {
		players: nextPlayers,
		dev_deck: nextDeck,
		phase: state.phase.resume,
	}
	const nextState: GameState = {
		...state,
		players: nextPlayers,
		devDeck: nextDeck,
		phase: state.phase.resume,
	}
	const events: unknown[] = [
		{ kind: 'dev_bought', player: meIdx, at: new Date().toISOString() },
	]
	const winner = applyEndOfActionChecks(nextState, update, events, {
		recomputeRoads: false,
	})
	const commitErr = await commitActionWrite(
		admin,
		game,
		update,
		events,
		winner,
		nextState
	)
	if (commitErr) return commitErr
	return json({ ok: true })
}

// --- Set 2 handlers --------------------------------------------------------

async function handleBuildSuperCity(
	admin: SupabaseClient,
	me: string,
	body: BuildSuperCityBody
): Promise<Response> {
	const pre = await preflightBuild(admin, me, body.game_id)
	if (!pre.ok) return pre.response
	const { game, state, meIdx } = pre
	if (
		!(boardFor(state.variant).vertices as readonly string[]).includes(
			body.vertex
		)
	)
		return err(400, 'unknown vertex')
	const vertex = body.vertex as Vertex
	const meP = state.players[meIdx]
	if (meP.bonus !== 'metropolitan') return err(400, 'not a metropolitan')
	if (!canBuildMoreSuperCities(state, meIdx))
		return err(400, 'super city cap reached')
	const vs = vertexStateOf(state, vertex)
	if (!vs.occupied || vs.player !== meIdx || vs.building !== 'city')
		return err(400, 'must upgrade your own city')
	if (!canPlaceUnderPower(state, meIdx, vertex))
		return err(400, 'power curse blocks this upgrade')

	const requested = Number.isFinite(body.swap_wheat_to_ore)
		? Number(body.swap_wheat_to_ore)
		: 0
	const swapDelta = metropolitanWheatSwapDelta(meP.bonus, requested)
	const cost = metropolitanCityCost(meP.bonus, swapDelta)
	if (!canAfford(meP.resources, cost))
		return err(400, 'insufficient resources')
	if (
		!canSpendUnderAge(
			meP,
			costSize(cost),
			gameSizeFor(state.players.length)
		)
	)
		return err(400, 'age limit reached this turn')

	const nextVertices = {
		...state.vertices,
		[vertex]: {
			occupied: true as const,
			player: meIdx,
			building: 'super_city' as const,
			placedTurn: state.round,
		},
	}
	const nextPlayers = applyCost(state.players, meIdx, cost)
	const update: Record<string, unknown> = {
		vertices: nextVertices,
		players: nextPlayers,
	}
	const nextState: GameState = {
		...state,
		vertices: nextVertices,
		players: nextPlayers,
	}
	const events: unknown[] = [
		{
			kind: 'build_super_city',
			player: meIdx,
			vertex,
			cost,
			at: new Date().toISOString(),
		},
	]
	const winner = applyEndOfActionChecks(nextState, update, events, {
		recomputeRoads: false,
	})
	const commitErr = await commitActionWrite(
		admin,
		game,
		update,
		events,
		winner,
		nextState
	)
	if (commitErr) return commitErr
	return json({ ok: true })
}

async function handleLiquidate(
	admin: SupabaseClient,
	me: string,
	body: LiquidateBody
): Promise<Response> {
	const pre = await preflightBuild(admin, me, body.game_id)
	if (!pre.ok) return pre.response
	const { game, state, meIdx } = pre
	if (state.players[meIdx].bonus !== 'accountant')
		return err(400, 'not an accountant')

	const target = body.target as { kind?: string } & Record<string, unknown>
	if (!target || typeof target !== 'object') return err(400, 'invalid target')
	const kind = target.kind
	const refund = ((): { hand: ResourceHand; eventDetail: unknown } | null => {
		const at = new Date().toISOString()
		if (kind === 'road') {
			const edge = target.edge as Edge
			if (
				!(boardFor(state.variant).edges as readonly string[]).includes(
					edge as string
				)
			)
				return null
			const es = state.edges[edge]
			if (!es?.occupied || es.player !== meIdx) return null
			if (es.placedTurn >= state.round) return null
			if (roadLiquidationBlocked(state, meIdx, edge)) return null
			return {
				hand: ROAD_REFUND,
				eventDetail: { kind: 'road', edge, at, refund: ROAD_REFUND },
			}
		}
		if (kind === 'settlement') {
			const vertex = target.vertex as Vertex
			if (
				!(
					boardFor(state.variant).vertices as readonly string[]
				).includes(vertex as string)
			)
				return null
			const vs = vertexStateOf(state, vertex)
			if (!vs.occupied || vs.player !== meIdx) return null
			if (vs.building !== 'settlement') return null
			if (vs.placedTurn >= state.round) return null
			return {
				hand: SETTLEMENT_REFUND,
				eventDetail: {
					kind: 'settlement',
					vertex,
					at,
					refund: SETTLEMENT_REFUND,
				},
			}
		}
		if (kind === 'city') {
			const vertex = target.vertex as Vertex
			if (
				!(
					boardFor(state.variant).vertices as readonly string[]
				).includes(vertex as string)
			)
				return null
			const vs = vertexStateOf(state, vertex)
			if (!vs.occupied || vs.player !== meIdx) return null
			if (vs.building !== 'city') return null
			if (vs.placedTurn >= state.round) return null
			return {
				hand: CITY_REFUND,
				eventDetail: { kind: 'city', vertex, at, refund: CITY_REFUND },
			}
		}
		if (kind === 'super_city') {
			const vertex = target.vertex as Vertex
			if (
				!(
					boardFor(state.variant).vertices as readonly string[]
				).includes(vertex as string)
			)
				return null
			const vs = vertexStateOf(state, vertex)
			if (!vs.occupied || vs.player !== meIdx) return null
			if (vs.building !== 'super_city') return null
			if (vs.placedTurn >= state.round) return null
			return {
				hand: SUPER_CITY_REFUND,
				eventDetail: {
					kind: 'super_city',
					vertex,
					at,
					refund: SUPER_CITY_REFUND,
				},
			}
		}
		if (kind === 'dev_card') {
			const idx = target.index as number
			if (typeof idx !== 'number' || !Number.isInteger(idx)) return null
			const meP = state.players[meIdx]
			if (idx < 0 || idx >= meP.devCards.length) return null
			const entry = meP.devCards[idx]
			if (entry.purchasedTurn >= state.round) return null
			return {
				hand: DEV_CARD_REFUND,
				eventDetail: {
					kind: 'dev_card',
					id: entry.id,
					at,
					refund: DEV_CARD_REFUND,
				},
			}
		}
		return null
	})()

	if (!refund) return err(400, 'invalid liquidation target')

	let nextVertices = state.vertices
	let nextEdges = state.edges
	let nextPlayers = state.players.map((p) => p)

	if (kind === 'road') {
		const edge = target.edge as Edge
		const ne = { ...state.edges }
		delete ne[edge]
		nextEdges = ne
	} else if (kind === 'settlement') {
		const vertex = target.vertex as Vertex
		const nv = { ...state.vertices }
		delete nv[vertex]
		nextVertices = nv
	} else if (kind === 'city') {
		const vertex = target.vertex as Vertex
		const vs = state.vertices[vertex]!
		nextVertices = {
			...state.vertices,
			[vertex]: {
				occupied: true,
				player: meIdx,
				building: 'settlement',
				placedTurn: vs.occupied ? vs.placedTurn : 0,
			},
		}
	} else if (kind === 'super_city') {
		const vertex = target.vertex as Vertex
		const vs = state.vertices[vertex]!
		nextVertices = {
			...state.vertices,
			[vertex]: {
				occupied: true,
				player: meIdx,
				building: 'city',
				placedTurn: vs.occupied ? vs.placedTurn : 0,
			},
		}
	} else if (kind === 'dev_card') {
		const idx = target.index as number
		nextPlayers = state.players.map((p, i) => {
			if (i !== meIdx) return p
			return { ...p, devCards: p.devCards.filter((_, j) => j !== idx) }
		})
	}

	// Credit the refund to the player's hand.
	nextPlayers = nextPlayers.map((p, i) => {
		if (i !== meIdx) return p
		const r = p.resources
		return {
			...p,
			resources: {
				brick: r.brick + refund.hand.brick,
				wood: r.wood + refund.hand.wood,
				sheep: r.sheep + refund.hand.sheep,
				wheat: r.wheat + refund.hand.wheat,
				ore: r.ore + refund.hand.ore,
			},
		}
	})

	const update: Record<string, unknown> = {
		vertices: nextVertices,
		edges: nextEdges,
		players: nextPlayers,
	}
	const nextState: GameState = {
		...state,
		vertices: nextVertices,
		edges: nextEdges,
		players: nextPlayers,
	}
	const events: unknown[] = [
		{
			kind: 'liquidate',
			player: meIdx,
			detail: refund.eventDetail,
			at: new Date().toISOString(),
		},
	]
	// Roads can split a longest-road chain; settlements can join one. Run
	// the road recompute when either changed.
	const recomputeRoads = kind === 'road' || kind === 'settlement'
	const winner = applyEndOfActionChecks(nextState, update, events, {
		recomputeRoads,
	})
	const commitErr = await commitActionWrite(
		admin,
		game,
		update,
		events,
		winner,
		nextState
	)
	if (commitErr) return commitErr
	return json({ ok: true })
}

type PostPlacementPending = {
	specialist: number[]
	explorer?: Partial<Record<number, number>>
	fencer?: Partial<Record<number, number>>
	haunt?: number[]
}

function postPlacementDrained(pending: PostPlacementPending): boolean {
	if (pending.specialist.length > 0) return false
	if (pending.explorer && Object.keys(pending.explorer).length > 0)
		return false
	if (pending.fencer && Object.keys(pending.fencer).length > 0) return false
	if (pending.haunt && pending.haunt.length > 0) return false
	return true
}

// The next phase after a post_placement mutation: `roll` once every pending
// entry drains, otherwise a post_placement carrying only the non-empty
// entries. Preserves every bonus's pending so one draining doesn't wipe
// another's.
function postPlacementPhaseFrom(pending: PostPlacementPending): Phase {
	if (postPlacementDrained(pending)) return { kind: 'roll' }
	const out: PostPlacementPending = { specialist: pending.specialist }
	if (pending.explorer && Object.keys(pending.explorer).length > 0)
		out.explorer = pending.explorer
	if (pending.fencer && Object.keys(pending.fencer).length > 0)
		out.fencer = pending.fencer
	if (pending.haunt && pending.haunt.length > 0) out.haunt = pending.haunt
	return { kind: 'post_placement', pending: out }
}

async function handlePlaceExplorerRoad(
	admin: SupabaseClient,
	me: string,
	body: PlaceExplorerRoadBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded
	if (state.phase.kind !== 'post_placement')
		return err(400, 'expected post_placement phase')
	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	const remaining = state.phase.pending.explorer?.[meIdx] ?? 0
	if (remaining <= 0) return err(400, 'no explorer roads remaining')
	if (
		!(boardFor(state.variant).edges as readonly string[]).includes(
			body.edge
		)
	)
		return err(400, 'unknown edge')
	const edge = body.edge as Edge
	if (!isValidBuildRoadEdge(state, meIdx, edge))
		return err(400, 'invalid road placement')

	const nextEdges = {
		...state.edges,
		[edge]: {
			occupied: true as const,
			player: meIdx,
			placedTurn: state.round,
		},
	}
	const newRemaining = remaining - 1
	const newExplorer = { ...(state.phase.pending.explorer ?? {}) }
	if (newRemaining <= 0) delete newExplorer[meIdx]
	else newExplorer[meIdx] = newRemaining

	const nextPhase = postPlacementPhaseFrom({
		...state.phase.pending,
		explorer: newExplorer,
	})

	const stateAfter: GameState = {
		...state,
		edges: nextEdges,
		phase: nextPhase,
	}
	const events: unknown[] = [
		{
			kind: 'explorer_road',
			player: meIdx,
			edge,
			at: new Date().toISOString(),
		},
	]

	// Recompute longest road so leaderboards reflect explorer placements.
	const newHolder = recomputeLongestRoad(stateAfter)
	const update: Record<string, unknown> = {
		edges: nextEdges,
		phase: nextPhase,
	}
	if (newHolder !== state.longestRoad) {
		update.longest_road = newHolder
		events.push({
			kind: 'longest_road_changed',
			player: newHolder,
			at: new Date().toISOString(),
		})
	}

	const { error: stateErr } = await admin
		.from('game_states')
		.update(update)
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')
	const { error: gameErr } = await admin
		.from('games')
		.update({ events: [...(game.events ?? []), ...events] })
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')
	return json({ ok: true })
}

async function handleRitualRoll(
	admin: SupabaseClient,
	me: string,
	body: RitualRollBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded
	if (game.status !== 'active') return err(400, 'not active')
	if (state.phase.kind !== 'roll') return err(400, 'expected roll phase')
	if (state.phase.pending?.dice) return err(400, 'dice already pending')
	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (game.current_turn !== meIdx) return err(403, 'not your turn')
	const meP = state.players[meIdx]
	if (meP.bonus !== 'ritualist') return err(400, 'not a ritualist')
	if (meP.ritualWasUsedThisTurn) return err(400, 'ritual already used')

	if (!isValidRitualTotal(body.total))
		return err(400, 'invalid total (must be 2..6 or 8..12)')
	const total = body.total

	const discard = normalizeHand(body.discard)
	if (!discard) return err(400, 'invalid discard shape')
	const required = ritualCardCost(state, meIdx)
	if (handSize(discard) !== required)
		return err(400, `must discard exactly ${required} cards`)
	for (const r of RESOURCES) {
		if (discard[r] < 0) return err(400, 'invalid discard amounts')
		if (discard[r] > meP.resources[r])
			return err(400, 'insufficient resources to discard')
	}

	const dice = dicePairForTotal(total)
	const nextPlayers = state.players.map((p, i) => {
		if (i !== meIdx) return p
		return {
			...p,
			resources: deductHand(p.resources, discard),
			ritualWasUsedThisTurn: true,
		}
	})
	const stateAfterDiscard: GameState = { ...state, players: nextPlayers }
	const rollEvent = {
		kind: 'ritual_roll',
		player: meIdx,
		total,
		dice: [dice.a, dice.b],
		discard,
		at: new Date().toISOString(),
	}
	return applyRollOutcome(admin, game, stateAfterDiscard, dice, [rollEvent], {
		distributeOnlyTo: meIdx,
	})
}

async function handleShepherdSwap(
	admin: SupabaseClient,
	me: string,
	body: ShepherdSwapBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded
	if (game.status !== 'active') return err(400, 'not active')
	if (state.phase.kind !== 'roll') return err(400, 'expected roll phase')
	if (state.phase.pending?.dice) return err(400, 'dice already pending')
	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (game.current_turn !== meIdx) return err(403, 'not your turn')
	const meP = state.players[meIdx]
	if (meP.bonus !== 'shepherd') return err(400, 'not a shepherd')
	if (meP.shepherdUsedThisTurn) return err(400, 'shepherd already used')
	if (meP.resources.sheep < 4) return err(400, 'need 4 sheep')

	const take = body.take
	if (!Array.isArray(take) || take.length !== 2)
		return err(400, 'must take exactly 2 resources')
	const r1 = parseResource(take[0])
	const r2 = parseResource(take[1])
	if (!r1 || !r2) return err(400, 'invalid resource')

	const nextPlayers = state.players.map((p, i) => {
		if (i !== meIdx) return p
		const r = p.resources
		const next: ResourceHand = { ...r, sheep: r.sheep - 2 }
		next[r1] = next[r1] + 1
		next[r2] = next[r2] + 1
		return { ...p, resources: next, shepherdUsedThisTurn: true }
	})

	const events: unknown[] = [
		{
			kind: 'shepherd_swap',
			player: meIdx,
			take: [r1, r2],
			at: new Date().toISOString(),
		},
	]
	const { error: stateErr } = await admin
		.from('game_states')
		.update({ players: nextPlayers })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')
	const { error: gameErr } = await admin
		.from('games')
		.update({ events: [...(game.events ?? []), ...events] })
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')
	return json({ ok: true })
}

async function handleClaimCurio(
	admin: SupabaseClient,
	me: string,
	body: ClaimCurioBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded
	if (state.phase.kind !== 'curio_pick')
		return err(400, 'expected curio_pick phase')
	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (!state.phase.pending.includes(meIdx))
		return err(400, 'no curio pending for you')
	const take = body.take
	if (!Array.isArray(take) || take.length !== 3)
		return err(400, 'must claim exactly 3 resources')
	const resources: Resource[] = []
	for (const t of take) {
		const r = parseResource(t)
		if (!r) return err(400, 'invalid resource')
		resources.push(r)
	}
	const nextPlayers = state.players.map((p, i) => {
		if (i !== meIdx) return p
		const r = { ...p.resources }
		for (const x of resources) r[x] = r[x] + 1
		return { ...p, resources: r }
	})
	const newPending = state.phase.pending.filter((i) => i !== meIdx)
	const nextPhase: Phase =
		newPending.length > 0
			? { ...state.phase, pending: newPending }
			: state.phase.resume

	const events: unknown[] = [
		{
			kind: 'curio_collected',
			player: meIdx,
			take: resources,
			at: new Date().toISOString(),
		},
	]

	// If we transition into main and the active player is FT, fire the
	// FT chain (mirrors what applyRollOutcome does for the no-pending path).
	let finalPhase = nextPhase
	let finalPlayers = nextPlayers
	if (nextPhase.kind === 'main') {
		const stateAfter: GameState = {
			...state,
			players: nextPlayers,
			phase: nextPhase,
		}
		const activeIdx = game.current_turn ?? 0
		if (
			fortuneTellerTriggersOn(
				stateAfter.players[activeIdx]?.bonus,
				nextPhase.roll
			)
		) {
			const ft = await runFortuneTellerChain(
				stateAfter,
				activeIdx,
				events
			)
			finalPlayers = ft.state.players
			finalPhase = ft.state.phase
		}
	}

	const { error: stateErr } = await admin
		.from('game_states')
		.update({ players: finalPlayers, phase: finalPhase })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')
	const { error: gameErr } = await admin
		.from('games')
		.update({ events: [...(game.events ?? []), ...events] })
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')
	return json({ ok: true })
}

async function handleMoveForgerToken(
	admin: SupabaseClient,
	me: string,
	body: MoveForgerTokenBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded
	if (game.status !== 'active') return err(400, 'not active')
	if (state.phase.kind !== 'roll') return err(400, 'expected roll phase')
	if (state.phase.pending?.dice) return err(400, 'dice already pending')
	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (game.current_turn !== meIdx) return err(403, 'not your turn')
	const meP = state.players[meIdx]
	if (meP.bonus !== 'forger') return err(400, 'not a forger')
	if (meP.forgerMovedThisTurn) return err(400, 'already moved this turn')
	if (
		!(boardFor(state.variant).hexes as readonly string[]).includes(body.hex)
	)
		return err(400, 'unknown hex')
	const target = body.hex as Hex
	const from = forgerTokenHex(meP, state.robber)
	if (target === from) return err(400, 'must move to a new hex')
	if (!hexesAdjacentTo(from, state.variant).includes(target))
		return err(400, 'target hex must be adjacent to current')

	const nextPlayers = state.players.map((p, i) => {
		if (i !== meIdx) return p
		return { ...p, forgerToken: target, forgerMovedThisTurn: true }
	})
	const events: unknown[] = [
		{
			kind: 'forger_token_move',
			player: meIdx,
			hex: target,
			at: new Date().toISOString(),
		},
	]
	const { error: stateErr } = await admin
		.from('game_states')
		.update({ players: nextPlayers })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')
	const { error: gameErr } = await admin
		.from('games')
		.update({ events: [...(game.events ?? []), ...events] })
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')
	return json({ ok: true })
}

async function handlePickForgerTarget(
	admin: SupabaseClient,
	me: string,
	body: PickForgerTargetBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded
	if (state.phase.kind !== 'forger_pick')
		return err(400, 'expected forger_pick phase')
	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	const head = state.phase.queue[0]
	if (!head) return err(400, 'forger queue empty')
	if (head.idx !== meIdx) return err(403, 'not your turn to pick')
	const target = body.target
	if (typeof target !== 'number' || !Number.isInteger(target))
		return err(400, 'invalid target')
	const gain = head.gainsByCandidate[target]
	if (!gain) return err(400, 'target is not a candidate')

	const nextPlayers = state.players.map((p, i) => {
		if (i !== meIdx) return p
		const r = p.resources
		return {
			...p,
			resources: {
				brick: r.brick + gain.brick,
				wood: r.wood + gain.wood,
				sheep: r.sheep + gain.sheep,
				wheat: r.wheat + gain.wheat,
				ore: r.ore + gain.ore,
			},
		}
	})
	const newQueue = state.phase.queue.slice(1)
	const nextPhase: Phase =
		newQueue.length > 0
			? { ...state.phase, queue: newQueue }
			: state.phase.resume

	const events: unknown[] = [
		{
			kind: 'forger_copy',
			player: meIdx,
			target,
			gain,
			at: new Date().toISOString(),
		},
	]

	let finalPhase = nextPhase
	let finalPlayers = nextPlayers
	if (nextPhase.kind === 'main') {
		const activeIdx = game.current_turn ?? 0
		if (
			fortuneTellerTriggersOn(
				finalPlayers[activeIdx]?.bonus,
				nextPhase.roll
			)
		) {
			const stateAfter: GameState = {
				...state,
				players: finalPlayers,
				phase: nextPhase,
			}
			const ft = await runFortuneTellerChain(
				stateAfter,
				activeIdx,
				events
			)
			finalPlayers = ft.state.players
			finalPhase = ft.state.phase
		}
	}

	const { error: stateErr } = await admin
		.from('game_states')
		.update({ players: finalPlayers, phase: finalPhase })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')
	const { error: gameErr } = await admin
		.from('games')
		.update({ events: [...(game.events ?? []), ...events] })
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')
	return json({ ok: true })
}

function parseResource(v: unknown): Resource | null {
	if (typeof v !== 'string') return null
	if ((RESOURCES as readonly string[]).includes(v)) return v as Resource
	return null
}

// --- Veteran (tap played knight → 2 resources) ----------------------------

async function handleTapKnight(
	admin: SupabaseClient,
	me: string,
	body: TapKnightBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	if (game.status !== 'active') return err(400, 'not active')
	if (state.phase.kind !== 'main') return err(400, 'expected main phase')

	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (game.current_turn !== meIdx) return err(403, 'not your turn')

	const p = state.players[meIdx]
	if (p.bonus !== 'veteran') return err(400, 'not a veteran')

	const knightsPlayedCount = p.devCardsPlayed.knight ?? 0
	const alreadyTapped = p.tappedKnights ?? 0
	if (knightsPlayedCount - alreadyTapped < 1)
		return err(400, 'no untapped played knight')

	const r1 = parseResource(body.r1)
	const r2 = parseResource(body.r2)
	if (!r1 || !r2) return err(400, 'invalid resource selection')

	const nextPlayers = state.players.map((pp, i) => {
		if (i !== meIdx) return pp
		const nextRes = { ...pp.resources }
		nextRes[r1] += 1
		nextRes[r2] += 1
		return {
			...pp,
			resources: nextRes,
			tappedKnights: alreadyTapped + 1,
		}
	})

	const { error: stateErr } = await admin
		.from('game_states')
		.update({ players: nextPlayers })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	const event = {
		kind: 'knight_tapped',
		player: meIdx,
		resources: [r1, r2],
		at: new Date().toISOString(),
	}
	const { error: gameErr } = await admin
		.from('games')
		.update({ events: [...(game.events ?? []), event] })
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')
	return json({ ok: true })
}

// --- Carpenter (4 wood → 1 VP) --------------------------------------------

const CARPENTER_WOOD_COST = 4

async function handleBuyCarpenterVP(
	admin: SupabaseClient,
	me: string,
	body: BuyCarpenterVPBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	if (game.status !== 'active') return err(400, 'not active')
	if (state.phase.kind !== 'main') return err(400, 'expected main phase')

	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (game.current_turn !== meIdx) return err(403, 'not your turn')

	const me0 = state.players[meIdx]
	if (me0.bonus !== 'carpenter') return err(400, 'not a carpenter')
	if (me0.boughtCarpenterVPThisTurn)
		return err(400, 'already bought carpenter VP this turn')
	if (me0.resources.wood < CARPENTER_WOOD_COST)
		return err(400, 'insufficient wood')

	const nextPlayers = state.players.map((p, i) => {
		if (i !== meIdx) return p
		return {
			...p,
			resources: {
				...p.resources,
				wood: p.resources.wood - CARPENTER_WOOD_COST,
			},
			carpenterVP: (p.carpenterVP ?? 0) + 1,
			boughtCarpenterVPThisTurn: true,
		}
	})

	const update: Record<string, unknown> = { players: nextPlayers }
	const nextState: GameState = { ...state, players: nextPlayers }
	const events: unknown[] = [
		{
			kind: 'carpenter_vp',
			player: meIdx,
			at: new Date().toISOString(),
		},
	]
	// 1 VP can push the buyer over the threshold; no road-graph change.
	const winner = applyEndOfActionChecks(nextState, update, events, {
		recomputeRoads: false,
	})
	const commitErr = await commitActionWrite(
		admin,
		game,
		update,
		events,
		winner,
		nextState
	)
	if (commitErr) return commitErr
	return json({ ok: true })
}

// --- Specialist declaration (post_placement) ------------------------------

async function handleSetSpecialistResource(
	admin: SupabaseClient,
	me: string,
	body: SetSpecialistResourceBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	if (game.status !== 'active') return err(400, 'not active')
	if (state.phase.kind !== 'post_placement')
		return err(400, 'expected post_placement phase')

	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')

	const resource = parseResource(body.resource)
	if (!resource) return err(400, 'unknown resource')

	const specialistPending = state.phase.pending.specialist
	if (!specialistPending.includes(meIdx))
		return err(400, 'not in specialist pending list')
	if (state.players[meIdx]?.bonus !== 'specialist')
		return err(400, 'not a specialist')

	const nextPlayers = state.players.map((p, i) => {
		if (i !== meIdx) return p
		return { ...p, specialistResource: resource }
	})
	const nextSpecialistPending = specialistPending.filter((i) => i !== meIdx)
	const nextPhase = postPlacementPhaseFrom({
		...state.phase.pending,
		specialist: nextSpecialistPending,
	})

	const { error: stateErr } = await admin
		.from('game_states')
		.update({ players: nextPlayers, phase: nextPhase })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	const event = {
		kind: 'specialist_set',
		player: meIdx,
		resource,
		at: new Date().toISOString(),
	}
	const { error: gameErr } = await admin
		.from('games')
		.update({ events: [...(game.events ?? []), event] })
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')

	return json({ ok: true })
}

// --- Set 3 handlers --------------------------------------------------------

async function handlePlaceFenceToken(
	admin: SupabaseClient,
	me: string,
	body: PlaceFenceTokenBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded
	if (state.phase.kind !== 'post_placement')
		return err(400, 'expected post_placement phase')
	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (state.players[meIdx]?.bonus !== 'fencer')
		return err(400, 'not a fencer')
	const remaining = state.phase.pending.fencer?.[meIdx] ?? 0
	if (remaining <= 0) return err(400, 'no fence tokens remaining')
	if (
		!(boardFor(state.variant).edges as readonly string[]).includes(
			body.edge
		)
	)
		return err(400, 'unknown edge')
	const edge = body.edge as Edge
	if (edgeStateOf(state, edge).occupied) return err(400, 'edge occupied')
	if (state.fenceTokens?.[edge] !== undefined)
		return err(400, 'edge already fenced')

	const nextFenceTokens = { ...(state.fenceTokens ?? {}), [edge]: meIdx }
	const newRemaining = remaining - 1
	const newFencer = { ...(state.phase.pending.fencer ?? {}) }
	if (newRemaining <= 0) delete newFencer[meIdx]
	else newFencer[meIdx] = newRemaining
	const nextPhase = postPlacementPhaseFrom({
		...state.phase.pending,
		fencer: newFencer,
	})

	const { error: stateErr } = await admin
		.from('game_states')
		.update({ fence_tokens: nextFenceTokens, phase: nextPhase })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')
	const event = {
		kind: 'fence_token',
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

async function handleSetHauntSpots(
	admin: SupabaseClient,
	me: string,
	body: SetHauntSpotsBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded
	if (state.phase.kind !== 'post_placement')
		return err(400, 'expected post_placement phase')
	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (state.players[meIdx]?.bonus !== 'haunt')
		return err(400, 'not a haunt player')
	const hauntPending = state.phase.pending.haunt ?? []
	if (!hauntPending.includes(meIdx))
		return err(400, 'not in haunt pending list')

	if (!Array.isArray(body.spots) || body.spots.length !== HAUNT_SPOT_COUNT)
		return err(400, 'need exactly two spots')
	const verts = boardFor(state.variant).vertices as readonly string[]
	const spots: Vertex[] = []
	for (const s of body.spots) {
		if (typeof s !== 'string' || !verts.includes(s))
			return err(400, 'unknown vertex')
		spots.push(s as Vertex)
	}
	if (spots[0] === spots[1]) return err(400, 'spots must be distinct')
	for (const spot of spots) {
		if (!isValidSettlementVertex(state, spot))
			return err(400, 'spot is not currently buildable')
	}

	const nextPlayers = state.players.map((p, i) =>
		i === meIdx ? { ...p, hauntSpots: spots } : p
	)
	const nextHaunt = hauntPending.filter((i) => i !== meIdx)
	const nextPhase = postPlacementPhaseFrom({
		...state.phase.pending,
		haunt: nextHaunt,
	})

	const { error: stateErr } = await admin
		.from('game_states')
		.update({ players: nextPlayers, phase: nextPhase })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')
	// Coordinates stay private — the log only records that they chose.
	const event = {
		kind: 'haunt_spots_set',
		player: meIdx,
		at: new Date().toISOString(),
	}
	const { error: gameErr } = await admin
		.from('games')
		.update({ events: [...(game.events ?? []), event] })
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')
	return json({ ok: true })
}

async function handleInvest(
	admin: SupabaseClient,
	me: string,
	body: InvestBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded
	if (game.status !== 'active') return err(400, 'not active')
	if (state.phase.kind !== 'main') return err(400, 'expected main phase')
	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (game.current_turn !== meIdx) return err(403, 'not your turn')
	const meP = state.players[meIdx]
	if (meP.bonus !== 'investor') return err(400, 'not an investor')
	const resource = parseResource(body.resource)
	if (!resource) return err(400, 'unknown resource')
	if (
		!canInvest(
			meP,
			resource,
			totalVP(state, meIdx),
			gameSizeFor(state.players.length)
		)
	)
		return err(400, 'cannot invest')

	const nextResources = {
		...meP.resources,
		[resource]: meP.resources[resource] - INVEST_TRIO,
	}
	const nextInvestments = { ...(meP.investments ?? {}) }
	nextInvestments[resource] = (nextInvestments[resource] ?? 0) + 1
	const nextPlayers = state.players.map((p, i) =>
		i === meIdx
			? { ...p, resources: nextResources, investments: nextInvestments }
			: p
	)
	const { error: stateErr } = await admin
		.from('game_states')
		.update({ players: nextPlayers })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')
	const event = {
		kind: 'invest',
		player: meIdx,
		resource,
		at: new Date().toISOString(),
	}
	const { error: gameErr } = await admin
		.from('games')
		.update({ events: [...(game.events ?? []), event] })
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')
	return json({ ok: true })
}

async function handleCastMagic(
	admin: SupabaseClient,
	me: string,
	body: CastMagicBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded
	if (state.phase.kind !== 'magician_pick')
		return err(400, 'expected magician_pick phase')
	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (state.phase.roller !== meIdx)
		return err(403, 'not your magician window')

	const actualTotal = state.phase.roll.a + state.phase.roll.b
	const target = Number(body.target)
	if (!isValidMagicTarget(actualTotal, target))
		return err(400, 'invalid target')
	const discard = normalizeHand(body.discard)
	if (!discard) return err(400, 'invalid discard hand')
	if (
		handSize(discard) !==
		magicDiscardCount(
			actualTotal,
			target,
			gameSizeFor(state.players.length)
		)
	)
		return err(400, 'wrong discard count')
	const meP = state.players[meIdx]
	if (!canAfford(meP.resources, discard))
		return err(400, 'insufficient cards to discard')

	// Phantom production: gains for the magician only, from the target number.
	const gain = distributeResources(state, target)[meIdx] ?? emptyHand()
	const nextResources = { ...meP.resources }
	for (const r of RESOURCES)
		nextResources[r] = nextResources[r] - discard[r] + gain[r]
	// Stamp the round so the two-player cooldown can see it. Harmless
	// everywhere else — `magicianCanCast` only reads it where the variant
	// declares a cooldown.
	const nextPlayers = state.players.map((p, i) =>
		i === meIdx
			? { ...p, resources: nextResources, lastMagicRound: state.round }
			: p
	)
	const resume = state.phase.resume

	const { error: stateErr } = await admin
		.from('game_states')
		.update({ players: nextPlayers, phase: resume })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')
	const event = {
		kind: 'magic_cast',
		player: meIdx,
		target,
		discard,
		gain,
		at: new Date().toISOString(),
	}
	const { error: gameErr } = await admin
		.from('games')
		.update({ events: [...(game.events ?? []), event] })
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')
	return json({ ok: true })
}

async function handleSkipMagic(
	admin: SupabaseClient,
	me: string,
	body: SkipMagicBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded
	if (state.phase.kind !== 'magician_pick')
		return err(400, 'expected magician_pick phase')
	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (state.phase.roller !== meIdx)
		return err(403, 'not your magician window')

	const resume = state.phase.resume
	const { error: stateErr } = await admin
		.from('game_states')
		.update({ phase: resume })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')
	const event = {
		kind: 'magic_skipped',
		player: meIdx,
		at: new Date().toISOString(),
	}
	const { error: gameErr } = await admin
		.from('games')
		.update({ events: [...(game.events ?? []), event] })
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')
	return json({ ok: true })
}

async function handlePlayDevCard(
	admin: SupabaseClient,
	me: string,
	body: PlayDevCardBody
): Promise<Response> {
	const loaded = await loadGame(admin, body.game_id)
	if (!loaded.ok) return loaded.response
	const { game, state } = loaded

	if (game.status !== 'active') return err(400, 'not active')

	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (game.current_turn !== meIdx) return err(403, 'not your turn')

	const phase = state.phase
	// Classic Catan allows pre-roll dev plays. Everything else must be main.
	if (phase.kind !== 'main' && phase.kind !== 'roll')
		return err(400, 'expected main or roll phase')

	if (
		typeof body.id !== 'string' ||
		!DEV_CARD_IDS.includes(body.id as DevCardId)
	)
		return err(400, 'unknown dev card id')
	const id = body.id as DevCardId
	if (id === 'victory_point') return err(400, 'VP cards cannot be played')

	const player = state.players[meIdx]
	if (player.playedDevThisTurn)
		return err(400, 'already played a dev card this turn')

	// Find an entry bought on a prior turn (`purchasedTurn < state.round`).
	const entryIdx = player.devCards.findIndex(
		(c) => c.id === id && c.purchasedTurn < state.round
	)
	if (entryIdx < 0) return err(400, 'no playable card of that id')

	const resume: ResumePhase =
		phase.kind === 'main'
			? { kind: 'main', roll: phase.roll, trade: phase.trade }
			: { kind: 'roll' }

	const now = new Date().toISOString()
	const events: unknown[] = []

	// Shared mutations: remove the card, bump played count, set the flag.
	const nextDevCards = [...player.devCards]
	nextDevCards.splice(entryIdx, 1)
	const nextDevCardsPlayed = {
		...player.devCardsPlayed,
		[id]: (player.devCardsPlayed[id] ?? 0) + 1,
	}
	const basePlayer: PlayerState = {
		...player,
		devCards: nextDevCards,
		devCardsPlayed: nextDevCardsPlayed,
		playedDevThisTurn: true,
	}

	let nextPlayers: PlayerState[] = state.players.map((p, i) =>
		i === meIdx ? basePlayer : p
	)
	let nextPhase: Phase = resume
	let nextLargestArmy: number | null = state.largestArmy
	const update: Record<string, unknown> = {}

	switch (id) {
		case 'knight': {
			// Update Largest Army, then enter move_robber with the stored resume.
			const speculative: GameState = {
				...state,
				players: nextPlayers,
				largestArmy: state.largestArmy,
			}
			const newHolder = recomputeLargestArmy(speculative)
			if (newHolder !== state.largestArmy) {
				nextLargestArmy = newHolder
				if (newHolder !== null) {
					events.push({
						kind: 'largest_army_changed',
						player: newHolder,
						at: now,
					})
				}
			}
			nextPhase = { kind: 'move_robber', resume }
			break
		}
		case 'road_building': {
			const speculative: GameState = { ...state, players: nextPlayers }
			if (!hasLegalRoadPlacement(speculative, meIdx)) {
				// No legal placements → card is consumed, phase doesn't change.
				nextPhase = resume
			} else {
				nextPhase = { kind: 'road_building', resume, remaining: 2 }
			}
			break
		}
		case 'year_of_plenty': {
			const payload = body.payload as {
				r1?: unknown
				r2?: unknown
			} | null
			const r1 = payload ? parseResource(payload.r1) : null
			const r2 = payload ? parseResource(payload.r2) : null
			if (!r1 || !r2) return err(400, 'invalid year_of_plenty payload')
			nextPlayers = nextPlayers.map((p, i) => {
				if (i !== meIdx) return p
				// r1 and r2 can be the same resource, so add cumulatively rather
				// than with two computed keys (the second would clobber the first).
				const resources = { ...p.resources }
				resources[r1] += 1
				resources[r2] += 1
				return { ...p, resources }
			})
			events.push({
				kind: 'dev_played',
				player: meIdx,
				id,
				take: [r1, r2],
				at: now,
			})
			break
		}
		case 'monopoly': {
			const payload = body.payload as { resource?: unknown } | null
			const resource = payload ? parseResource(payload.resource) : null
			if (!resource) return err(400, 'invalid monopoly payload')
			// `limitMonopoly` caps what any single opponent loses; the total
			// haul across the table stays uncapped.
			const perPlayerCap = state.config.limitMonopoly
				? monopolyCap(nextPlayers.length)
				: Infinity
			let stolen = 0
			nextPlayers = nextPlayers.map((p, i) => {
				if (i === meIdx) return p
				const take = Math.min(p.resources[resource], perPlayerCap)
				stolen += take
				return {
					...p,
					resources: {
						...p.resources,
						[resource]: p.resources[resource] - take,
					},
				}
			})
			nextPlayers = nextPlayers.map((p, i) =>
				i === meIdx
					? {
							...p,
							resources: {
								...p.resources,
								[resource]: p.resources[resource] + stolen,
							},
						}
					: p
			)
			events.push({
				kind: 'dev_played',
				player: meIdx,
				id,
				resource,
				total: stolen,
				at: now,
			})
			break
		}
	}

	// Knight + road_building log their `dev_played` with no extra payload.
	if (id === 'knight' || id === 'road_building') {
		events.push({ kind: 'dev_played', player: meIdx, id, at: now })
	}

	update.players = nextPlayers
	update.phase = nextPhase
	if (nextLargestArmy !== state.largestArmy) {
		update.largest_army = nextLargestArmy
	}

	const nextState: GameState = {
		...state,
		players: nextPlayers,
		phase: nextPhase,
		largestArmy: nextLargestArmy,
	}
	// A knight play can shift Largest Army (+2 VP swing) and push the new
	// holder over 10. Road Building card's actual road placements flow
	// through handleBuildRoad, which runs its own recompute — skip here.
	const winner = applyEndOfActionChecks(nextState, update, events, {
		recomputeRoads: false,
	})
	const commitErr = await commitActionWrite(
		admin,
		game,
		update,
		events,
		winner,
		nextState
	)
	if (commitErr) return commitErr

	return json({ ok: true })
}

// --- One-step undo ---------------------------------------------------------
//
// Mirror of `UNDOABLE_ACTIONS` in `lib/catan/types.ts`; this copy is the
// authority. The rule is solo + information-free: rolling, buying or playing a
// dev card, and anything that involves another player are all excluded, because
// taking them reveals something and unwinding them would leak it. See
// `.claude/specs/undo.md`.
const UNDOABLE_ACTIONS = new Set<string>([
	'build_road',
	'build_settlement',
	'build_city',
	'build_super_city',
	'bank_trade',
	'liquidate',
	'invest',
	'buy_carpenter_vp',
	'tap_knight',
	'place_fence_token',
	'place_explorer_road',
])

// Chat is the one action that invalidates nothing — it writes neither
// `game_states` nor `games.events`. `honk` deliberately isn't here: it appends
// to `games.events`, which undo truncates by length, so a surviving honk would
// be truncated away.
const UNDO_NEUTRAL_ACTIONS = new Set<string>(['send_message'])

// The mutable `game_states` columns. `hexes`/`variant` are omitted (nothing
// mutates them) and so is `games.current_turn` — no undoable action writes it.
// If one ever does, the snapshot has to grow to cover it.
const UNDO_COLUMNS =
	'vertices, edges, players, phase, robber, ports, fence_tokens, dev_deck, largest_army, longest_road, round'

type UndoSnapshot = {
	action: string
	player: number
	at: string
	eventsLen: number
	state: Record<string, unknown>
}

// Read what an undoable action is about to overwrite. Returns null (rather than
// failing the request) whenever the snapshot can't be built — undo is a
// convenience, and no part of it should be able to block a legal move.
async function readUndoBaseline(
	admin: SupabaseClient,
	gameId: string,
	me: string
): Promise<Omit<UndoSnapshot, 'action' | 'at'> | null> {
	const { data: stateRow } = await admin
		.from('game_states')
		.select(UNDO_COLUMNS)
		.eq('game_id', gameId)
		.maybeSingle()
	if (!stateRow) return null

	const { data: gameRow } = await admin
		.from('games')
		.select('events, player_order')
		.eq('id', gameId)
		.maybeSingle()
	if (!gameRow) return null

	const row = gameRow as { player_order?: string[]; events?: unknown[] }
	const player = (row.player_order ?? []).indexOf(me)
	if (player < 0) return null

	return {
		player,
		eventsLen: (row.events ?? []).length,
		state: stateRow as unknown as Record<string, unknown>,
	}
}

// Maintains `game_states.undo` around a dispatched action, so no handler has to
// know undo exists. The clear is guarded on `undo is not null` so the common
// case matches zero rows — no row version, no realtime event.
async function trackUndo(
	admin: SupabaseClient,
	gameId: string,
	action: string,
	baseline: Omit<UndoSnapshot, 'action' | 'at'> | null
): Promise<void> {
	if (UNDO_NEUTRAL_ACTIONS.has(action)) return

	if (UNDOABLE_ACTIONS.has(action)) {
		if (!baseline) return
		const undo: UndoSnapshot = {
			...baseline,
			action,
			at: new Date().toISOString(),
		}
		await admin.from('game_states').update({ undo }).eq('game_id', gameId)
		return
	}

	await admin
		.from('game_states')
		.update({ undo: null })
		.eq('game_id', gameId)
		.not('undo', 'is', null)
}

// Restores the snapshot wholesale rather than computing an inverse — a single
// road build can move Longest Road, consume a fence token, and apply a
// smith/bricklayer cost substitution, and an inverse would have to keep up with
// every bonus we add.
async function handleUndo(
	admin: SupabaseClient,
	me: string,
	body: UndoBody
): Promise<Response> {
	const { data: gameRow, error: gErr } = await admin
		.from('games')
		.select('id, player_order, status, events')
		.eq('id', body.game_id)
		.maybeSingle()
	if (gErr) return err(500, 'load game failed')
	if (!gameRow) return err(404, 'game not found')
	const game = gameRow as {
		player_order: string[]
		status: string
		events: unknown[] | null
	}
	// A game-winning build isn't undoable: the win is already written to
	// `games.status` and `game_results`, and the snapshot covers neither.
	if (game.status !== 'active') return err(400, 'not active')

	const meIdx = game.player_order.indexOf(me)
	if (meIdx < 0) return err(403, 'not a participant')

	const { data: stateRow, error: sErr } = await admin
		.from('game_states')
		.select('undo')
		.eq('game_id', body.game_id)
		.maybeSingle()
	if (sErr) return err(500, 'load state failed')

	const snapshot = (stateRow as { undo?: UndoSnapshot | null } | null)?.undo
	if (!snapshot) return err(400, 'nothing to undo')
	if (snapshot.player !== meIdx) return err(403, 'not your action to undo')

	const { error: stateErr } = await admin
		.from('game_states')
		.update({ ...snapshot.state, undo: null })
		.eq('game_id', body.game_id)
	if (stateErr) return err(500, 'could not restore state')

	// Truncating drops the undone action's log entry entirely — the road never
	// existed. Nothing is logged in its place.
	const { error: gameErr } = await admin
		.from('games')
		.update({ events: (game.events ?? []).slice(0, snapshot.eventsLen) })
		.eq('id', body.game_id)
	if (gameErr) return err(500, 'could not restore log')

	return json({ ok: true })
}

serve(async (req) => {
	if (req.method === 'OPTIONS') {
		return new Response('ok', { headers: CORS_HEADERS })
	}
	if (req.method !== 'POST') return err(405, 'method not allowed')

	let body: Body
	try {
		body = (await req.json()) as Body
	} catch {
		return err(400, 'invalid body')
	}

	const admin = adminClient()

	// The cron sweep is the one action with no user behind it, so it is
	// authorized by the service-role key rather than a JWT — and parsed before
	// the usual auth for exactly that reason.
	if (body.action === 'run_timeouts') {
		if (!isServiceRoleCaller(req)) return err(401, 'not authenticated')
		return handleRunTimeouts(admin)
	}

	const me = await callerUserId(req)
	if (!me) return err(401, 'not authenticated')

	// `game_states.undo` is maintained here rather than inside the handlers, so
	// an action opts into undo by joining `UNDOABLE_ACTIONS` and nothing else.
	// The baseline has to be read before the handler overwrites the row.
	const gameId = 'game_id' in body ? body.game_id : null
	const baseline =
		gameId && UNDOABLE_ACTIONS.has(body.action)
			? await readUndoBaseline(admin, gameId, me)
			: null

	const res = await dispatch(admin, me, body)
	if (gameId && res.ok) {
		await trackUndo(admin, gameId, body.action, baseline)
		// `games.deadline_at` is maintained here for the same reason as undo:
		// one place rather than fifty handlers. Backgrounded — nothing is
		// waiting on it. See refreshDeadline.
		if (!TIMEOUT_NEUTRAL_ACTIONS.has(body.action)) {
			EdgeRuntime.waitUntil(refreshDeadline(admin, gameId, me))
		}
	}
	return res
})

// A honk is a complaint about the stall, not an escape from it, so it must not
// push the deadline out — the same reason `lastActivityAt` ignores honks. Chat
// isn't a move either.
const TIMEOUT_NEUTRAL_ACTIONS = new Set<string>(['honk', 'send_message'])

function isServiceRoleCaller(req: Request): boolean {
	const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
	const token = (req.headers.get('Authorization') ?? '')
		.replace(/^Bearer\s+/i, '')
		.trim()
	return key.length > 0 && token === key
}

function dispatch(
	admin: SupabaseClient,
	me: string,
	body: Body
): Promise<Response> {
	switch (body.action) {
		case 'propose_game':
			return handleProposeGame(admin, me, body)
		case 'respond':
			return handleRespond(admin, me, body)
		case 'cancel_request':
			return handleCancelRequest(admin, me, body)
		case 'pick_bonus':
			return handlePickBonus(admin, me, body)
		case 'place_start':
			return handlePlaceStart(admin, me, body)
		case 'place_settlement':
			return handlePlaceSettlement(admin, me, body)
		case 'place_road':
			return handlePlaceRoad(admin, me, body)
		case 'choose_last_settlement':
			return handleChooseLastSettlement(admin, me, body)
		case 'roll':
			return handleRoll(admin, me, body)
		case 'confirm_roll':
			return handleConfirmRoll(admin, me, body)
		case 'reroll_dice':
			return handleRerollDice(admin, me, body)
		case 'end_turn':
			return handleEndTurn(admin, me, body)
		case 'honk':
			return handleHonk(admin, me, body)
		case 'send_message':
			return handleSendMessage(admin, me, body)
		case 'end_special_build':
			return handleEndSpecialBuild(admin, me, body)
		case 'build_road':
			return handleBuildRoad(admin, me, body)
		case 'build_settlement':
			return handleBuildSettlement(admin, me, body)
		case 'build_city':
			return handleBuildCity(admin, me, body)
		case 'discard':
			return handleDiscard(admin, me, body)
		case 'move_robber':
			return handleMoveRobber(admin, me, body)
		case 'steal':
			return handleSteal(admin, me, body)
		case 'propose_trade':
			return handleProposeTrade(admin, me, body)
		case 'accept_trade':
			return handleAcceptTrade(admin, me, body)
		case 'cancel_trade':
			return handleCancelTrade(admin, me, body)
		case 'reject_trade':
			return handleRejectTrade(admin, me, body)
		case 'confirm_trade':
			return handleConfirmTrade(admin, me, body)
		case 'bank_trade':
			return handleBankTrade(admin, me, body)
		case 'buy_dev_card':
			return handleBuyDevCard(admin, me, body)
		case 'play_dev_card':
			return handlePlayDevCard(admin, me, body)
		case 'set_specialist_resource':
			return handleSetSpecialistResource(admin, me, body)
		case 'buy_carpenter_vp':
			return handleBuyCarpenterVP(admin, me, body)
		case 'tap_knight':
			return handleTapKnight(admin, me, body)
		case 'build_super_city':
			return handleBuildSuperCity(admin, me, body)
		case 'liquidate':
			return handleLiquidate(admin, me, body)
		case 'place_explorer_road':
			return handlePlaceExplorerRoad(admin, me, body)
		case 'ritual_roll':
			return handleRitualRoll(admin, me, body)
		case 'shepherd_swap':
			return handleShepherdSwap(admin, me, body)
		case 'claim_curio':
			return handleClaimCurio(admin, me, body)
		case 'move_forger_token':
			return handleMoveForgerToken(admin, me, body)
		case 'pick_forger_target':
			return handlePickForgerTarget(admin, me, body)
		case 'confirm_scout_card':
			return handleConfirmScoutCard(admin, me, body)
		case 'place_fence_token':
			return handlePlaceFenceToken(admin, me, body)
		case 'set_haunt_spots':
			return handleSetHauntSpots(admin, me, body)
		case 'invest':
			return handleInvest(admin, me, body)
		case 'cast_magic':
			return handleCastMagic(admin, me, body)
		case 'skip_magic':
			return handleSkipMagic(admin, me, body)
		case 'undo':
			return handleUndo(admin, me, body)
		case 'set_forfeit':
			return handleSetForfeit(admin, me, body)
		case 'set_end_vote':
			return handleSetEndVote(admin, me, body)
		default:
			return Promise.resolve(err(400, 'unknown action'))
	}
}
