import type { RealtimeChannel } from '@supabase/supabase-js'
import { create } from 'zustand'
import type { Hex, Resource } from '../catan/board'
import type { BonusId } from '../catan/bonuses'
import type { DevCardId } from '../catan/devCards'
import type { DiceRoll, GameConfig, ResourceHand } from '../catan/types'
import type { Database } from '../database-types'
import { emitGameMutated } from '../gameSync'
import { uniqueTopic } from '../realtime'
import { supabase } from '../supabase'
import type { AutoLoadedStore } from './index'
import type { Profile } from './useProfileStore'

type GameRow = Database['public']['Tables']['games']['Row']
type GameRequestRow = Database['public']['Tables']['game_requests']['Row']

const PROFILE_COLS =
	'id, username, avatar_path, created_at, updated_at, dev, game_defaults, notification_prefs'

let requestsChannel: RealtimeChannel | null = null
let gamesChannel: RealtimeChannel | null = null

export type InvitedEntry = {
	user: string
	status: 'pending' | 'accepted' | 'rejected'
}

export type GameRequest = Omit<GameRequestRow, 'invited'> & {
	invited: InvitedEntry[]
}

export type Game = GameRow

export type GameEvent =
	| { kind: 'game_complete'; winner_index: number; at: string }
	| {
			kind: 'settlement_placed'
			player: number
			vertex: string
			round: 1 | 2
			at: string
	  }
	| {
			kind: 'road_placed'
			player: number
			edge: string
			round: 1 | 2
			at: string
	  }
	| { kind: 'placement_complete'; at: string }
	| {
			kind: 'rolled'
			player: number
			dice: [number, number]
			total: number
			at: string
	  }
	| { kind: 'turn_ended'; player: number; at: string }
	// `player` is the honked (stalled) seat, `from` the sender's. `from` backs
	// the one-honk-per-sender-per-turn rule; the log line only renders `player`.
	| { kind: 'honked'; player: number; from: number; at: string }
	| { kind: 'road_built'; player: number; edge: string; at: string }
	| { kind: 'settlement_built'; player: number; vertex: string; at: string }
	| { kind: 'city_built'; player: number; vertex: string; at: string }
	| { kind: 'discarded'; player: number; count: number; at: string }
	| { kind: 'robber_moved'; player: number; hex: string; at: string }
	| { kind: 'stolen'; thief: number; victim: number; at: string }
	| {
			kind: 'trade_proposed'
			offer_id: string
			from: number
			to: number[]
			give: ResourceHand
			receive: ResourceHand
			at: string
	  }
	| {
			kind: 'trade_accepted'
			offer_id: string
			from: number
			to: number
			give: ResourceHand
			receive: ResourceHand
			at: string
	  }
	| { kind: 'trade_canceled'; offer_id: string; from: number; at: string }
	| {
			kind: 'trade_rejected'
			offer_id: string
			from: number
			by: number
			at: string
	  }
	| {
			kind: 'bank_trade'
			player: number
			give: ResourceHand
			receive: ResourceHand
			ratio: 2 | 3 | 4
			at: string
	  }
	// Dev-card events. `dev_bought` intentionally carries no card id so the
	// deck/draw stays private. `dev_played` reveals the id (and any payload
	// fields that would be publicly announced at the table) when a non-VP
	// card is actually played.
	| { kind: 'dev_bought'; player: number; at: string }
	| {
			kind: 'dev_played'
			player: number
			id: Exclude<DevCardId, 'victory_point'>
			take?: [Resource, Resource]
			resource?: Resource
			total?: number
			at: string
	  }
	| { kind: 'largest_army_changed'; player: number; at: string }
	// Longest Road flips after road builds, Road Building card finalizations,
	// and settlement builds (opponent can split a chain). `player: null`
	// announces that the current holder lost the bonus with no successor —
	// common when a settlement severs a chain below the 5-segment threshold.
	| { kind: 'longest_road_changed'; player: number | null; at: string }
	// Nomad bonus: a 7 was rolled and this nomad has buildings on the desert.
	// `count` is total production (settlement=1, city=2, super_city=3 summed
	// across desert hexes). Surfaced in UI as a roulette-reveal animation.
	| {
			kind: 'nomad_produce'
			player: number
			resource: Resource
			count: number
			at: string
	  }
	// Fortune teller bonus: the FT player rolled doubles or a 7, triggering one
	// or more bonus dice rolls that pay only them. One event per bonus roll (the
	// chain continues on doubles/7). `gain` is that roll's production and may be
	// empty when the bonus roll is a 7 or hits none of their hexes. Surfaced in
	// UI as a dice-reveal animation (empty gains show in the log only).
	| {
			kind: 'fortune_teller_roll'
			player: number
			dice: [number, number]
			total: number
			gain: ResourceHand
			at: string
	  }
	// Terminal event. Written once per game when a player reaches 10 VP.
	// `vpCards` reveals each player's previously-hidden VP card count so
	// clients can render a final scoreboard without a separate read.
	| {
			kind: 'game_complete'
			winner: number
			vpCards: Record<number, number>
			at: string
	  }

type ActionResult = { error: string | null }
type RespondResult = { error: string | null; gameId?: string }
type RollResult = ActionResult & { dice?: DiceRoll; total?: number }

type ServiceData = Record<string, unknown>

/**
 * The single entry point for every game-service call.
 *
 * Carries the edge function's own error string back to the caller — supabase-js
 * buries the body of a non-2xx response inside the thrown error, so it has to be
 * read back out — and pings `gameSync` on success so the acting player's board
 * advances without waiting on realtime.
 */
async function callGameService(
	body: ServiceData,
	fallback: string
): Promise<ActionResult & { data: ServiceData }> {
	const { data, error } = await supabase.functions.invoke('game-service', {
		body,
	})

	if (error) {
		const message = await edgeErrorMessage(error)
		return { error: message || fallback, data: {} }
	}

	const res = (data ?? {}) as ServiceData
	if (!res.ok) {
		return {
			error: (res.error as string | undefined) || fallback,
			data: res,
		}
	}

	const gameId = body.game_id
	if (typeof gameId === 'string') emitGameMutated(gameId)
	return { error: null, data: res }
}

// A FunctionsHttpError carries the raw Response on `context`; its own `message`
// is the same boilerplate for every failure ("non-2xx status code"), so the
// body's `error` is the only thing that says what actually went wrong. Network
// failures have no body — there `message` is all we have, and it's the truth.
async function edgeErrorMessage(error: unknown): Promise<string | null> {
	const context = (error as { context?: unknown }).context
	if (context && typeof (context as Response).json === 'function') {
		try {
			const body = await (context as Response).json()
			const message = (body as { error?: unknown })?.error
			if (typeof message === 'string' && message) return message
		} catch {
			// Not a JSON body — fall through to the error's own message.
		}
	}
	return (error as Error).message || null
}

type GamesStore = {
	pendingRequests: GameRequest[] | undefined
	activeGames: Game[] | undefined
	completeGames: Game[] | undefined
	profilesById: Record<string, Profile>
	loading: boolean

	loadForUser: (userId: string) => Promise<void>
	clear: () => void

	createRequest: (
		meId: string,
		invitedIds: string[],
		config: GameConfig
	) => Promise<ActionResult>
	respond: (
		meId: string,
		requestId: string,
		accept: boolean
	) => Promise<RespondResult>
	cancelRequest: (meId: string, requestId: string) => Promise<ActionResult>

	pickBonus: (gameId: string, bonus: BonusId) => Promise<ActionResult>
	setSpecialistResource: (
		gameId: string,
		resource: Resource
	) => Promise<ActionResult>
	buyCarpenterVP: (gameId: string) => Promise<ActionResult>
	tapKnight: (
		gameId: string,
		r1: Resource,
		r2: Resource
	) => Promise<ActionResult>

	placeSettlement: (gameId: string, vertex: string) => Promise<ActionResult>
	placeRoad: (gameId: string, edge: string) => Promise<ActionResult>

	roll: (gameId: string) => Promise<RollResult>
	confirmRoll: (gameId: string) => Promise<RollResult>
	rerollDice: (gameId: string) => Promise<RollResult>
	endTurn: (gameId: string) => Promise<ActionResult>
	honk: (gameId: string) => Promise<ActionResult>
	sendMessage: (gameId: string, body: string) => Promise<ActionResult>
	// Finish your slot in a special build phase (5-6 player games). Pops you
	// off the build queue; advances to the next builder or the next roll.
	endSpecialBuild: (gameId: string) => Promise<ActionResult>

	// `useBricklayer`: pay 4 Brick instead of the standard cost. Ignored by
	// the edge if the caller doesn't have the bricklayer bonus.
	// `smithSwap`: units of the cost's brick/ore component to pay in the other
	// resource (smith bonus). `fencePay`: when building on the fencer's own
	// reserved edge, pay 1 of this resource instead of 1 wood + 1 brick.
	buildRoad: (
		gameId: string,
		edge: string,
		opts?: {
			useBricklayer?: boolean
			smithSwap?: number
			fencePay?: 'wood' | 'brick'
		}
	) => Promise<ActionResult>
	buildSettlement: (
		gameId: string,
		vertex: string,
		opts?: { useBricklayer?: boolean; smithSwap?: number }
	) => Promise<ActionResult>
	buildCity: (
		gameId: string,
		vertex: string,
		opts?: {
			useBricklayer?: boolean
			swapDelta?: number
			smithSwap?: number
		}
	) => Promise<ActionResult>

	discard: (gameId: string, discard: ResourceHand) => Promise<ActionResult>
	moveRobber: (gameId: string, hex: string) => Promise<ActionResult>
	steal: (gameId: string, victim: number) => Promise<ActionResult>

	proposeTrade: (
		gameId: string,
		give: ResourceHand,
		receive: ResourceHand,
		to: number[]
	) => Promise<ActionResult & { offerId?: string }>
	acceptTrade: (gameId: string, offerId: string) => Promise<ActionResult>
	cancelTrade: (gameId: string, offerId: string) => Promise<ActionResult>
	rejectTrade: (gameId: string, offerId: string) => Promise<ActionResult>
	// `merchant`: pay `count` extra of the single give resource for `count`
	// resources of choice (merchant bonus). Ignored by the edge for non-
	// merchant players.
	bankTrade: (
		gameId: string,
		give: ResourceHand,
		receive: ResourceHand,
		merchant?: { resource: Resource; count: number; take: ResourceHand }
	) => Promise<ActionResult & { ratio?: 2 | 3 | 4 }>

	buyDevCard: (
		gameId: string,
		useBricklayer?: boolean,
		scoutSwap?: { from: Resource; to: Resource },
		smithSwap?: number
	) => Promise<ActionResult>
	playDevCard: (
		gameId: string,
		id: DevCardId,
		payload?: { r1?: Resource; r2?: Resource; resource?: Resource }
	) => Promise<ActionResult>

	// --- Set-2 bonus actions -------------------------------------------------

	// Metropolitan: build a city or super_city. `swapDelta` is the number of
	// wheat (0..2) to replace with extra ore in the cost; ignored for non-
	// metropolitan players. `useBricklayer` is mutually exclusive with the
	// swap (bricklayer doesn't apply to a metropolitan-discounted cost).
	buildSuperCity: (
		gameId: string,
		vertex: string,
		swapDelta?: number
	) => Promise<ActionResult>

	// Accountant: trade a piece back into resources.
	liquidate: (
		gameId: string,
		target:
			| { kind: 'road'; edge: string }
			| { kind: 'settlement'; vertex: string }
			| { kind: 'city'; vertex: string }
			| { kind: 'super_city'; vertex: string }
			| { kind: 'dev_card'; index: number }
	) => Promise<ActionResult>

	// Explorer: place one of the 3 free post-placement roads.
	placeExplorerRoad: (gameId: string, edge: string) => Promise<ActionResult>

	// Ritualist: choose a dice total (2..6, 8..12) by discarding cards.
	ritualRoll: (
		gameId: string,
		discard: ResourceHand,
		total: number
	) => Promise<ActionResult>

	// Shepherd: trade 2 sheep for 2 chosen resources at start of turn.
	shepherdSwap: (
		gameId: string,
		take: [Resource, Resource]
	) => Promise<ActionResult>

	// Curio collector: claim 3 chosen resources after a 2 or 12.
	claimCurio: (
		gameId: string,
		take: [Resource, Resource, Resource]
	) => Promise<ActionResult>

	// Forger: move the token to a vertex-adjacent hex, before rolling.
	moveForgerToken: (gameId: string, hex: Hex) => Promise<ActionResult>

	// Forger: pick which other player to copy from after the token's hex
	// produces.
	pickForgerTarget: (gameId: string, target: number) => Promise<ActionResult>

	// Scout: confirm which of the 3 peeked dev cards to keep.
	confirmScoutCard: (gameId: string, index: number) => Promise<ActionResult>

	// --- Set-3 bonus actions -------------------------------------------------

	// Fencer: place one of the 2 post-placement reserved-edge tokens.
	placeFenceToken: (gameId: string, edge: string) => Promise<ActionResult>

	// Haunt: secretly commit the two ghost-spawn locations at post-placement.
	setHauntSpots: (
		gameId: string,
		spots: [string, string]
	) => Promise<ActionResult>

	// Investor: set aside 3 of a resource for an investment token.
	invest: (gameId: string, resource: Resource) => Promise<ActionResult>

	// Magician: after your own roll, discard N+1 cards to also produce as if
	// `target` had rolled; or skip the window.
	castMagic: (
		gameId: string,
		target: number,
		discard: ResourceHand
	) => Promise<ActionResult>
	skipMagic: (gameId: string) => Promise<ActionResult>
}

function decodeInvited(raw: unknown): InvitedEntry[] {
	if (!Array.isArray(raw)) return []
	const out: InvitedEntry[] = []
	for (const el of raw) {
		if (
			el &&
			typeof el === 'object' &&
			typeof (el as { user?: unknown }).user === 'string' &&
			typeof (el as { status?: unknown }).status === 'string'
		) {
			const status = (el as { status: string }).status
			if (
				status === 'pending' ||
				status === 'accepted' ||
				status === 'rejected'
			) {
				out.push({
					user: (el as { user: string }).user,
					status,
				})
			}
		}
	}
	return out
}

export const useGamesStore = create<GamesStore>((set, get) => ({
	pendingRequests: undefined,
	activeGames: undefined,
	completeGames: undefined,
	profilesById: {},
	loading: false,

	async loadForUser(userId) {
		set({ loading: true })

		const requestsPromise = supabase
			.from('game_requests')
			.select('*')
			.order('created_at', { ascending: false })

		const activePromise = supabase
			.from('games')
			.select('*')
			.in('status', ['placement', 'active'])
			.order('created_at', { ascending: false })

		const completePromise = supabase
			.from('games')
			.select('*')
			.eq('status', 'complete')
			.order('created_at', { ascending: false })

		const [requestsRes, activeRes, completeRes] = await Promise.all([
			requestsPromise,
			activePromise,
			completePromise,
		])

		const pendingRequests: GameRequest[] = []
		if (requestsRes.data) {
			for (const row of requestsRes.data) {
				pendingRequests.push({
					...row,
					invited: decodeInvited(row.invited),
				})
			}
		}

		const activeGames: Game[] = activeRes.data ?? []
		const completeGames: Game[] = completeRes.data ?? []

		const ids = new Set<string>()
		for (const r of pendingRequests) {
			ids.add(r.proposer)
			for (const inv of r.invited) ids.add(inv.user)
		}
		for (const g of activeGames) for (const p of g.participants) ids.add(p)
		for (const g of completeGames)
			for (const p of g.participants) ids.add(p)
		ids.add(userId)

		const profilesById: Record<string, Profile> = {}
		if (ids.size > 0) {
			const { data: profiles } = await supabase
				.from('profiles')
				.select(PROFILE_COLS)
				.in('id', Array.from(ids))
			if (profiles) {
				for (const p of profiles) profilesById[p.id] = p
			}
		}

		set({
			pendingRequests,
			activeGames,
			completeGames,
			profilesById,
			loading: false,
		})

		// Subscribe to game_requests and games changes for live updates.
		if (requestsChannel) supabase.removeChannel(requestsChannel)
		requestsChannel = supabase
			.channel(uniqueTopic('game_requests_rtu'))
			.on(
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'game_requests' },
				(payload) => handleRequestChange(payload, get, set)
			)
			.subscribe()

		if (gamesChannel) supabase.removeChannel(gamesChannel)
		gamesChannel = supabase
			.channel(uniqueTopic('games_rtu'))
			.on(
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'games' },
				(payload) => handleGameChange(payload, get, set)
			)
			.subscribe()
	},

	clear() {
		if (requestsChannel) {
			supabase.removeChannel(requestsChannel)
			requestsChannel = null
		}
		if (gamesChannel) {
			supabase.removeChannel(gamesChannel)
			gamesChannel = null
		}
		set({
			pendingRequests: undefined,
			activeGames: undefined,
			completeGames: undefined,
			profilesById: {},
			loading: false,
		})
	},

	async createRequest(_meId, invitedIds, config) {
		return callGameService(
			{
				action: 'propose_game',
				invited_user_ids: invitedIds,
				config,
			},
			"Couldn't create game"
		)
	},

	async pickBonus(gameId, bonus) {
		return callGameService(
			{ action: 'pick_bonus', game_id: gameId, bonus },
			"Couldn't pick bonus"
		)
	},

	async setSpecialistResource(gameId, resource) {
		return callGameService(
			{
				action: 'set_specialist_resource',
				game_id: gameId,
				resource,
			},
			"Couldn't set specialty"
		)
	},

	async buyCarpenterVP(gameId) {
		return callGameService(
			{ action: 'buy_carpenter_vp', game_id: gameId },
			"Couldn't buy VP"
		)
	},

	async tapKnight(gameId, r1, r2) {
		return callGameService(
			{ action: 'tap_knight', game_id: gameId, r1, r2 },
			"Couldn't tap knight"
		)
	},

	async respond(meId, requestId, accept) {
		const { error, data } = await callGameService(
			{ action: 'respond', request_id: requestId, accept },
			"Couldn't respond"
		)
		if (error) return { error }
		await get().loadForUser(meId)
		return { error: null, gameId: data.game_id as string | undefined }
	},

	async cancelRequest(meId, requestId) {
		const { error } = await callGameService(
			{ action: 'cancel_request', request_id: requestId },
			"Couldn't cancel game"
		)
		if (error) return { error }
		await get().loadForUser(meId)
		return { error: null }
	},

	async placeSettlement(gameId, vertex) {
		return callGameService(
			{ action: 'place_settlement', game_id: gameId, vertex },
			"Couldn't place settlement"
		)
	},

	async placeRoad(gameId, edge) {
		return callGameService(
			{ action: 'place_road', game_id: gameId, edge },
			"Couldn't place road"
		)
	},

	async roll(gameId) {
		const { error, data } = await callGameService(
			{ action: 'roll', game_id: gameId },
			"Couldn't roll"
		)
		if (error) return { error }
		return {
			error: null,
			dice: data.dice as DiceRoll,
			total: data.total as number,
		}
	},

	async confirmRoll(gameId) {
		const { error, data } = await callGameService(
			{ action: 'confirm_roll', game_id: gameId },
			"Couldn't confirm roll"
		)
		if (error) return { error }
		return {
			error: null,
			dice: data.dice as DiceRoll,
			total: data.total as number,
		}
	},

	async rerollDice(gameId) {
		const { error, data } = await callGameService(
			{ action: 'reroll_dice', game_id: gameId },
			"Couldn't reroll"
		)
		if (error) return { error }
		return {
			error: null,
			dice: data.dice as DiceRoll,
			total: data.total as number,
		}
	},

	async endTurn(gameId) {
		return callGameService(
			{ action: 'end_turn', game_id: gameId },
			"Couldn't end turn"
		)
	},

	async honk(gameId) {
		return callGameService(
			{ action: 'honk', game_id: gameId },
			"Couldn't honk"
		)
	},

	async sendMessage(gameId, body) {
		return callGameService(
			{ action: 'send_message', game_id: gameId, body },
			"Couldn't send message"
		)
	},

	async endSpecialBuild(gameId) {
		return callGameService(
			{ action: 'end_special_build', game_id: gameId },
			"Couldn't finish building"
		)
	},

	async buildRoad(gameId, edge, opts) {
		return callGameService(
			{
				action: 'build_road',
				game_id: gameId,
				edge,
				use_bricklayer: !!opts?.useBricklayer,
				smith_swap: opts?.smithSwap ?? 0,
				fence_pay: opts?.fencePay ?? null,
			},
			"Couldn't build road"
		)
	},

	async buildSettlement(gameId, vertex, opts) {
		return callGameService(
			{
				action: 'build_settlement',
				game_id: gameId,
				vertex,
				use_bricklayer: !!opts?.useBricklayer,
				smith_swap: opts?.smithSwap ?? 0,
			},
			"Couldn't build settlement"
		)
	},

	async buildCity(gameId, vertex, opts) {
		return callGameService(
			{
				action: 'build_city',
				game_id: gameId,
				vertex,
				use_bricklayer: !!opts?.useBricklayer,
				swap_wheat_to_ore: opts?.swapDelta ?? 0,
				smith_swap: opts?.smithSwap ?? 0,
			},
			"Couldn't build city"
		)
	},

	async discard(gameId, discard) {
		return callGameService(
			{ action: 'discard', game_id: gameId, discard },
			"Couldn't discard"
		)
	},

	async moveRobber(gameId, hex) {
		return callGameService(
			{ action: 'move_robber', game_id: gameId, hex },
			"Couldn't move robber"
		)
	},

	async steal(gameId, victim) {
		return callGameService(
			{ action: 'steal', game_id: gameId, victim },
			"Couldn't steal"
		)
	},

	async proposeTrade(gameId, give, receive, to) {
		const { error, data } = await callGameService(
			{
				action: 'propose_trade',
				game_id: gameId,
				give,
				receive,
				to,
			},
			"Couldn't propose trade"
		)
		if (error) return { error }
		return { error: null, offerId: data.offer_id as string | undefined }
	},

	async acceptTrade(gameId, offerId) {
		return callGameService(
			{ action: 'accept_trade', game_id: gameId, offer_id: offerId },
			"Couldn't accept trade"
		)
	},

	async cancelTrade(gameId, offerId) {
		return callGameService(
			{ action: 'cancel_trade', game_id: gameId, offer_id: offerId },
			"Couldn't cancel trade"
		)
	},

	async rejectTrade(gameId, offerId) {
		return callGameService(
			{ action: 'reject_trade', game_id: gameId, offer_id: offerId },
			"Couldn't reject trade"
		)
	},

	async bankTrade(gameId, give, receive, merchant) {
		const { error, data } = await callGameService(
			{
				action: 'bank_trade',
				game_id: gameId,
				give,
				receive,
				merchant: merchant ?? null,
			},
			"Couldn't trade with bank"
		)
		if (error) return { error }
		return { error: null, ratio: data.ratio as 2 | 3 | 4 | undefined }
	},

	async buyDevCard(gameId, useBricklayer, scoutSwap, smithSwap) {
		return callGameService(
			{
				action: 'buy_dev_card',
				game_id: gameId,
				use_bricklayer: !!useBricklayer,
				scout_swap: scoutSwap ?? null,
				smith_swap: smithSwap ?? 0,
			},
			"Couldn't buy dev card"
		)
	},

	async playDevCard(gameId, id, payload) {
		return callGameService(
			{
				action: 'play_dev_card',
				game_id: gameId,
				id,
				payload: payload ?? null,
			},
			"Couldn't play dev card"
		)
	},

	async buildSuperCity(gameId, vertex, swapDelta) {
		return callGameService(
			{
				action: 'build_super_city',
				game_id: gameId,
				vertex,
				swap_wheat_to_ore: swapDelta ?? 0,
			},
			"Couldn't upgrade to super city"
		)
	},

	async liquidate(gameId, target) {
		return callGameService(
			{ action: 'liquidate', game_id: gameId, target },
			"Couldn't liquidate"
		)
	},

	async placeExplorerRoad(gameId, edge) {
		return callGameService(
			{ action: 'place_explorer_road', game_id: gameId, edge },
			"Couldn't place explorer road"
		)
	},

	async ritualRoll(gameId, discard, total) {
		return callGameService(
			{ action: 'ritual_roll', game_id: gameId, discard, total },
			"Couldn't ritual roll"
		)
	},

	async shepherdSwap(gameId, take) {
		return callGameService(
			{ action: 'shepherd_swap', game_id: gameId, take },
			"Couldn't swap sheep"
		)
	},

	async claimCurio(gameId, take) {
		return callGameService(
			{ action: 'claim_curio', game_id: gameId, take },
			"Couldn't claim curio"
		)
	},

	async moveForgerToken(gameId, hex) {
		return callGameService(
			{ action: 'move_forger_token', game_id: gameId, hex },
			"Couldn't move forger token"
		)
	},

	async pickForgerTarget(gameId, target) {
		return callGameService(
			{ action: 'pick_forger_target', game_id: gameId, target },
			"Couldn't pick forger target"
		)
	},

	async confirmScoutCard(gameId, index) {
		return callGameService(
			{ action: 'confirm_scout_card', game_id: gameId, index },
			"Couldn't confirm scout card"
		)
	},

	async placeFenceToken(gameId, edge) {
		return callGameService(
			{ action: 'place_fence_token', game_id: gameId, edge },
			"Couldn't place fence token"
		)
	},

	async setHauntSpots(gameId, spots) {
		return callGameService(
			{ action: 'set_haunt_spots', game_id: gameId, spots },
			"Couldn't set haunt spots"
		)
	},

	async invest(gameId, resource) {
		return callGameService(
			{ action: 'invest', game_id: gameId, resource },
			"Couldn't invest"
		)
	},

	async castMagic(gameId, target, discard) {
		return callGameService(
			{ action: 'cast_magic', game_id: gameId, target, discard },
			"Couldn't cast magic"
		)
	},

	async skipMagic(gameId) {
		return callGameService(
			{ action: 'skip_magic', game_id: gameId },
			"Couldn't skip magic"
		)
	},
}))

function handleGameChange(
	payload: {
		eventType: string
		new: Record<string, unknown>
		old: Record<string, unknown>
	},
	get: () => GamesStore,
	set: (partial: Partial<GamesStore>) => void
) {
	const active = get().activeGames
	const complete = get().completeGames
	if (!active || !complete) return

	if (payload.eventType === 'DELETE') {
		const oldId = (payload.old as { id?: string }).id
		if (!oldId) return
		set({
			activeGames: active.filter((g) => g.id !== oldId),
			completeGames: complete.filter((g) => g.id !== oldId),
		})
		return
	}

	const game = payload.new as Game

	if (payload.eventType === 'INSERT') {
		if (game.status === 'complete') {
			set({ completeGames: [game, ...complete] })
		} else {
			set({ activeGames: [game, ...active] })
		}
		return
	}

	// UPDATE — game may have moved from active to complete.
	if (payload.eventType === 'UPDATE') {
		if (game.status === 'complete') {
			set({
				activeGames: active.filter((g) => g.id !== game.id),
				completeGames: [
					game,
					...complete.filter((g) => g.id !== game.id),
				],
			})
		} else {
			set({
				activeGames: active.map((g) => (g.id === game.id ? game : g)),
			})
		}
	}
}

async function handleRequestChange(
	payload: {
		eventType: string
		new: Record<string, unknown>
		old: Record<string, unknown>
	},
	get: () => GamesStore,
	set: (partial: Partial<GamesStore>) => void
) {
	const current = get().pendingRequests
	if (!current) return

	if (payload.eventType === 'DELETE') {
		const oldId = (payload.old as { id?: string }).id
		if (!oldId) return
		set({ pendingRequests: current.filter((r) => r.id !== oldId) })
		return
	}

	const raw = payload.new as GameRequestRow
	const decoded: GameRequest = {
		...raw,
		invited: decodeInvited(raw.invited),
	}

	if (payload.eventType === 'UPDATE') {
		set({
			pendingRequests: current.map((r) =>
				r.id === decoded.id ? decoded : r
			),
		})
		return
	}

	if (payload.eventType === 'INSERT') {
		// Fetch profiles for any user IDs we don't already have.
		const known = get().profilesById
		const missing: string[] = []
		if (!known[decoded.proposer]) missing.push(decoded.proposer)
		for (const inv of decoded.invited) {
			if (!known[inv.user]) missing.push(inv.user)
		}
		if (missing.length > 0) {
			const { data: profiles } = await supabase
				.from('profiles')
				.select(PROFILE_COLS)
				.in('id', missing)
			if (profiles) {
				const next = { ...get().profilesById }
				for (const p of profiles) next[p.id] = p
				set({ profilesById: next })
			}
		}
		set({ pendingRequests: [decoded, ...(get().pendingRequests ?? [])] })
	}
}

export function describePendingRequest(
	request: GameRequest,
	meId: string | undefined,
	profilesById: Record<string, Profile>
): {
	label: string
	proposerProfile: Profile | undefined
	mineIsProposer: boolean
} {
	const mineIsProposer = !!meId && request.proposer === meId
	const proposerProfile = profilesById[request.proposer]

	if (mineIsProposer) {
		const names = request.invited
			.map((i) => profilesById[i.user]?.username ?? '…')
			.join(', ')
		return {
			label: names.length > 0 ? `Invite to ${names}` : 'Invite sent',
			proposerProfile,
			mineIsProposer,
		}
	}

	const label = proposerProfile
		? `${proposerProfile.username} invited you`
		: 'Game invite'
	return { label, proposerProfile, mineIsProposer }
}

export const gamesStoreRegistration: AutoLoadedStore = {
	name: 'games',
	loadForUser: (userId) => useGamesStore.getState().loadForUser(userId),
	clear: () => useGamesStore.getState().clear(),
}
