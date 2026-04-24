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

type InvitedEntry = {
	user: string
	status: 'pending' | 'accepted' | 'rejected'
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
type BankTradeBody = {
	action: 'bank_trade'
	game_id: string
	give: unknown
	receive: unknown
}
type BuyDevCardBody = { action: 'buy_dev_card'; game_id: string }
type PlayDevCardBody = {
	action: 'play_dev_card'
	game_id: string
	id: unknown
	payload?: unknown
}
type Body =
	| RespondBody
	| PickBonusBody
	| PlaceSettlementBody
	| PlaceRoadBody
	| RollBody
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
	| BankTradeBody
	| BuyDevCardBody
	| PlayDevCardBody

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

type Phase =
	| { kind: 'select_bonus'; hands: Record<number, SelectBonusHand> }
	| { kind: 'initial_placement'; round: 1 | 2; step: 'settlement' | 'road' }
	| { kind: 'roll' }
	| {
			kind: 'discard'
			resume: ResumePhase
			pending: Partial<Record<number, number>>
	  }
	| { kind: 'move_robber'; resume: ResumePhase }
	| { kind: 'steal'; resume: ResumePhase; hex: Hex; candidates: number[] }
	| { kind: 'road_building'; resume: ResumePhase; remaining: 1 | 2 }
	| { kind: 'main'; roll: DiceRoll; trade: TradeOffer | null }
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

function winVPThresholdFor(curse: CurseId | undefined): number {
	return curse === 'ambition' ? 11 : 10
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
		power += vs.building === 'city' ? 2 : 1
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
		const total = handSize(p.resources)
		if (total > 7)
			out[i] = p.curse === 'avarice' ? total : Math.floor(total / 2)
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
// Threshold is 10 by default and 11 under the `ambition` curse — see
// winVPThresholdFor in the Curses section. findWinner does the comparison.

function totalVP(state: GameState, playerIdx: number): number {
	const p = state.players[playerIdx]
	let vp = 0
	for (const v of Object.values(state.vertices)) {
		if (v?.occupied && v.player === playerIdx) {
			vp += v.building === 'city' ? 2 : 1
		}
	}
	if (state.largestArmy === playerIdx) vp += 2
	if (state.longestRoad === playerIdx) vp += 2
	for (const e of p.devCards) {
		if (e.id === 'victory_point') vp += 1
	}
	return vp
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
// or null. "Meets" = totalVP ≥ curse-specific VP threshold (10 default, 11
// under ambition) AND, if cursed with nomadism, ≥ 11 roads on the board.
// All VP (including hidden VP cards) counts.
function findWinner(state: GameState): number | null {
	for (let i = 0; i < state.players.length; i++) {
		const curse = curseOf(state, i)
		if (totalVP(state, i) < winVPThresholdFor(curse)) continue
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

	// Single-resource give → could be any; prefer 2:1 port for that resource,
	// then 3:1, then 4:1.
	if (giveResources.length === 1) {
		const only = giveResources[0]
		if (kinds.has(only) && give[only] % 2 === 0) {
			return `2:1-${only}` as BankKind
		}
		if (kinds.has('3:1') && give[only] % 3 === 0) return '3:1'
		if (give[only] % 4 === 0) return '4:1'
		return null
	}

	// Multi-resource give → can't use a 2:1 specific port. Prefer 3:1 then 4:1.
	const allDivBy3 = giveResources.every((r) => give[r] % 3 === 0)
	if (kinds.has('3:1') && allDivBy3) return '3:1'
	const allDivBy4 = giveResources.every((r) => give[r] % 4 === 0)
	if (allDivBy4) return '4:1'
	return null
}

function isValidBankTradeShape(
	give: ResourceHand,
	receive: ResourceHand,
	kind: BankKind
): boolean {
	const ratio = ratioOfBank(kind)
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

	const rollEvent = {
		kind: 'rolled',
		player: meIdx,
		dice: [dice.a, dice.b],
		total,
		at: new Date().toISOString(),
	}

	if (total === 7) {
		const pending = requiredDiscards(state.players)
		// 7-roll chain always resumes to main (dice are already thrown).
		const resume: ResumePhase = {
			kind: 'main',
			roll: dice,
			trade: null,
		}
		const nextPhase: Phase =
			Object.keys(pending).length > 0
				? { kind: 'discard', resume, pending }
				: { kind: 'move_robber', resume }

		const { error: stateErr } = await admin
			.from('game_states')
			.update({ phase: nextPhase })
			.eq('game_id', game.id)
		if (stateErr) return err(500, 'could not update state')

		const { error: gameErr } = await admin
			.from('games')
			.update({ events: [...(game.events ?? []), rollEvent] })
			.eq('id', game.id)
		if (gameErr) return err(500, 'could not log event')

		return json({ ok: true, dice, total })
	}

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

	// Clear the outgoing active player's one-per-turn dev flag so they can
	// play again when it becomes their turn again. Round bumps monotonically
	// so dev-cards bought last turn become playable now. Also reset the
	// age-curse per-turn spend counter.
	const nextPlayers = state.players.map((p, i) => {
		if (i !== meIdx) return p
		const next: PlayerState = { ...p, playedDevThisTurn: false }
		if (p.curse === 'age') next.cardsSpentThisTurn = 0
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
				[edge]: { occupied: true as const, player: meIdx },
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
		const cost = BUILD_COSTS.road
		if (!canAfford(state.players[meIdx].resources, cost))
			return err(400, 'insufficient resources')
		if (!canSpendUnderAge(state.players[meIdx], costSize(cost)))
			return err(400, 'age limit reached this turn')
		nextPlayers = applyCost(state.players, meIdx, cost)
	}

	const nextEdges = {
		...state.edges,
		[edge]: { occupied: true as const, player: meIdx },
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
	const cost = BUILD_COSTS.settlement
	if (!canAfford(state.players[meIdx].resources, cost))
		return err(400, 'insufficient resources')
	if (!canSpendUnderAge(state.players[meIdx], costSize(cost)))
		return err(400, 'age limit reached this turn')

	const nextVertices = {
		...state.vertices,
		[vertex]: {
			occupied: true as const,
			player: meIdx,
			building: 'settlement' as const,
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
	const cost = BUILD_COSTS.city
	if (!canAfford(state.players[meIdx].resources, cost))
		return err(400, 'insufficient resources')
	if (!canSpendUnderAge(state.players[meIdx], costSize(cost)))
		return err(400, 'age limit reached this turn')

	const nextVertices = {
		...state.vertices,
		[vertex]: {
			occupied: true as const,
			player: meIdx,
			building: 'city' as const,
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
				}
			: { kind: 'move_robber', resume: state.phase.resume }

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
	// Default: no candidates → transition straight to the resume phase
	// (post-7-roll main, or pre-roll if triggered by a knight before rolling).
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
		}
	}

	const { error: stateErr } = await admin
		.from('game_states')
		.update({ robber: hex, phase: nextPhase, players: nextPlayers })
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

	const { error: stateErr } = await admin
		.from('game_states')
		.update({ players: nextPlayers, phase: nextPhase })
		.eq('game_id', game.id)
	if (stateErr) return err(500, 'could not update state')

	const event = {
		kind: 'stolen',
		thief: meIdx,
		victim: body.victim,
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
	if (!isValidBankTradeShape(give, receive, kind))
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

	const ratio = ratioOfBank(kind)
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
	if (!canAfford(state.players[meIdx].resources, DEV_CARD_COST))
		return err(400, 'insufficient resources')
	if (!canSpendUnderAge(state.players[meIdx], costSize(DEV_CARD_COST)))
		return err(400, 'age limit reached this turn')

	const card = state.devDeck[0]
	const nextDeck = state.devDeck.slice(1)
	const devSpend = costSize(DEV_CARD_COST)
	const nextPlayers = state.players.map((p, i) => {
		if (i !== meIdx) return p
		const next: PlayerState = {
			...p,
			resources: deductHand(p.resources, DEV_CARD_COST),
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

function parseResource(v: unknown): Resource | null {
	if (typeof v !== 'string') return null
	if ((RESOURCES as readonly string[]).includes(v)) return v as Resource
	return null
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
		case 'bank_trade':
			return handleBankTrade(admin, me, body)
		case 'buy_dev_card':
			return handleBuyDevCard(admin, me, body)
		case 'play_dev_card':
			return handlePlayDevCard(admin, me, body)
		default:
			return err(400, 'unknown action')
	}
})
