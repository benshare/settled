// Pure state transitions for every action the client holds in its local queue.
// One reducer per member of `UNDOABLE_ACTIONS`, plus the shared tail they all
// end in. No I/O — these are folded twice over the same inputs:
//
//   client: projectQueue(serverRow, me, queue) → what every surface renders
//   server: handleBatch folds the same list and writes the result once
//
// That double use is the whole point, and it is why these live here rather than
// inside the edge handlers: two implementations of "what a road costs" would
// mean a player builds four things and the flush rejects. The edge function
// mirrors this file verbatim (see lib/catan/CLAUDE.md), and each single-action
// handler now calls its reducer rather than open-coding the transition.
//
// Each reducer owns its own phase, turn and validity gates, because all three
// are pure functions of the state it is handed. Callers supply only what the
// state can't answer: who is acting, and whether the game is still active.
//
// See `.claude/specs/local-action-queue.md`.

import { boardFor, RESOURCES } from './board'
import {
	applyCost,
	canAfford,
	costSize,
	deductHand,
	isValidBuildCityVertex,
	isValidBuildFenceEdge,
	isValidBuildRoadEdge,
	isValidBuildSettlementVertex,
	resolvePurchaseCost,
	BUILD_COSTS,
} from './build'
import {
	canBuildMoreSuperCities,
	canInvest,
	CARPENTER_COST,
	CITY_REFUND,
	FENCE_COST,
	FENCE_UPGRADE_COST,
	INVEST_TRIO,
	isOwnFence,
	isValidMagicTarget,
	magicDiscardCount,
	metropolitanCityCost,
	metropolitanWheatSwapDelta,
	resolveHauntGhosts,
	ROAD_REFUND,
	roadLiquidationBlocked,
	SETTLEMENT_REFUND,
	SUPER_CITY_REFUND,
} from './bonus'
import { canPlaceUnderPower, canSpendUnderAge } from './curses'
import { findWinner, hasLegalRoadPlacement, vpCardCountsByPlayer } from './dev'
import { recomputeLongestRoad } from './longestRoad'
import {
	applyBankTradeToPlayer,
	bankPartitionFor,
	uniformRatioOf,
} from './ports'
import { distributeResources, isSpecialBuildActor } from './roll'
import { handSize } from './robber'
import { emptyHand } from './trade'
import { totalVP } from './dev'
import {
	gameSizeFor,
	vertexStateOf,
	type GameState,
	type LocalAction,
	type Phase,
	type PlayerState,
	type ResourceHand,
} from './types'

// Events are `unknown[]` rather than a typed union for the same reason the edge
// function types them that way: this layer writes them, `ActionLog` reads them,
// and the shape contract between the two lives in `useGamesStore`'s `GameEvent`.
export type ApplyOk = { state: GameState; events: unknown[] }
export type ApplyResult = ApplyOk | { error: string }

export function isApplyError(r: ApplyResult): r is { error: string } {
	return 'error' in r
}

// `at` is a parameter rather than a `new Date()` inside, so a reducer is a pure
// function of its inputs and the check script can assert exact output. The
// client passes anything it likes — it folds for the state and drops the
// events; only the server's copy is ever persisted.
export function applyLocalAction(
	state: GameState,
	meIdx: number,
	action: LocalAction,
	at: string
): ApplyResult {
	switch (action.action) {
		case 'build_road':
			return applyBuildRoad(state, meIdx, action, at)
		case 'build_settlement':
			return applyBuildSettlement(state, meIdx, action, at)
		case 'build_city':
			return applyBuildCity(state, meIdx, action, at)
		case 'build_super_city':
			return applyBuildSuperCity(state, meIdx, action, at)
		case 'build_fence':
			return applyBuildFence(state, meIdx, action, at)
		case 'bank_trade':
			return applyBankTrade(state, meIdx, action, at)
		case 'liquidate':
			return applyLiquidate(state, meIdx, action, at)
		case 'invest':
			return applyInvest(state, meIdx, action, at)
		case 'buy_carpenter_vp':
			return applyBuyCarpenterVP(state, meIdx, at)
		case 'tap_knight':
			return applyTapKnight(state, meIdx, action, at)
		case 'place_explorer_road':
			return applyPlaceExplorerRoad(state, meIdx, action, at)
		case 'cast_magic':
			return applyCastMagic(state, meIdx, action, at)
		case 'skip_magic':
			return applySkipMagic(state, meIdx, at)
	}
}

// Fold a whole queue. Stops at the first action that doesn't apply and reports
// its index, which is what lets the client truncate a rebased queue exactly
// where it went bad instead of dropping the lot.
export function applyLocalActions(
	state: GameState,
	meIdx: number,
	actions: readonly LocalAction[],
	at: string
): { state: GameState; events: unknown[] } | { error: string; index: number } {
	let working = state
	const events: unknown[] = []
	for (let i = 0; i < actions.length; i++) {
		const res = applyLocalAction(working, meIdx, actions[i], at)
		if (isApplyError(res)) return { error: res.error, index: i }
		working = res.state
		events.push(...res.events)
	}
	return { state: working, events }
}

// The client's fold. Unlike `applyLocalActions` this never fails: it applies as
// much of the queue as still holds and reports where it stopped, because the
// server row moves under a pending queue (an opponent acting in the parallel
// `post_placement` phase, a realtime resync) and the queue has to rebase onto
// it rather than being thrown away. `valid` is where the caller truncates.
//
// Events are dropped here — only the server's copy is ever persisted.
export function projectQueue(
	state: GameState,
	meIdx: number,
	queue: readonly LocalAction[]
): { state: GameState; valid: number } {
	let working = state
	for (let i = 0; i < queue.length; i++) {
		const res = applyLocalAction(working, meIdx, queue[i], PROJECTION_AT)
		if (isApplyError(res)) return { state: working, valid: i }
		working = res.state
	}
	return { state: working, valid: queue.length }
}

// The projection's events are discarded, so its timestamps only have to be a
// constant — and a constant keeps `projectQueue` referentially transparent, so
// the memo doesn't re-render on every fold.
const PROJECTION_AT = ''

// --- Shared gates -----------------------------------------------------------

// The floor test every build shares: your own main turn, or your special-build
// slot where the action allows one. Super city, liquidate and the bank are
// main-only — trading of any kind during a special build caused a lockout, and
// the two accountant/metropolitan actions were never offered there.
function buildFloor(
	state: GameState,
	meIdx: number,
	allowSpecialBuild: boolean
): string | null {
	const inMain = state.phase.kind === 'main' && state.currentTurn === meIdx
	const inSpecial = allowSpecialBuild && isSpecialBuildActor(state, meIdx)
	if (inMain || inSpecial) return null
	if (state.phase.kind !== 'main' && state.phase.kind !== 'special_build')
		return 'expected main phase'
	return 'not your turn'
}

function mainTurnOnly(state: GameState, meIdx: number): string | null {
	if (state.phase.kind !== 'main') return 'expected main phase'
	if (state.currentTurn !== meIdx) return 'not your turn'
	return null
}

// The tail every action runs: Longest Road where the road graph could have
// moved, then the win check. Deliberately per action rather than once per
// batch — a batch whose second action wins should stop there, exactly as two
// separate requests would have.
function finish(
	state: GameState,
	events: unknown[],
	at: string,
	opts: { recomputeRoads: boolean }
): ApplyOk {
	let cur = state
	if (opts.recomputeRoads) {
		const holder = recomputeLongestRoad(cur)
		if (holder !== cur.longestRoad) {
			cur = { ...cur, longestRoad: holder }
			events.push({ kind: 'longest_road_changed', player: holder, at })
		}
	}
	const winner = findWinner(cur)
	if (winner !== null) {
		const gameOver: Phase = { kind: 'game_over' }
		cur = { ...cur, phase: gameOver }
		events.push({
			kind: 'game_complete',
			winner,
			at,
			vpCards: vpCardCountsByPlayer(cur),
		})
	}
	return { state: cur, events }
}

function creditHand(
	players: PlayerState[],
	meIdx: number,
	gain: ResourceHand
): PlayerState[] {
	return players.map((p, i) => {
		if (i !== meIdx) return p
		const next = { ...p.resources }
		for (const r of RESOURCES) next[r] = next[r] + gain[r]
		return { ...p, resources: next }
	})
}

// --- Builds -----------------------------------------------------------------

function applyBuildRoad(
	state: GameState,
	meIdx: number,
	action: Extract<LocalAction, { action: 'build_road' }>,
	at: string
): ApplyResult {
	const phase = state.phase
	const isRoadBuilding = phase.kind === 'road_building'
	if (!isRoadBuilding) {
		const floor = buildFloor(state, meIdx, true)
		if (floor) return { error: floor }
	} else if (state.currentTurn !== meIdx) {
		return { error: 'not your turn' }
	}
	if (
		!(boardFor(state.variant).edges as readonly string[]).includes(
			action.edge
		)
	)
		return { error: 'unknown edge' }
	const edge = action.edge
	if (!isValidBuildRoadEdge(state, meIdx, edge))
		return { error: 'invalid road' }

	let nextPlayers = state.players
	let nextPhase: Phase | null = null
	if (isRoadBuilding) {
		// Place speculatively so the follow-up check sees the new edge: a
		// second free road with nowhere legal to go ends the phase early
		// rather than stranding the player in it.
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
		nextPhase =
			remainingAfter === 0 || !hasLegalRoadPlacement(afterPlace, meIdx)
				? phase.resume
				: {
						kind: 'road_building',
						resume: phase.resume,
						remaining: remainingAfter as 1,
					}
	} else {
		const meP = state.players[meIdx]
		// Overbuilding your own fence is priced by the edge — 1 brick, no
		// payload and no cost substitution.
		let cost: ResourceHand | null
		if (isOwnFence(state, edge, meIdx)) {
			cost = canAfford(meP.resources, FENCE_UPGRADE_COST)
				? FENCE_UPGRADE_COST
				: null
		} else {
			cost = resolvePurchaseCost(
				meP,
				BUILD_COSTS.road,
				!!action.use_bricklayer,
				action.smith_swap ?? 0
			)
		}
		if (!cost) return { error: 'insufficient resources' }
		if (
			!canSpendUnderAge(
				meP,
				costSize(cost),
				gameSizeFor(state.players.length)
			)
		)
			return { error: 'age limit reached this turn' }
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
	// A road over your own fence consumes it, free placements included — a
	// Road Building road gets no rebate for the fence it eats.
	let nextFenceTokens = state.fenceTokens
	if (state.fenceTokens?.[edge] === meIdx) {
		nextFenceTokens = { ...state.fenceTokens }
		delete nextFenceTokens[edge]
	}

	const next: GameState = {
		...state,
		players: nextPlayers,
		edges: nextEdges,
		fenceTokens: nextFenceTokens,
		phase: nextPhase ?? state.phase,
	}
	return finish(next, [{ kind: 'road_built', player: meIdx, edge, at }], at, {
		recomputeRoads: true,
	})
}

function applyBuildSettlement(
	state: GameState,
	meIdx: number,
	action: Extract<LocalAction, { action: 'build_settlement' }>,
	at: string
): ApplyResult {
	const floor = buildFloor(state, meIdx, true)
	if (floor) return { error: floor }
	if (
		!(boardFor(state.variant).vertices as readonly string[]).includes(
			action.vertex
		)
	)
		return { error: 'unknown vertex' }
	const vertex = action.vertex
	if (!isValidBuildSettlementVertex(state, meIdx, vertex))
		return { error: 'invalid settlement' }

	const meP = state.players[meIdx]
	const cost = resolvePurchaseCost(
		meP,
		BUILD_COSTS.settlement,
		!!action.use_bricklayer,
		action.smith_swap ?? 0
	)
	if (!cost) return { error: 'insufficient resources' }
	if (
		!canSpendUnderAge(
			meP,
			costSize(cost),
			gameSizeFor(state.players.length)
		)
	)
		return { error: 'age limit reached this turn' }

	const events: unknown[] = [
		{ kind: 'settlement_built', player: meIdx, vertex, at },
	]
	let next: GameState = {
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
		players: applyCost(state.players, meIdx, cost),
	}
	// This settlement (or its neighbors) can make a haunt player's secret spot
	// unbuildable, which spawns their ghost there.
	const haunt = resolveHauntGhosts(next)
	next = haunt.state
	for (const s of haunt.spawned) {
		events.push({
			kind: 'ghost_spawned',
			player: s.player,
			vertex: s.vertex,
			at,
		})
	}
	// An opponent's settlement can split a road chain, so Longest Road is
	// recomputed here too — not only on road builds.
	return finish(next, events, at, { recomputeRoads: true })
}

function applyBuildCity(
	state: GameState,
	meIdx: number,
	action: Extract<LocalAction, { action: 'build_city' }>,
	at: string
): ApplyResult {
	const floor = buildFloor(state, meIdx, true)
	if (floor) return { error: floor }
	if (
		!(boardFor(state.variant).vertices as readonly string[]).includes(
			action.vertex
		)
	)
		return { error: 'unknown vertex' }
	const vertex = action.vertex
	if (!isValidBuildCityVertex(state, meIdx, vertex))
		return { error: 'invalid city target' }

	const meP = state.players[meIdx]
	const useBricklayer = !!action.use_bricklayer
	const requested = Number.isFinite(action.swap_wheat_to_ore)
		? Number(action.swap_wheat_to_ore)
		: 0
	const swapDelta = metropolitanWheatSwapDelta(meP.bonus, requested)
	let cost: ResourceHand | null
	if (useBricklayer) {
		cost = resolvePurchaseCost(meP, BUILD_COSTS.city, true)
	} else if (swapDelta > 0) {
		const alt = metropolitanCityCost(meP.bonus, swapDelta)
		cost = canAfford(meP.resources, alt) ? alt : null
	} else {
		cost = resolvePurchaseCost(
			meP,
			BUILD_COSTS.city,
			false,
			action.smith_swap ?? 0
		)
	}
	if (!cost) return { error: 'insufficient resources' }
	if (
		!canSpendUnderAge(
			meP,
			costSize(cost),
			gameSizeFor(state.players.length)
		)
	)
		return { error: 'age limit reached this turn' }

	const next: GameState = {
		...state,
		vertices: {
			...state.vertices,
			[vertex]: {
				occupied: true as const,
				player: meIdx,
				building: 'city' as const,
				placedTurn: state.round,
			},
		},
		players: applyCost(state.players, meIdx, cost),
	}
	// Cities don't touch the road graph.
	return finish(
		next,
		[{ kind: 'city_built', player: meIdx, vertex, at }],
		at,
		{
			recomputeRoads: false,
		}
	)
}

function applyBuildSuperCity(
	state: GameState,
	meIdx: number,
	action: Extract<LocalAction, { action: 'build_super_city' }>,
	at: string
): ApplyResult {
	const floor = buildFloor(state, meIdx, false)
	if (floor) return { error: floor }
	if (
		!(boardFor(state.variant).vertices as readonly string[]).includes(
			action.vertex
		)
	)
		return { error: 'unknown vertex' }
	const vertex = action.vertex
	const meP = state.players[meIdx]
	if (meP.bonus !== 'metropolitan') return { error: 'not a metropolitan' }
	if (!canBuildMoreSuperCities(state, meIdx))
		return { error: 'super city cap reached' }
	const vs = vertexStateOf(state, vertex)
	if (!vs.occupied || vs.player !== meIdx || vs.building !== 'city')
		return { error: 'must upgrade your own city' }
	if (!canPlaceUnderPower(state, meIdx, vertex))
		return { error: 'power curse blocks this upgrade' }

	const requested = Number.isFinite(action.swap_wheat_to_ore)
		? Number(action.swap_wheat_to_ore)
		: 0
	const swapDelta = metropolitanWheatSwapDelta(meP.bonus, requested)
	const cost = metropolitanCityCost(meP.bonus, swapDelta)
	if (!canAfford(meP.resources, cost))
		return { error: 'insufficient resources' }
	if (
		!canSpendUnderAge(
			meP,
			costSize(cost),
			gameSizeFor(state.players.length)
		)
	)
		return { error: 'age limit reached this turn' }

	const next: GameState = {
		...state,
		vertices: {
			...state.vertices,
			[vertex]: {
				occupied: true as const,
				player: meIdx,
				building: 'super_city' as const,
				placedTurn: state.round,
			},
		},
		players: applyCost(state.players, meIdx, cost),
	}
	return finish(
		next,
		[{ kind: 'build_super_city', player: meIdx, vertex, cost, at }],
		at,
		{ recomputeRoads: false }
	)
}

function applyBuildFence(
	state: GameState,
	meIdx: number,
	action: Extract<LocalAction, { action: 'build_fence' }>,
	at: string
): ApplyResult {
	const floor = buildFloor(state, meIdx, true)
	if (floor) return { error: floor }
	const meP = state.players[meIdx]
	if (meP?.bonus !== 'fencer') return { error: 'not a fencer' }
	if (
		!(boardFor(state.variant).edges as readonly string[]).includes(
			action.edge
		)
	)
		return { error: 'unknown edge' }
	const edge = action.edge
	if (!isValidBuildFenceEdge(state, meIdx, edge))
		return { error: 'invalid fence' }
	if (!canAfford(meP.resources, FENCE_COST))
		return { error: 'insufficient resources' }
	if (
		!canSpendUnderAge(
			meP,
			costSize(FENCE_COST),
			gameSizeFor(state.players.length)
		)
	)
		return { error: 'age limit reached this turn' }

	const next: GameState = {
		...state,
		players: applyCost(state.players, meIdx, FENCE_COST),
		fenceTokens: { ...(state.fenceTokens ?? {}), [edge]: meIdx },
	}
	// A fence is not an entry in `edges`, so the road graph is untouched.
	return finish(
		next,
		[{ kind: 'fence_built', player: meIdx, edge, at }],
		at,
		{
			recomputeRoads: false,
		}
	)
}

// --- Bank -------------------------------------------------------------------

function applyBankTrade(
	state: GameState,
	meIdx: number,
	action: Extract<LocalAction, { action: 'bank_trade' }>,
	at: string
): ApplyResult {
	// Main-turn only: a bank trade inside a special-build slot could drop the
	// builder under `moreThanSeven` and disable the build they entered for.
	if (state.phase.kind === 'special_build')
		return { error: 'no trading during special build' }
	const floor = mainTurnOnly(state, meIdx)
	if (floor) return { error: floor }

	const { give, receive } = action
	// A non-null partition is both the validity answer and the record of what
	// was charged — there is no ratio to pick.
	const rates = bankPartitionFor(state, meIdx, give, receive)
	if (!rates) return { error: 'no valid bank rate for this trade' }
	if (!canAfford(state.players[meIdx].resources, give))
		return { error: 'insufficient resources' }

	const next: GameState = {
		...state,
		players: applyBankTradeToPlayer(state.players, meIdx, give, receive),
	}
	// `ratio` survives only for a uniform partition, which is what keeps the
	// log's "4:1" row reading the way it always has.
	const uniform = uniformRatioOf(rates)
	return finish(
		next,
		[
			{
				kind: 'bank_trade',
				player: meIdx,
				give,
				receive,
				...(uniform === null ? {} : { ratio: uniform }),
				rates,
				at,
			},
		],
		at,
		{ recomputeRoads: false }
	)
}

// --- Accountant -------------------------------------------------------------

function applyLiquidate(
	state: GameState,
	meIdx: number,
	action: Extract<LocalAction, { action: 'liquidate' }>,
	at: string
): ApplyResult {
	const floor = buildFloor(state, meIdx, false)
	if (floor) return { error: floor }
	if (state.players[meIdx].bonus !== 'accountant')
		return { error: 'not an accountant' }

	const board = boardFor(state.variant)
	const target = action.target
	const invalid = { error: 'invalid liquidation target' }

	if (target.kind === 'road') {
		if (!(board.edges as readonly string[]).includes(target.edge))
			return invalid
		const es = state.edges[target.edge]
		if (!es?.occupied || es.player !== meIdx) return invalid
		// Not the same turn it was bought, and not if removing it would strand
		// a piece further out.
		if (es.placedTurn >= state.round) return invalid
		if (roadLiquidationBlocked(state, meIdx, target.edge)) return invalid
		const nextEdges = { ...state.edges }
		delete nextEdges[target.edge]
		const next: GameState = {
			...state,
			edges: nextEdges,
			players: creditHand(state.players, meIdx, ROAD_REFUND),
		}
		return finish(
			next,
			[
				{
					kind: 'liquidate',
					player: meIdx,
					detail: {
						kind: 'road',
						edge: target.edge,
						at,
						refund: ROAD_REFUND,
					},
					at,
				},
			],
			at,
			// A removed road can split a chain.
			{ recomputeRoads: true }
		)
	}

	if (!(board.vertices as readonly string[]).includes(target.vertex))
		return invalid
	const vs = vertexStateOf(state, target.vertex)
	if (!vs.occupied || vs.player !== meIdx) return invalid
	if (vs.building !== target.kind) return invalid
	if (vs.placedTurn >= state.round) return invalid

	const refund =
		target.kind === 'settlement'
			? SETTLEMENT_REFUND
			: target.kind === 'city'
				? CITY_REFUND
				: SUPER_CITY_REFUND
	// A settlement comes off the board; a city and super city step down one.
	const nextVertices = { ...state.vertices }
	if (target.kind === 'settlement') {
		delete nextVertices[target.vertex]
	} else {
		nextVertices[target.vertex] = {
			occupied: true as const,
			player: meIdx,
			building: target.kind === 'city' ? 'settlement' : 'city',
			placedTurn: vs.placedTurn,
		}
	}
	const next: GameState = {
		...state,
		vertices: nextVertices,
		players: creditHand(state.players, meIdx, refund),
	}
	return finish(
		next,
		[
			{
				kind: 'liquidate',
				player: meIdx,
				detail: {
					kind: target.kind,
					vertex: target.vertex,
					at,
					refund,
				},
				at,
			},
		],
		at,
		// A removed settlement can rejoin an opponent's chain.
		{ recomputeRoads: target.kind === 'settlement' }
	)
}

// --- Investor / carpenter / veteran -----------------------------------------

function applyInvest(
	state: GameState,
	meIdx: number,
	action: Extract<LocalAction, { action: 'invest' }>,
	at: string
): ApplyResult {
	const floor = mainTurnOnly(state, meIdx)
	if (floor) return { error: floor }
	const meP = state.players[meIdx]
	if (meP.bonus !== 'investor') return { error: 'not an investor' }
	const { resource } = action
	if (
		!canInvest(
			meP,
			resource,
			totalVP(state, meIdx),
			gameSizeFor(state.players.length)
		)
	)
		return { error: 'cannot invest' }

	const investments = { ...(meP.investments ?? {}) }
	investments[resource] = (investments[resource] ?? 0) + 1
	const next: GameState = {
		...state,
		players: state.players.map((p, i) =>
			i === meIdx
				? {
						...p,
						resources: {
							...p.resources,
							[resource]: p.resources[resource] - INVEST_TRIO,
						},
						investments,
					}
				: p
		),
	}
	return finish(next, [{ kind: 'invest', player: meIdx, resource, at }], at, {
		recomputeRoads: false,
	})
}

function applyBuyCarpenterVP(
	state: GameState,
	meIdx: number,
	at: string
): ApplyResult {
	const floor = mainTurnOnly(state, meIdx)
	if (floor) return { error: floor }
	const meP = state.players[meIdx]
	if (meP.bonus !== 'carpenter') return { error: 'not a carpenter' }
	if (meP.boughtCarpenterVPThisTurn)
		return { error: 'already bought carpenter VP this turn' }
	if (!canAfford(meP.resources, CARPENTER_COST))
		return { error: 'insufficient wood' }

	const next: GameState = {
		...state,
		players: state.players.map((p, i) =>
			i === meIdx
				? {
						...p,
						resources: deductHand(p.resources, CARPENTER_COST),
						carpenterVP: (p.carpenterVP ?? 0) + 1,
						boughtCarpenterVPThisTurn: true,
					}
				: p
		),
	}
	// A VP can push the buyer over the threshold; no road-graph change.
	return finish(next, [{ kind: 'carpenter_vp', player: meIdx, at }], at, {
		recomputeRoads: false,
	})
}

function applyTapKnight(
	state: GameState,
	meIdx: number,
	action: Extract<LocalAction, { action: 'tap_knight' }>,
	at: string
): ApplyResult {
	const floor = mainTurnOnly(state, meIdx)
	if (floor) return { error: floor }
	const meP = state.players[meIdx]
	if (meP.bonus !== 'veteran') return { error: 'not a veteran' }
	const played = meP.devCardsPlayed.knight ?? 0
	const tapped = meP.tappedKnights ?? 0
	if (played - tapped < 1) return { error: 'no untapped played knight' }

	const { r1, r2 } = action
	const next: GameState = {
		...state,
		players: state.players.map((p, i) => {
			if (i !== meIdx) return p
			const res = { ...p.resources }
			res[r1] += 1
			res[r2] += 1
			return { ...p, resources: res, tappedKnights: tapped + 1 }
		}),
	}
	return finish(
		next,
		[{ kind: 'knight_tapped', player: meIdx, resources: [r1, r2], at }],
		at,
		{ recomputeRoads: false }
	)
}

// --- Explorer (post_placement) ----------------------------------------------

type PostPlacementPending = {
	specialist: number[]
	explorer?: Partial<Record<number, number>>
	haunt?: number[]
}

// `roll` once every pending entry drains, otherwise a post_placement carrying
// only the non-empty ones — so one bonus draining never wipes another's.
function postPlacementPhaseFrom(pending: PostPlacementPending): Phase {
	const drained =
		pending.specialist.length === 0 &&
		!(pending.explorer && Object.keys(pending.explorer).length > 0) &&
		!(pending.haunt && pending.haunt.length > 0)
	if (drained) return { kind: 'roll' }
	const out: PostPlacementPending = { specialist: pending.specialist }
	if (pending.explorer && Object.keys(pending.explorer).length > 0)
		out.explorer = pending.explorer
	if (pending.haunt && pending.haunt.length > 0) out.haunt = pending.haunt
	return { kind: 'post_placement', pending: out }
}

function applyPlaceExplorerRoad(
	state: GameState,
	meIdx: number,
	action: Extract<LocalAction, { action: 'place_explorer_road' }>,
	at: string
): ApplyResult {
	// `post_placement` is parallel — no turn test, each seat drains its own
	// entry and the phase advances when the last of them is gone.
	if (state.phase.kind !== 'post_placement')
		return { error: 'expected post_placement phase' }
	const remaining = state.phase.pending.explorer?.[meIdx] ?? 0
	if (remaining <= 0) return { error: 'no explorer roads remaining' }
	if (
		!(boardFor(state.variant).edges as readonly string[]).includes(
			action.edge
		)
	)
		return { error: 'unknown edge' }
	const edge = action.edge
	if (!isValidBuildRoadEdge(state, meIdx, edge))
		return { error: 'invalid road placement' }

	const explorer = { ...(state.phase.pending.explorer ?? {}) }
	if (remaining - 1 <= 0) delete explorer[meIdx]
	else explorer[meIdx] = remaining - 1

	const next: GameState = {
		...state,
		edges: {
			...state.edges,
			[edge]: {
				occupied: true as const,
				player: meIdx,
				placedTurn: state.round,
			},
		},
		phase: postPlacementPhaseFrom({ ...state.phase.pending, explorer }),
	}
	// Longest Road is recomputed so leaderboards reflect explorer placements;
	// no win check can fire here, but `finish` handles that by finding none.
	return finish(
		next,
		[{ kind: 'explorer_road', player: meIdx, edge, at }],
		at,
		{ recomputeRoads: true }
	)
}

// --- Magician window --------------------------------------------------------

function applyCastMagic(
	state: GameState,
	meIdx: number,
	action: Extract<LocalAction, { action: 'cast_magic' }>,
	at: string
): ApplyResult {
	const phase = state.phase
	if (phase.kind !== 'magician_pick')
		return { error: 'expected magician_pick phase' }
	if (phase.roller !== meIdx) return { error: 'not your magician window' }

	const actual = phase.roll.a + phase.roll.b
	const { target, discard } = action
	if (!isValidMagicTarget(actual, target)) return { error: 'invalid target' }
	if (
		handSize(discard) !==
		magicDiscardCount(actual, target, gameSizeFor(state.players.length))
	)
		return { error: 'wrong discard count' }
	const meP = state.players[meIdx]
	// The roll's own gain is still withheld on the phase, so this is the hand
	// they rolled with — the real constraint on what a cast can cost.
	if (!canAfford(meP.resources, discard))
		return { error: 'insufficient cards to discard' }

	// Phantom production: the target number pays the magician and nobody else.
	const gain = distributeResources(state, target)[meIdx] ?? emptyHand()
	const pending = phase.pendingGain ?? emptyHand()
	const resources = { ...meP.resources }
	for (const r of RESOURCES)
		resources[r] = resources[r] - discard[r] + gain[r] + pending[r]

	const next: GameState = {
		...state,
		players: state.players.map((p, i) =>
			i === meIdx ? { ...p, resources, lastMagicRound: state.round } : p
		),
		phase: phase.resume,
	}
	return finish(
		next,
		[{ kind: 'magic_cast', player: meIdx, target, discard, gain, at }],
		at,
		{ recomputeRoads: false }
	)
}

function applySkipMagic(
	state: GameState,
	meIdx: number,
	at: string
): ApplyResult {
	const phase = state.phase
	if (phase.kind !== 'magician_pick')
		return { error: 'expected magician_pick phase' }
	if (phase.roller !== meIdx) return { error: 'not your magician window' }

	// Keeping the roll still collects it: the withheld production lands here,
	// the window's other exit.
	const pending = phase.pendingGain ?? emptyHand()
	const next: GameState = {
		...state,
		players: creditHand(state.players, meIdx, pending),
		phase: phase.resume,
	}
	return finish(next, [{ kind: 'magic_skipped', player: meIdx, at }], at, {
		recomputeRoads: false,
	})
}
