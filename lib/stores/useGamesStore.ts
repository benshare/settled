import type { RealtimeChannel } from '@supabase/supabase-js'
import { create } from 'zustand'
import type { Hex, Resource } from '../catan/board'
import type { BonusId } from '../catan/bonuses'
import type { DevCardId } from '../catan/devCards'
import type { DiceRoll, GameConfig, ResourceHand } from '../catan/types'
import type { Database } from '../database-types'
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

	// `useBricklayer`: pay 4 Brick instead of the standard cost. Ignored by
	// the edge if the caller doesn't have the bricklayer bonus.
	buildRoad: (
		gameId: string,
		edge: string,
		useBricklayer?: boolean
	) => Promise<ActionResult>
	buildSettlement: (
		gameId: string,
		vertex: string,
		useBricklayer?: boolean
	) => Promise<ActionResult>
	buildCity: (
		gameId: string,
		vertex: string,
		useBricklayer?: boolean,
		swapDelta?: number
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
	bankTrade: (
		gameId: string,
		give: ResourceHand,
		receive: ResourceHand
	) => Promise<ActionResult & { ratio?: 2 | 3 | 4 }>

	buyDevCard: (
		gameId: string,
		useBricklayer?: boolean,
		scoutSwap?: { from: Resource; to: Resource }
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
			.channel('game_requests_rtu')
			.on(
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'game_requests' },
				(payload) => handleRequestChange(payload, get, set)
			)
			.subscribe()

		if (gamesChannel) supabase.removeChannel(gamesChannel)
		gamesChannel = supabase
			.channel('games_rtu')
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
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'propose_game',
					invited_user_ids: invitedIds,
					config,
				},
			}
		)
		if (error || !data?.ok) {
			return {
				error:
					(data?.error as string | undefined) ||
					error?.message ||
					"Couldn't create game",
			}
		}
		return { error: null }
	},

	async pickBonus(gameId, bonus) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: { action: 'pick_bonus', game_id: gameId, bonus },
			}
		)
		if (error || !data?.ok) return { error: "Couldn't pick bonus" }
		return { error: null }
	},

	async setSpecialistResource(gameId, resource) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'set_specialist_resource',
					game_id: gameId,
					resource,
				},
			}
		)
		if (error || !data?.ok) return { error: "Couldn't set specialty" }
		return { error: null }
	},

	async buyCarpenterVP(gameId) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: { action: 'buy_carpenter_vp', game_id: gameId },
			}
		)
		if (error || !data?.ok) return { error: "Couldn't buy VP" }
		return { error: null }
	},

	async tapKnight(gameId, r1, r2) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'tap_knight',
					game_id: gameId,
					r1,
					r2,
				},
			}
		)
		if (error || !data?.ok) return { error: "Couldn't tap knight" }
		return { error: null }
	},

	async respond(meId, requestId, accept) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: { action: 'respond', request_id: requestId, accept },
			}
		)
		if (error || !data?.ok) {
			return { error: "Couldn't respond" }
		}
		await get().loadForUser(meId)
		return { error: null, gameId: data.game_id }
	},

	async placeSettlement(gameId, vertex) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: { action: 'place_settlement', game_id: gameId, vertex },
			}
		)
		if (error || !data?.ok) return { error: "Couldn't place settlement" }
		return { error: null }
	},

	async placeRoad(gameId, edge) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: { action: 'place_road', game_id: gameId, edge },
			}
		)
		if (error || !data?.ok) return { error: "Couldn't place road" }
		return { error: null }
	},

	async roll(gameId) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: { action: 'roll', game_id: gameId },
			}
		)
		if (error || !data?.ok) return { error: "Couldn't roll" }
		return { error: null, dice: data.dice, total: data.total }
	},

	async confirmRoll(gameId) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: { action: 'confirm_roll', game_id: gameId },
			}
		)
		if (error || !data?.ok) return { error: "Couldn't confirm roll" }
		return { error: null, dice: data.dice, total: data.total }
	},

	async rerollDice(gameId) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: { action: 'reroll_dice', game_id: gameId },
			}
		)
		if (error || !data?.ok) return { error: "Couldn't reroll" }
		return { error: null, dice: data.dice, total: data.total }
	},

	async endTurn(gameId) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: { action: 'end_turn', game_id: gameId },
			}
		)
		if (error || !data?.ok) return { error: "Couldn't end turn" }
		return { error: null }
	},

	async buildRoad(gameId, edge, useBricklayer) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'build_road',
					game_id: gameId,
					edge,
					use_bricklayer: !!useBricklayer,
				},
			}
		)
		if (error || !data?.ok) return { error: "Couldn't build road" }
		return { error: null }
	},

	async buildSettlement(gameId, vertex, useBricklayer) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'build_settlement',
					game_id: gameId,
					vertex,
					use_bricklayer: !!useBricklayer,
				},
			}
		)
		if (error || !data?.ok) return { error: "Couldn't build settlement" }
		return { error: null }
	},

	async buildCity(gameId, vertex, useBricklayer, swapDelta) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'build_city',
					game_id: gameId,
					vertex,
					use_bricklayer: !!useBricklayer,
					swap_wheat_to_ore: swapDelta ?? 0,
				},
			}
		)
		if (error || !data?.ok) return { error: "Couldn't build city" }
		return { error: null }
	},

	async discard(gameId, discard) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: { action: 'discard', game_id: gameId, discard },
			}
		)
		if (error || !data?.ok) return { error: "Couldn't discard" }
		return { error: null }
	},

	async moveRobber(gameId, hex) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: { action: 'move_robber', game_id: gameId, hex },
			}
		)
		if (error || !data?.ok) return { error: "Couldn't move robber" }
		return { error: null }
	},

	async steal(gameId, victim) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: { action: 'steal', game_id: gameId, victim },
			}
		)
		if (error || !data?.ok) return { error: "Couldn't steal" }
		return { error: null }
	},

	async proposeTrade(gameId, give, receive, to) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'propose_trade',
					game_id: gameId,
					give,
					receive,
					to,
				},
			}
		)
		if (error || !data?.ok) return { error: "Couldn't propose trade" }
		return { error: null, offerId: data.offer_id }
	},

	async acceptTrade(gameId, offerId) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'accept_trade',
					game_id: gameId,
					offer_id: offerId,
				},
			}
		)
		if (error || !data?.ok) return { error: "Couldn't accept trade" }
		return { error: null }
	},

	async cancelTrade(gameId, offerId) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'cancel_trade',
					game_id: gameId,
					offer_id: offerId,
				},
			}
		)
		if (error || !data?.ok) return { error: "Couldn't cancel trade" }
		return { error: null }
	},

	async rejectTrade(gameId, offerId) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'reject_trade',
					game_id: gameId,
					offer_id: offerId,
				},
			}
		)
		if (error || !data?.ok) return { error: "Couldn't reject trade" }
		return { error: null }
	},

	async bankTrade(gameId, give, receive) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'bank_trade',
					game_id: gameId,
					give,
					receive,
				},
			}
		)
		if (error || !data?.ok) return { error: "Couldn't trade with bank" }
		return { error: null, ratio: data.ratio }
	},

	async buyDevCard(gameId, useBricklayer, scoutSwap) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'buy_dev_card',
					game_id: gameId,
					use_bricklayer: !!useBricklayer,
					scout_swap: scoutSwap ?? null,
				},
			}
		)
		if (error || !data?.ok) return { error: "Couldn't buy dev card" }
		return { error: null }
	},

	async playDevCard(gameId, id, payload) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'play_dev_card',
					game_id: gameId,
					id,
					payload: payload ?? null,
				},
			}
		)
		if (error || !data?.ok) return { error: "Couldn't play dev card" }
		return { error: null }
	},

	async buildSuperCity(gameId, vertex, swapDelta) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'build_super_city',
					game_id: gameId,
					vertex,
					swap_wheat_to_ore: swapDelta ?? 0,
				},
			}
		)
		if (error || !data?.ok)
			return { error: "Couldn't upgrade to super city" }
		return { error: null }
	},

	async liquidate(gameId, target) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'liquidate',
					game_id: gameId,
					target,
				},
			}
		)
		if (error || !data?.ok) return { error: "Couldn't liquidate" }
		return { error: null }
	},

	async placeExplorerRoad(gameId, edge) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'place_explorer_road',
					game_id: gameId,
					edge,
				},
			}
		)
		if (error || !data?.ok) return { error: "Couldn't place explorer road" }
		return { error: null }
	},

	async ritualRoll(gameId, discard, total) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'ritual_roll',
					game_id: gameId,
					discard,
					total,
				},
			}
		)
		if (error || !data?.ok) return { error: "Couldn't ritual roll" }
		return { error: null }
	},

	async shepherdSwap(gameId, take) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'shepherd_swap',
					game_id: gameId,
					take,
				},
			}
		)
		if (error || !data?.ok) return { error: "Couldn't swap sheep" }
		return { error: null }
	},

	async claimCurio(gameId, take) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'claim_curio',
					game_id: gameId,
					take,
				},
			}
		)
		if (error || !data?.ok) return { error: "Couldn't claim curio" }
		return { error: null }
	},

	async moveForgerToken(gameId, hex) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'move_forger_token',
					game_id: gameId,
					hex,
				},
			}
		)
		if (error || !data?.ok) return { error: "Couldn't move forger token" }
		return { error: null }
	},

	async pickForgerTarget(gameId, target) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'pick_forger_target',
					game_id: gameId,
					target,
				},
			}
		)
		if (error || !data?.ok) return { error: "Couldn't pick forger target" }
		return { error: null }
	},

	async confirmScoutCard(gameId, index) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'confirm_scout_card',
					game_id: gameId,
					index,
				},
			}
		)
		if (error || !data?.ok) return { error: "Couldn't confirm scout card" }
		return { error: null }
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
