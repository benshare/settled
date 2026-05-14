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
import { sendNotifications } from '../_notify/index.ts'

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
type PickBonusBody = {
	action: 'pick_bonus'
	game_id: string
	bonus: string
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
type RollBody = { action: 'roll'; game_id: string }
type ConfirmRollBody = { action: 'confirm_roll'; game_id: string }
type RerollDiceBody = { action: 'reroll_dice'; game_id: string }
type EndTurnBody = { action: 'end_turn'; game_id: string }
type BuildRoadBody = {
	action: 'build_road'
	game_id: string
	edge: string
	use_bricklayer?: boolean
}
type BuildSettlementBody = {
	action: 'build_settlement'
	game_id: string
	vertex: string
	use_bricklayer?: boolean
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
type BankTradeBody = {
	action: 'bank_trade'
	game_id: string
	give: unknown
	receive: unknown
}
type BuyDevCardBody = {
	action: 'buy_dev_card'
	game_id: string
	use_bricklayer?: boolean
	scout_swap?: { from: unknown; to: unknown } | null
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
type Body =
	| ProposeGameBody
	| RespondBody
	| PickBonusBody
	| PlaceSettlementBody
	| PlaceRoadBody
	| RollBody
	| ConfirmRollBody
	| RerollDiceBody
	| EndTurnBody
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

type VertexBuilding = 'settlement' | 'city' | 'super_city'

type VertexState =
	| { occupied: false }
	| {
			occupied: true
			player: number
			building: VertexBuilding
			placedTurn: number
	  }

type EdgeState =
	| { occupied: false }
	| { occupied: true; player: number; placedTurn: number }

type ResourceHand = Record<Resource, number>

type DevCardId =
	| 'knight'
	| 'victory_point'
	| 'road_building'
	| 'year_of_plenty'
	| 'monopoly'

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

type SelectBonusHand = {
	offered: [BonusId, BonusId]
	curse: CurseId
	chosen: BonusId | null
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

function dealBonusHand(bonusSets: readonly string[]): SelectBonusHand {
	const pick = <T>(xs: readonly T[]): T =>
		xs[Math.floor(Math.random() * xs.length)]
	const filtered = BONUS_IDS.filter((id) =>
		bonusSets.includes(BONUS_SET_OF[id])
	)
	const pool = filtered.length > 0 ? filtered : BONUS_IDS
	return {
		offered: [pick(pool), pick(pool)],
		curse: pick(CURSE_IDS),
		chosen: null,
	}
}

// --- Config ----------------------------------------------------------------

type GameConfig = {
	bonuses: boolean
	bonusSets: string[]
	devCards: boolean
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
	| { kind: 'initial_placement'; round: 1 | 2; step: 'settlement' | 'road' }
	| {
			kind: 'post_placement'
			pending: {
				specialist: number[]
				explorer?: Partial<Record<number, number>>
			}
	  }
	| { kind: 'roll'; pending?: { dice: DiceRoll } }
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
	| {
			kind: 'scout_pick'
			resume: ResumePhase
			owner: number
			cards: DevCardId[]
	  }
	// curio_pick and forger_pick can chain: a roll that triggers both
	// enters forger_pick(resume=curio_pick(resume=main)). Their resume
	// therefore accepts any Phase (recursive) — not just ResumePhase —
	// since the next thing might itself be another sub-phase.
	| { kind: 'curio_pick'; resume: Phase; pending: number[] }
	| { kind: 'forger_pick'; resume: Phase; queue: ForgerPickEntry[] }
	| { kind: 'game_over' }

type GameState = {
	variant: string
	hexes: Record<Hex, HexData>
	vertices: Partial<Record<Vertex, VertexState>>
	edges: Partial<Record<Edge, EdgeState>>
	players: PlayerState[]
	phase: Phase
	robber: Hex
	ports?: Port[]
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
// on desert means no production (and no event).
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
	for (const v of adjacentVertices[hex]) {
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
	const desertHexes = HEXES.filter((h) => state.hexes[h].resource === null)
	const nextPlayers = state.players.map((p, i) => {
		if (p.bonus !== 'nomad') return p
		let count = 0
		for (const h of desertHexes) count += nomadProductionAt(state, i, h)
		if (count <= 0) return p
		const resource = nomadDie()
		events.push({
			kind: 'nomad_produce',
			player: i,
			resource,
			count,
			at: new Date().toISOString(),
		})
		return {
			...p,
			resources: {
				...p.resources,
				[resource]: p.resources[resource] + count,
			},
		}
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
	useBricklayer: boolean
): ResourceHand | null {
	if (useBricklayer) {
		if (p.bonus !== 'bricklayer') return null
		if (p.resources.brick < BRICKLAYER_COST.brick) return null
		return BRICKLAYER_COST
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

function canSpendUnderAge(p: PlayerState, costSize: number): boolean {
	if (p.curse !== 'age') return true
	const spent = p.cardsSpentThisTurn ?? 0
	return spent + costSize <= AGE_CARD_LIMIT
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
	for (const v of adjacentVertices[hex]) {
		const vs = vertexStateOf(state, v)
		if (!vs.occupied || vs.player !== playerIdx) continue
		power +=
			vs.building === 'super_city' ? 3 : vs.building === 'city' ? 2 : 1
	}
	return power
}

function countHexesAtMaxPower(state: GameState, playerIdx: number): number {
	let n = 0
	for (const h of HEXES) {
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
	for (const h of adjacentHexes[vertex]) {
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
		for (const h of adjacentHexes[vid as Vertex]) {
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
	for (const h of adjacentHexes[vertex]) {
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
	for (const n of neighborVertices[v]) {
		if (vertexStateOf(state, n).occupied) return false
	}
	if (playerIdx !== undefined) {
		if (!canPlaceUnderPower(state, playerIdx, v)) return false
		if (!settlementKeepsYouthOK(state, playerIdx, v)) return false
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

const UNDERDOG_NUMBERS = new Set<number>([2, 3, 11, 12])

function underdogMultiplierFor(
	bonus: BonusId | undefined,
	hexNumber: number
): 1 | 2 {
	if (bonus === 'underdog' && UNDERDOG_NUMBERS.has(hexNumber)) return 2
	return 1
}

// Kept for parity with lib/catan/roll.distributeResources. The edge
// function now uses `distributeResourcesByHex` everywhere; this helper is
// referenced indirectly through the parity check and may return for use
// when adding non-forger features that don't need per-hex breakdowns.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function distributeResources(
	state: GameState,
	total: number
): Record<number, ResourceHand> {
	const result: Record<number, ResourceHand> = {}
	if (total === 7) return result
	for (const hex of HEXES) {
		if (hex === state.robber) continue
		const hd = state.hexes[hex]
		if (hd.resource === null) continue
		if (hd.number !== total) continue
		for (const v of adjacentVertices[hex]) {
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
	return result
}

// Per-hex per-player gain for a roll. Used by the forger bonus to look up
// the gain another player received from the forger's token hex on this
// roll. Same rules as distributeResources but factored per hex.
function distributeResourcesByHex(
	state: GameState,
	total: number
): Partial<Record<Hex, Record<number, ResourceHand>>> {
	const out: Partial<Record<Hex, Record<number, ResourceHand>>> = {}
	if (total === 7) return out
	for (const hex of HEXES) {
		if (hex === state.robber) continue
		const hd = state.hexes[hex]
		if (hd.resource === null) continue
		if (hd.number !== total) continue
		const perPlayer: Record<number, ResourceHand> = {}
		for (const v of adjacentVertices[hex]) {
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
				perPlayer[vs.player] ??
				(perPlayer[vs.player] = {
					brick: 0,
					wood: 0,
					sheep: 0,
					wheat: 0,
					ore: 0,
				})
			hand[hd.resource] += gain
		}
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
	for (const n of neighborVertices[vertex]) {
		if (vertexStateOf(state, n).occupied) return false
	}
	if (!canPlaceUnderPower(state, playerIdx, vertex)) return false
	if (!settlementKeepsYouthOK(state, playerIdx, vertex)) return false
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
	for (const v of adjacentVertices[hex]) {
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
	for (const v of VERTICES) {
		const vs = vertexStateOf(state, v)
		const ownsVertex = vs.occupied && vs.player === meIdx
		const hasAdjOwnRoad = adjacentEdges[v].some((e) => {
			const es = edgeStateOf(state, e)
			return es.occupied && es.player === meIdx
		})
		if (!ownsVertex && !hasAdjOwnRoad) continue
		if (vs.occupied && vs.player !== meIdx) continue
		for (const e of adjacentEdges[v]) {
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

// --- Longest Road (must match lib/catan/longestRoad) -----------------------

const LONGEST_ROAD_THRESHOLD = 5

function longestRoadFor(state: GameState, playerIdx: number): number {
	const ownEdges: Edge[] = []
	for (const edge of EDGES) {
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
	if (vs.occupied && vs.player !== playerIdx) return used.size
	let best = used.size
	for (const e of adjacentEdges[head]) {
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
				v.building === 'super_city' ? 3 : v.building === 'city' ? 2 : 1
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
	for (const h of adjacentHexes[vertex]) {
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

function ritualCardCost(state: GameState, playerIdx: number): 2 | 3 {
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

function hexesAdjacentTo(hex: Hex): Hex[] {
	const seen = new Set<Hex>()
	for (const v of adjacentVertices[hex]) {
		for (const h of adjacentHexes[v]) {
			if (h === hex) continue
			seen.add(h)
		}
	}
	return Array.from(seen)
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

const SCOUT_PEEK_SIZE = 3

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

function roadRemovalSplitsBuildings(
	state: GameState,
	playerIdx: number,
	edge: Edge
): boolean {
	const myBuildings: Vertex[] = []
	for (const [vid, vs] of Object.entries(state.vertices)) {
		if (vs?.occupied && vs.player === playerIdx)
			myBuildings.push(vid as Vertex)
	}
	if (myBuildings.length <= 1) return false
	const seed = myBuildings[0]
	const visited = new Set<Vertex>([seed])
	const stack: Vertex[] = [seed]
	while (stack.length > 0) {
		const v = stack.pop()!
		for (const e of adjacentEdges[v]) {
			if (e === edge) continue
			const es = state.edges[e]
			if (!es?.occupied || es.player !== playerIdx) continue
			const [a, b] = e.split(' - ') as [Vertex, Vertex]
			const other = a === v ? b : a
			if (visited.has(other)) continue
			const ovs = vertexStateOf(state, other)
			if (ovs.occupied && ovs.player !== playerIdx) continue
			visited.add(other)
			stack.push(other)
		}
	}
	return myBuildings.some((b) => !visited.has(b))
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
	winner: number | null
): Promise<Response | null> {
	const { error: stateErr } = await admin
		.from('game_states')
		.update(stateUpdate)
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	const gameUpdate: Record<string, unknown> = {
		events: [...(game.events ?? []), ...events],
	}
	if (winner !== null) {
		gameUpdate.status = 'complete'
		gameUpdate.winner = winner
	}
	const { error: gameErr } = await admin
		.from('games')
		.update(gameUpdate)
		.eq('id', game.id)
	if (gameErr) return err(500, 'could not log event')
	return null
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

function rejectedByOf(offer: TradeOffer): number[] {
	return offer.rejectedBy ?? []
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

// Given a give/receive hand, infer which bank kind the caller is trying to
// use — highest-quality ratio they can support. Returns null if the hand
// can't be parsed into any kind the player actually has access to. Players
// under the `provinciality` curse can only use 5:1 regardless of ports.
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

	if (curseOf(state, playerIdx) === 'provinciality') {
		const allDivBy5 = giveResources.every((r) => give[r] % 5 === 0)
		return allDivBy5 ? '5:1' : null
	}

	const kinds = playerPortKinds(state, playerIdx)
	const specialistResource =
		state.players[playerIdx]?.specialistResource ?? null

	// Effective ratio for a give + candidate kind, applying specialist
	// discount only when give is a single-resource stack of the declared
	// specialty.
	const effective = (kind: BankKind) =>
		effectiveBankRatioFor(kind, give, specialistResource)

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
	const allDivBy3 = giveResources.every((r) => give[r] % 3 === 0)
	if (kinds.has('3:1') && allDivBy3) return '3:1'
	const allDivBy4 = giveResources.every((r) => give[r] % 4 === 0)
	if (allDivBy4) return '4:1'
	return null
}

function effectiveBankRatioFor(
	kind: BankKind,
	give: ResourceHand,
	specialistResource: Resource | null
): number {
	const base = ratioOfBank(kind)
	if (!specialistResource) return base
	const givers = RESOURCES.filter((r) => give[r] > 0)
	if (givers.length !== 1) return base
	if (givers[0] !== specialistResource) return base
	return Math.max(2, base - 1)
}

function isValidBankTradeShape(
	give: ResourceHand,
	receive: ResourceHand,
	kind: BankKind,
	specialistResource: Resource | null = null
): boolean {
	const ratio = effectiveBankRatioFor(kind, give, specialistResource)
	const locked: Resource | null = kind.startsWith('2:1-')
		? (kind.slice(4) as Resource)
		: null
	let giveTotal = 0
	let receiveTotal = 0
	for (const r of RESOURCES) {
		if (give[r] < 0 || receive[r] < 0) return false
		if (give[r] > 0 && receive[r] > 0) return false
		if (give[r] % ratio !== 0) return false
		if (locked && give[r] > 0 && r !== locked) return false
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

// Alternate 2:1 / 3:1 around the canonical ring (even indices = 2:1,
// odd = 3:1). Matches lib/catan/generate.ts.
function generatePorts(): Port[] {
	const twoOnes = shuffle(RESOURCES) as Resource[]
	let twoIdx = 0
	return PORT_SLOTS.map((edge, i) => {
		if (i % 2 === 0) return { edge, kind: twoOnes[twoIdx++] }
		return { edge, kind: '3:1' }
	})
}

// --- Game generation -------------------------------------------------------

function generateHexes(): {
	hexes: Record<Hex, HexData>
	desert: Hex
} {
	const bag: (Resource | null)[] = [null]
	for (const r of RESOURCES) {
		for (let i = 0; i < STANDARD_RESOURCE_COUNTS[r]; i++) bag.push(r)
	}
	const resources = shuffle(bag)
	const numbers = shuffle(STANDARD_NUMBERS)

	const out = {} as Record<Hex, HexData>
	let desert: Hex | null = null
	let numIdx = 0
	for (let i = 0; i < HEXES.length; i++) {
		const hex = HEXES[i]
		const r = resources[i]
		if (r === null) {
			out[hex] = { resource: null }
			desert = hex
		} else {
			out[hex] = { resource: r, number: numbers[numIdx++] }
		}
	}
	if (!desert) throw new Error('no desert generated')
	return { hexes: out, desert }
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
		variant: stateRow.variant,
		hexes: stateRow.hexes,
		vertices: stateRow.vertices,
		edges: stateRow.edges,
		players: stateRow.players,
		phase,
		robber: stateRow.robber,
		ports: stateRow.ports ?? [],
		config: stateRow.config as GameConfig,
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

		const { hexes: generatedHexes, desert } = generateHexes()
		const config = request.config as GameConfig
		let initialPhase: Phase
		if (config.bonuses) {
			const hands: Record<number, SelectBonusHand> = {}
			for (let i = 0; i < playerOrder.length; i++)
				hands[i] = dealBonusHand(config.bonusSets)
			initialPhase = { kind: 'select_bonus', hands }
		} else {
			initialPhase = INITIAL_PHASE
		}
		const { error: stateErr } = await admin.from('game_states').insert({
			game_id: inserted.id,
			variant: 'standard',
			hexes: generatedHexes,
			vertices: {},
			edges: {},
			players: initialPlayers(playerOrder.length),
			phase: initialPhase,
			robber: desert,
			ports: generatePorts(),
			config,
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

// select_bonus: each player picks one of their two offered bonuses to keep.
// Picks are parallel — no current_turn enforcement. When every hand's
// `chosen` is set, snapshot each player's kept bonus + dealt curse onto
// PlayerState and advance the phase to initial_placement.
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

	const nextHands: Record<number, SelectBonusHand> = {
		...state.phase.hands,
		[meIdx]: { ...hand, chosen: bonus },
	}

	const allChosen = game.player_order.every(
		(_, i) => nextHands[i]?.chosen !== null
	)

	let nextPhase: Phase
	let nextPlayers = state.players
	if (allChosen) {
		nextPlayers = state.players.map((p, i) => ({
			...p,
			bonus: nextHands[i]!.chosen!,
			curse: nextHands[i]!.curse,
		}))
		nextPhase = { kind: 'initial_placement', round: 1, step: 'settlement' }
	} else {
		nextPhase = { kind: 'select_bonus', hands: nextHands }
	}

	const { error: stateErr } = await admin
		.from('game_states')
		.update({ phase: nextPhase, players: nextPlayers })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

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

	if (!isValidSettlementVertex(state, vertex, meIdx))
		return err(400, 'invalid settlement placement')

	const round = state.phase.round
	const nextVertices = {
		...state.vertices,
		[vertex]: {
			occupied: true as const,
			player: meIdx,
			building: 'settlement' as const,
			placedTurn: state.round,
		},
	}

	let nextPlayers = state.players
	const myBonus = bonusOf(state, meIdx)
	if (round === 2 || myBonus === 'aristocrat') {
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
		[edge]: {
			occupied: true as const,
			player: meIdx,
			placedTurn: state.round,
		},
	}

	const roadEvent = {
		kind: 'road_placed',
		player: meIdx,
		edge,
		round,
		at: new Date().toISOString(),
	}

	if (next === null) {
		// Last placement — transition to active. If any player has a
		// start-of-game bonus (specialist, explorer), enter `post_placement`
		// so they can resolve their decision. Otherwise go straight to `roll`.
		const specialistIdxs: number[] = []
		const explorerOwed: Partial<Record<number, number>> = {}
		state.players.forEach((p, i) => {
			if (p.bonus === 'specialist') specialistIdxs.push(i)
			if (p.bonus === 'explorer') explorerOwed[i] = 3
		})
		const explorerHas = Object.keys(explorerOwed).length > 0
		const postPlacementPhase: Phase =
			specialistIdxs.length > 0 || explorerHas
				? {
						kind: 'post_placement',
						pending: {
							specialist: specialistIdxs,
							...(explorerHas ? { explorer: explorerOwed } : {}),
						},
					}
				: { kind: 'roll' }

		const { error: stateErr } = await admin
			.from('game_states')
			.update({
				edges: nextEdges,
				phase: postPlacementPhase,
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
		// Nomad: each nomad player produces from the desert (settlement=1,
		// city=2, super_city=3 of a randomly chosen resource) BEFORE
		// discards are computed. A nomad who was at 7 pre-roll can be
		// forced into discard range by their own nomad gain.
		const nomadResult = applyNomadProduce(state)
		const playersAfterNomad = nomadResult.players
		const stateAfterNomad: GameState = {
			...state,
			players: playersAfterNomad,
		}
		const pending = requiredDiscards(playersAfterNomad)
		const resume: ResumePhase = { kind: 'main', roll: dice, trade: null }
		const nextPhase: Phase =
			Object.keys(pending).length > 0
				? { kind: 'discard', resume, pending, from7: true }
				: { kind: 'move_robber', resume, from7: true }

		const stateUpdate: Record<string, unknown> = { phase: nextPhase }
		if (nomadResult.events.length > 0) {
			stateUpdate.players = playersAfterNomad
		}
		const { error: stateErr } = await admin
			.from('game_states')
			.update(stateUpdate)
			.eq('game_id', game.id)
		if (stateErr) return err(500, 'could not update state')

		const { error: gameErr } = await admin
			.from('games')
			.update({
				events: [...existingEvents, ...nomadResult.events],
			})
			.eq('id', game.id)
		if (gameErr) return err(500, 'could not log event')

		// Keep stateAfterNomad referenced so future tooling can read the
		// post-grant state easily; not needed here beyond the update.
		void stateAfterNomad

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

	// Forger: queue picks for any forger whose token's hex produced AND
	// for whom another player gained from that hex this roll. Skipped on
	// bonus rolls.
	const forgerQueue: ForgerPickEntry[] = []
	if (options.distributeOnlyTo === undefined) {
		stateAfter.players.forEach((p, idx) => {
			if (p.bonus !== 'forger' || !p.forgerToken) return
			const hex = p.forgerToken
			const perPlayer = perHex[hex]
			if (!perPlayer) return
			const candidates: Record<number, ResourceHand> = {}
			for (const cidStr of Object.keys(perPlayer)) {
				const cid = Number(cidStr)
				if (cid === idx) continue
				if (handTotal(perPlayer[cid]) <= 0) continue
				candidates[cid] = perPlayer[cid]
			}
			if (Object.keys(candidates).length > 0) {
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

	const dice = rollDice()
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
	// the player commits via confirm_roll.
	if (bonusOf(state, meIdx) === 'gambler') {
		const { error: stateErr } = await admin
			.from('game_states')
			.update({
				phase: { kind: 'roll', pending: { dice } } satisfies Phase,
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

	const dice = state.phase.pending.dice
	const total = dice.a + dice.b
	const rollEvent = {
		kind: 'rolled',
		player: meIdx,
		dice: [dice.a, dice.b],
		total,
		at: new Date().toISOString(),
	}
	return applyRollOutcome(admin, game, state, dice, [rollEvent])
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

	const { error: stateErr } = await admin
		.from('game_states')
		.update({
			phase: { kind: 'roll' } satisfies Phase,
			players: nextPlayers,
			round: nextRound,
		})
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

	const nextUserId = game.player_order[nextTurn]
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
	if (game.current_turn !== meIdx) return err(403, 'not your turn')

	const phase = state.phase
	const isRoadBuilding = phase.kind === 'road_building'
	if (phase.kind !== 'main' && !isRoadBuilding)
		return err(400, 'expected main or road_building phase')

	if (!(EDGES as readonly string[]).includes(body.edge))
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
		const useBricklayer = !!body.use_bricklayer
		const cost = resolvePurchaseCost(
			state.players[meIdx],
			BUILD_COSTS.road,
			useBricklayer
		)
		if (!cost) return err(400, 'insufficient resources')
		if (!canSpendUnderAge(state.players[meIdx], costSize(cost)))
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

	const update: Record<string, unknown> = {
		edges: nextEdges,
		players: nextPlayers,
	}
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
		winner
	)
	if (commitErr) return commitErr

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
	const useBricklayer = !!body.use_bricklayer
	const cost = resolvePurchaseCost(
		state.players[meIdx],
		BUILD_COSTS.settlement,
		useBricklayer
	)
	if (!cost) return err(400, 'insufficient resources')
	if (!canSpendUnderAge(state.players[meIdx], costSize(cost)))
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
			kind: 'settlement_built',
			player: meIdx,
			vertex,
			at: new Date().toISOString(),
		},
	]
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
		winner
	)
	if (commitErr) return commitErr

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
		cost = resolvePurchaseCost(meP, BUILD_COSTS.city, false)
	}
	if (!cost) return err(400, 'insufficient resources')
	if (!canSpendUnderAge(meP, costSize(cost)))
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
		winner
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

	const nextPhase: Phase =
		Object.keys(nextPending).length > 0
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

	const { error: stateErr } = await admin
		.from('game_states')
		.update({ players: nextPlayers, phase: nextPhase })
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
		.update({ events: [...(game.events ?? []), event] })
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

	if (!(HEXES as readonly string[]).includes(body.hex))
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

	// Forger token snap: any 7-induced robber move re-anchors every
	// forger player's token to the new robber hex. Activates the token
	// the first time (snap from undefined → hex). Knight moves don't
	// trigger the snap (gated by from7).
	if (state.phase.from7) {
		const snapEvents: unknown[] = []
		nextPlayers = nextPlayers.map((p, i) => {
			if (p.bonus !== 'forger') return p
			snapEvents.push({
				kind: p.forgerToken ? 'forger_token_move' : 'forger_token_set',
				player: i,
				hex,
				at: now,
			})
			return { ...p, forgerToken: hex }
		})
		events.push(...snapEvents)
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
	let finalPlayers: PlayerState[] = nextPlayers
	let finalPhase: Phase = nextPhase
	if (
		state.phase.from7 &&
		nextPhase.kind === 'main' &&
		fortuneTellerTriggersOn(
			nextPlayers[game.current_turn ?? 0]?.bonus,
			nextPhase.roll
		)
	) {
		const stateAfterSteal: GameState = {
			...state,
			players: nextPlayers,
			phase: nextPhase,
		}
		const ft = await runFortuneTellerChain(
			stateAfterSteal,
			game.current_turn ?? 0,
			events
		)
		finalPlayers = ft.state.players
		finalPhase = ft.state.phase
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

	const toUserIds = to
		.map((idx) => game.player_order[idx])
		.filter((id): id is string => typeof id === 'string')
	if (toUserIds.length > 0) {
		EdgeRuntime.waitUntil(
			sendNotifications(
				admin,
				toUserIds.map((userId) => ({
					userId,
					kind: 'trade_proposed',
					gate: 'yourTurn',
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
	if (state.phase.kind !== 'main') return err(400, 'expected main phase')

	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (game.current_turn !== meIdx) return err(403, 'not your turn')

	const give = normalizeHand(body.give)
	const receive = normalizeHand(body.receive)
	if (!give || !receive) return err(400, 'invalid resource hand')

	const kind = inferBankKind(state, meIdx, give)
	if (!kind) return err(400, 'no valid bank ratio for this give hand')
	const specialistResource = state.players[meIdx]?.specialistResource ?? null
	if (!isValidBankTradeShape(give, receive, kind, specialistResource))
		return err(400, 'invalid bank trade shape')
	if (!canAfford(state.players[meIdx].resources, give))
		return err(400, 'insufficient resources')

	const nextPlayers = applyBankTradeToPlayer(
		state.players,
		meIdx,
		give,
		receive
	)
	const { error: stateErr } = await admin
		.from('game_states')
		.update({ players: nextPlayers })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	const ratio = effectiveBankRatioFor(kind, give, specialistResource)
	const event = {
		kind: 'bank_trade',
		player: meIdx,
		give,
		receive,
		ratio,
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
	if (state.phase.kind !== 'main') return err(400, 'expected main phase')
	if (!state.config.devCards) return err(400, 'dev cards disabled')

	const meIdx = currentPlayerIndex(game, me)
	if (meIdx === null) return err(403, 'not a participant')
	if (game.current_turn !== meIdx) return err(403, 'not your turn')

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
			useBricklayer
		)
	}
	if (!cost) return err(400, 'insufficient resources')
	if (!canSpendUnderAge(state.players[meIdx], costSize(cost)))
		return err(400, 'age limit reached this turn')

	const devSpend = costSize(cost)

	// Scout: peek at the top up-to-3 cards rather than committing the top.
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
		const scoutPhase: Phase = {
			kind: 'scout_pick',
			resume: { kind: 'main', roll: state.phase.roll, trade: null },
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
		winner
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
		winner
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
	if (!(VERTICES as readonly string[]).includes(body.vertex))
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
	if (!canSpendUnderAge(meP, costSize(cost)))
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
		winner
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
			if (!(EDGES as readonly string[]).includes(edge as string))
				return null
			const es = state.edges[edge]
			if (!es?.occupied || es.player !== meIdx) return null
			if (es.placedTurn >= state.round) return null
			if (roadRemovalSplitsBuildings(state, meIdx, edge)) return null
			return {
				hand: ROAD_REFUND,
				eventDetail: { kind: 'road', edge, at, refund: ROAD_REFUND },
			}
		}
		if (kind === 'settlement') {
			const vertex = target.vertex as Vertex
			if (!(VERTICES as readonly string[]).includes(vertex as string))
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
			if (!(VERTICES as readonly string[]).includes(vertex as string))
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
			if (!(VERTICES as readonly string[]).includes(vertex as string))
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
		winner
	)
	if (commitErr) return commitErr
	return json({ ok: true })
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
	if (!(EDGES as readonly string[]).includes(body.edge))
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

	const explorerEmpty = Object.keys(newExplorer).length === 0
	const specialistEmpty = state.phase.pending.specialist.length === 0
	const nextPhase: Phase =
		explorerEmpty && specialistEmpty
			? { kind: 'roll' }
			: {
					kind: 'post_placement',
					pending: {
						specialist: state.phase.pending.specialist,
						...(explorerEmpty ? {} : { explorer: newExplorer }),
					},
				}

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
	if (!meP.forgerToken) return err(400, 'forger token not yet active')
	if (meP.forgerMovedThisTurn) return err(400, 'already moved this turn')
	if (!(HEXES as readonly string[]).includes(body.hex))
		return err(400, 'unknown hex')
	const target = body.hex as Hex
	if (target === meP.forgerToken) return err(400, 'must move to a new hex')
	if (!hexesAdjacentTo(meP.forgerToken).includes(target))
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
		winner
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
	const allResolved = nextSpecialistPending.length === 0
	const nextPhase: Phase = allResolved
		? { kind: 'roll' }
		: {
				kind: 'post_placement',
				pending: { specialist: nextSpecialistPending },
			}

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
				return {
					...p,
					resources: {
						...p.resources,
						[r1]: p.resources[r1] + 1,
						[r2]: p.resources[r2] + 1,
					},
				}
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
			let stolen = 0
			nextPlayers = nextPlayers.map((p, i) => {
				if (i === meIdx) return p
				stolen += p.resources[resource]
				return { ...p, resources: { ...p.resources, [resource]: 0 } }
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
		winner
	)
	if (commitErr) return commitErr

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
		case 'propose_game':
			return handleProposeGame(admin, me, body)
		case 'respond':
			return handleRespond(admin, me, body)
		case 'pick_bonus':
			return handlePickBonus(admin, me, body)
		case 'place_settlement':
			return handlePlaceSettlement(admin, me, body)
		case 'place_road':
			return handlePlaceRoad(admin, me, body)
		case 'roll':
			return handleRoll(admin, me, body)
		case 'confirm_roll':
			return handleConfirmRoll(admin, me, body)
		case 'reroll_dice':
			return handleRerollDice(admin, me, body)
		case 'end_turn':
			return handleEndTurn(admin, me, body)
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
		default:
			return err(400, 'unknown action')
	}
})
