// Everything the game screen's three zones act on: local UI state, the flags
// derived from the current phase, and one handler per store action. The zones
// (TopArea / BoardArea / BottomArea) read it through `useGameScreen()` rather
// than a prop list, so an affordance moving from one bar to another is a
// change in one file instead of three prop chains.
//
// Must be mounted inside <GameProvider> — it builds on useGame().

import { useAuth } from '@/lib/auth'
import { RESOURCES, type Hex, type Resource } from '@/lib/catan/board'
import type { LiquidationTarget } from '@/lib/catan/AccountantPicker'
import type { BonusId, CurseId } from '@/lib/catan/bonuses'
import {
	affordableScoutSwaps,
	canBuildMoreSuperCities,
	canInvest,
	fenceOwner,
	forgerTokenHex,
	mustMoveForgerToken,
	type ScoutSwap,
} from '@/lib/catan/bonus'
import {
	canAffordPurchase,
	canAffordMetropolitanCost,
	handSize,
	shouldUseBricklayer,
	smithSwapFor,
	validBuildCityVertices,
	validBuildRoadEdges,
	validBuildSettlementVertices,
	validBuildSuperCityVertices,
	type BuildKind,
	type PurchaseKind,
} from '@/lib/catan/build'
import type { BoardTool, BuildSelection } from '@/lib/catan/BuildLayer'
import type { BuildCurseHints } from '@/lib/catan/BuildTradeBar'
import { curseBuildReason } from '@/lib/catan/curses'
import { canBuyDevCard } from '@/lib/catan/dev'
import type { DevPlayPayload } from '@/lib/catan/DevCardHand'
import { useGame } from '@/lib/catan/gameContext'
import type { PlacementSelection } from '@/lib/catan/PlacementLayer'
import { useSwitchableGames } from '@/lib/catan/switchableGames'
import { visibleOfferFor } from '@/lib/catan/TradeBanner'
import { isOfferRejectedByAll } from '@/lib/catan/trade'
import {
	gameSizeFor,
	type PlayerState,
	type ResourceHand as ResourceHandType,
} from '@/lib/catan/types'
import {
	isFinished,
	useGamesStore,
	type GameEvent,
} from '@/lib/stores/useGamesStore'
import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from 'react'
import { Alert, Platform } from 'react-native'

// How long a `stolen` event waits for the victim's players[] row to arrive
// before we give up on recovering the resource and skip the animation.
const STEAL_DIFF_GRACE_MS = 5000

type GameScreenValue = ReturnType<typeof useGameScreenState>

const GameScreenContext = createContext<GameScreenValue | null>(null)

export function useGameScreen(): GameScreenValue {
	const ctx = useContext(GameScreenContext)
	if (!ctx)
		throw new Error(
			'useGameScreen must be used within <GameScreenProvider>'
		)
	return ctx
}

export function GameScreenProvider({
	gameId,
	children,
}: {
	gameId: string
	children: ReactNode
}) {
	const value = useGameScreenState(gameId)
	// Deliberately not memoized. Every field here is derived from the same
	// game/gameState pair, so a stable identity would only survive the renders
	// where nothing changed — and the provider doesn't re-render on those.
	return (
		<GameScreenContext.Provider value={value}>
			{children}
		</GameScreenContext.Provider>
	)
}

function useGameScreenState(gameId: string) {
	const { user } = useAuth()
	const { game, gameState, ready, publicVP, selfVP, isSpectator } = useGame()
	const switchableGames = useSwitchableGames()
	const profilesById = useGamesStore((s) => s.profilesById)
	const pickBonus = useGamesStore((s) => s.pickBonus)
	const placeSettlement = useGamesStore((s) => s.placeSettlement)
	const placeRoad = useGamesStore((s) => s.placeRoad)
	const chooseLastSettlement = useGamesStore((s) => s.chooseLastSettlement)
	const roll = useGamesStore((s) => s.roll)
	const confirmRoll = useGamesStore((s) => s.confirmRoll)
	const rerollDice = useGamesStore((s) => s.rerollDice)
	const endTurn = useGamesStore((s) => s.endTurn)
	const honk = useGamesStore((s) => s.honk)
	const endSpecialBuild = useGamesStore((s) => s.endSpecialBuild)
	const buildRoad = useGamesStore((s) => s.buildRoad)
	const buildSettlement = useGamesStore((s) => s.buildSettlement)
	const buildCity = useGamesStore((s) => s.buildCity)
	const discard = useGamesStore((s) => s.discard)
	const moveRobber = useGamesStore((s) => s.moveRobber)
	const steal = useGamesStore((s) => s.steal)
	const proposeTrade = useGamesStore((s) => s.proposeTrade)
	const acceptTrade = useGamesStore((s) => s.acceptTrade)
	const cancelTrade = useGamesStore((s) => s.cancelTrade)
	const rejectTrade = useGamesStore((s) => s.rejectTrade)
	const confirmTrade = useGamesStore((s) => s.confirmTrade)
	const bankTrade = useGamesStore((s) => s.bankTrade)
	const buyDevCard = useGamesStore((s) => s.buyDevCard)
	const playDevCard = useGamesStore((s) => s.playDevCard)
	const setSpecialistResource = useGamesStore((s) => s.setSpecialistResource)
	const buyCarpenterVP = useGamesStore((s) => s.buyCarpenterVP)
	const tapKnight = useGamesStore((s) => s.tapKnight)
	const buildSuperCity = useGamesStore((s) => s.buildSuperCity)
	const liquidate = useGamesStore((s) => s.liquidate)
	const placeExplorerRoad = useGamesStore((s) => s.placeExplorerRoad)
	const ritualRoll = useGamesStore((s) => s.ritualRoll)
	const shepherdSwap = useGamesStore((s) => s.shepherdSwap)
	const claimCurio = useGamesStore((s) => s.claimCurio)
	const moveForgerToken = useGamesStore((s) => s.moveForgerToken)
	const pickForgerTarget = useGamesStore((s) => s.pickForgerTarget)
	const confirmScoutCard = useGamesStore((s) => s.confirmScoutCard)
	const placeFenceToken = useGamesStore((s) => s.placeFenceToken)
	const setHauntSpots = useGamesStore((s) => s.setHauntSpots)
	const invest = useGamesStore((s) => s.invest)
	const castMagic = useGamesStore((s) => s.castMagic)
	const skipMagic = useGamesStore((s) => s.skipMagic)
	const undo = useGamesStore((s) => s.undo)
	const setForfeit = useGamesStore((s) => s.setForfeit)
	const setEndVote = useGamesStore((s) => s.setEndVote)

	const [selection, setSelection] = useState<PlacementSelection | null>(null)
	const [submitting, setSubmitting] = useState(false)
	const [buildTool, setBuildTool] = useState<BuildKind | 'super_city' | null>(
		null
	)
	const [tradePanelOpen, setTradePanelOpen] = useState(false)
	const [ritualOpen, setRitualOpen] = useState(false)
	const [shepherdOpen, setShepherdOpen] = useState(false)
	const [accountantOpen, setAccountantOpen] = useState(false)
	const [scoutCostOpen, setScoutCostOpen] = useState(false)
	// When a city / super_city build is pending and the metropolitan
	// player can swap wheat→ore, this carries the picked vertex until the
	// swap modal resolves.
	const [metroPending, setMetroPending] = useState<
		| { kind: 'city'; vertex: string }
		| { kind: 'super_city'; vertex: string }
		| null
	>(null)
	const [pendingConfirm, setPendingConfirm] = useState<{
		title: string
		run: () => void | Promise<void>
		// A build spot awaiting confirmation, previewed on the board so the
		// choice is visible while the confirm bar is up.
		preview?: BuildSelection
	} | null>(null)
	const [openPlayerIdx, setOpenPlayerIdx] = useState<number | null>(null)
	// Game area's y within the screen root, so the chat panel can anchor to the
	// same line as the floating buttons. See BoardArea's onLayout.
	const [boardTop, setBoardTop] = useState(0)
	// Haunt: the vertices the local haunt player has tapped (needs 2) during
	// post_placement, before committing. Investor: whether the invest picker
	// modal is open.
	const [hauntPicks, setHauntPicks] = useState<string[]>([])
	const [investOpen, setInvestOpen] = useState(false)
	const [bonusPaneCollapsed, setBonusPaneCollapsed] = useState(false)
	// Admin testing: the total a `dev`-flagged seat has pinned for its next
	// roll, or null to roll normally. Sticky across turns on purpose.
	const [devRollTotal, setDevRollTotal] = useState<number | null>(null)
	// Game-over overlay starts open when the game is complete; user can
	// dismiss to inspect the final board and reopen via FinalScoreButton.
	const [gameOverOpen, setGameOverOpen] = useState(true)

	function confirmAction(
		title: string,
		run: () => void | Promise<void>,
		preview?: BuildSelection
	) {
		setPendingConfirm({ title, run, preview })
	}

	async function runPendingConfirm() {
		if (!pendingConfirm) return
		const { run } = pendingConfirm
		setPendingConfirm(null)
		await run()
	}

	const meIdx = useMemo(() => {
		if (!game || !user) return -1
		return game.player_order.indexOf(user.id)
	}, [game, user])

	// The zones' sliding areas get one pane per switchable game, so a switch's
	// direction falls out of the tab delta rather than being derived separately.
	// A game with no tab of its own — a completed one opened from History — gets
	// a single pane, which makes every zone's slide a no-op. So does a lone
	// active game.
	//
	// The index is positional, so a churn of the list that moves the current
	// game (a game ahead of it in tab order leaving) reads as a switch and
	// slides. New games append (the sort is oldest-created first), so the common
	// churn leaves every index alone.
	const gameTabIdx = switchableGames.findIndex((g) => g.id === gameId)
	const gameTabCount = gameTabIdx >= 0 ? switchableGames.length : 1
	const gameTabIndex = Math.max(gameTabIdx, 0)

	// One VP array shared by every surface that renders a player's score.
	// During active play opponents see publicVP (no hidden VP cards) and the
	// viewer sees their own selfVP. On game-over everyone is fully revealed.
	const displayVP = useMemo(() => {
		if (isFinished(game?.status ?? '')) return selfVP
		return publicVP.map((pub, i) => (i === meIdx ? selfVP[i] : pub))
	}, [game?.status, publicVP, selfVP, meIdx])

	const isCurrentPlayer =
		!!game &&
		game.current_turn !== null &&
		game.current_turn === meIdx &&
		meIdx >= 0

	const isMyPlacementTurn = isCurrentPlayer && game?.status === 'placement'
	const isMyActiveTurn = isCurrentPlayer && game?.status === 'active'

	// Special build phase (5-6 player games). The acting builder is the head of
	// the queue and is NOT the turn-holder, so it's derived from the phase, not
	// current_turn. `isMySpecialBuild` unlocks build/buy/bank for that player.
	const sbActor =
		gameState?.phase.kind === 'special_build'
			? (gameState.phase.queue[0] ?? null)
			: null
	const isMySpecialBuild =
		sbActor !== null && sbActor === meIdx && game?.status === 'active'

	// Reset selection when the turn or phase step changes under us — except on
	// the `pick_last` step, which opens pre-seeded with the round-2 settlement
	// so confirming untouched reproduces the standard rule. Which settlement
	// that is has to come from the log: once both roads are down the board no
	// longer says which one went second.
	const placementKey =
		gameState?.phase.kind === 'initial_placement'
			? `${game?.current_turn}-${gameState.phase.round}-${gameState.phase.step}`
			: null
	const pickLastSeed =
		gameState?.phase.kind === 'initial_placement' &&
		gameState.phase.step === 'pick_last'
			? roundTwoSettlementOf((game?.events ?? []) as GameEvent[], meIdx)
			: null
	useEffect(() => {
		setSelection(
			pickLastSeed ? { kind: 'settlement', vertex: pickLastSeed } : null
		)
	}, [placementKey, pickLastSeed])

	// Clear build tool + trade panel when we can no longer build — the turn
	// flips away / we leave main, or a special-build slot passes to someone
	// else. The key also changes between distinct special-build slots so the
	// tool resets for each actor.
	const canActBuild =
		(gameState?.phase.kind === 'main' && isMyActiveTurn) || isMySpecialBuild
	const mainTurnKey = canActBuild
		? `${game?.current_turn}-${gameState?.phase.kind}-${sbActor ?? ''}`
		: 'off'
	useEffect(() => {
		if (mainTurnKey === 'off') {
			setBuildTool(null)
			setTradePanelOpen(false)
		}
	}, [mainTurnKey])

	// Trade rides on the main phase — there's no top-level field for it.
	// `serverOffer` is the raw offer on game state; `liveOffer` is what *I*
	// should see — null once I (as an addressee) have rejected it.
	const serverOffer =
		gameState?.phase.kind === 'main' ? gameState.phase.trade : null
	const liveOffer = visibleOfferFor(serverOffer, meIdx)

	// Close the compose panel if a live offer appears (we just sent it) or
	// disappears (someone accepted/cancelled).
	const liveTradeId = liveOffer?.id ?? null
	useEffect(() => {
		setTradePanelOpen(false)
	}, [liveTradeId])

	// Once every addressee has rejected, the proposer's banner shows
	// "Rejected by everyone" briefly, then auto-cancels. The cancel issuance
	// is the proposer's responsibility — no other client owns it.
	const playerCount = game?.player_order.length ?? 0
	const proposerOfferAllRejected =
		!!serverOffer &&
		serverOffer.from === meIdx &&
		isOfferRejectedByAll(serverOffer, playerCount)
	useEffect(() => {
		if (!proposerOfferAllRejected || !game || !serverOffer) return
		const offerId = serverOffer.id
		const gameId = game.id
		const id = setTimeout(() => {
			cancelTrade(gameId, offerId)
		}, 2000)
		return () => clearTimeout(id)
	}, [proposerOfferAllRejected, game, serverOffer, cancelTrade])

	// Any pending confirm is tied to the current phase/turn. If either flips
	// under us (realtime), drop the stale confirm so its closure doesn't
	// fire against the wrong state.
	const confirmScopeKey = `${game?.current_turn ?? 'x'}:${gameState?.phase.kind ?? 'x'}`
	useEffect(() => {
		setPendingConfirm(null)
	}, [confirmScopeKey])

	// --- Steal animation ---------------------------------------------------
	// Detect the moment a `stolen` event lands on the events log involving me
	// (as thief or victim). The resource isn't in the event itself — we recover
	// it by diffing the victim's hand pre/post — so we keep a ref of the last
	// players[] we observed. Bystanders never derive a resource and never see
	// the animation.
	const [stealAnim, setStealAnim] = useState<{
		key: string
		preHand: ResourceHandType
		stolen: Resource
		thiefName: string
		victimName: string
		meIsThief: boolean
	} | null>(null)
	const prevPlayersRef = useRef<PlayerState[] | undefined>(undefined)
	const lastSeenEventCountRef = useRef<number | null>(null)
	// A `stolen` event whose resource we couldn't recover yet. `games` and
	// `game_states` are separate realtime rows, so the players[] update can
	// land either side of the event. If it lands *first*, our snapshot is
	// already post-steal and the diff is unrecoverable — hence the deadline:
	// without one the pending steal sits forever and eventually matches an
	// unrelated hand change, firing the animation minutes late.
	const pendingStealRef = useRef<{
		event: Extract<GameEvent, { kind: 'stolen' }>
		preHand: ResourceHandType
		firstSeenAt: number
	} | null>(null)
	useEffect(() => {
		if (!game || !gameState) return
		const events = (game.events ?? []) as GameEvent[]
		const players = gameState.players

		if (lastSeenEventCountRef.current === null) {
			lastSeenEventCountRef.current = events.length
			prevPlayersRef.current = players
			return
		}

		const newEvents = events.slice(lastSeenEventCountRef.current)
		const stealEvent = newEvents.find(
			(e): e is Extract<GameEvent, { kind: 'stolen' }> =>
				e?.kind === 'stolen' &&
				(e.thief === meIdx || e.victim === meIdx)
		)
		lastSeenEventCountRef.current = events.length

		// Snapshot taken before this render's players[] is adopted, so it's
		// the pre-steal hand whenever the event arrived first.
		const prev = prevPlayersRef.current
		prevPlayersRef.current = players

		if (stealEvent) {
			const preHand = prev?.[stealEvent.victim]?.resources
			pendingStealRef.current = preHand
				? { event: stealEvent, preHand, firstSeenAt: Date.now() }
				: null
		}

		const pending = pendingStealRef.current
		if (!pending) return
		if (Date.now() - pending.firstSeenAt > STEAL_DIFF_GRACE_MS) {
			pendingStealRef.current = null
			return
		}

		const after = players[pending.event.victim]?.resources
		const stolen = after ? diffStolenResource(pending.preHand, after) : null
		if (!stolen) return // players[] hasn't caught up — retry next render

		pendingStealRef.current = null

		const thiefName =
			profilesById[game.player_order[pending.event.thief]]?.username ??
			'Player'
		const victimName =
			profilesById[game.player_order[pending.event.victim]]?.username ??
			'Player'

		setStealAnim({
			key:
				pending.event.at +
				':' +
				pending.event.thief +
				':' +
				pending.event.victim,
			preHand: pending.preHand,
			stolen,
			thiefName,
			victimName,
			meIsThief: pending.event.thief === meIdx,
		})
	}, [game, gameState, meIdx, profilesById])

	// --- Nomad animation ---------------------------------------------------
	// `nomad_produce` events are already self-describing (resource + count
	// in the event payload), so detection doesn't depend on hand diffing.
	// Multiple nomads can produce on the same 7-roll, so animations queue.
	const [nomadAnimQueue, setNomadAnimQueue] = useState<
		{
			key: string
			produced: Resource
			count: number
			playerName: string
			meIsNomad: boolean
		}[]
	>([])
	const lastSeenNomadIndexRef = useRef<number | null>(null)
	useEffect(() => {
		if (!game) return
		const events = (game.events ?? []) as GameEvent[]
		if (lastSeenNomadIndexRef.current === null) {
			lastSeenNomadIndexRef.current = events.length
			return
		}
		if (events.length === lastSeenNomadIndexRef.current) return
		const firstNew = lastSeenNomadIndexRef.current
		const newEvents = events.slice(firstNew)
		const queued: typeof nomadAnimQueue = []
		for (const [i, e] of newEvents.entries()) {
			if (e?.kind !== 'nomad_produce') continue
			const playerName =
				profilesById[game.player_order[e.player]]?.username ?? 'Player'
			queued.push({
				// Event index, not timestamp — a nomad on two deserts produces
				// two events that can share a millisecond.
				key: firstNew + i + ':' + e.player,
				produced: e.resource,
				count: e.count,
				playerName,
				meIsNomad: e.player === meIdx,
			})
		}
		lastSeenNomadIndexRef.current = events.length
		if (queued.length > 0) setNomadAnimQueue((q) => [...q, ...queued])
	}, [game, meIdx, profilesById])
	const nomadAnim = nomadAnimQueue[0] ?? null

	// --- Fortune teller animation ------------------------------------------
	// `fortune_teller_roll` events carry the bonus roll's dice + gain. Only
	// rolls that actually paid the FT player get an animation; empty-gain
	// bonus rolls (a bonus 7 or a miss) still appear in the log but don't pop
	// a modal. A single roll can chain into several events, so they queue.
	const [ftAnimQueue, setFtAnimQueue] = useState<
		{
			key: string
			dice: [number, number]
			total: number
			gain: ResourceHandType
			playerName: string
			meIsFortuneTeller: boolean
		}[]
	>([])
	const lastSeenFtIndexRef = useRef<number | null>(null)
	useEffect(() => {
		if (!game) return
		const events = (game.events ?? []) as GameEvent[]
		if (lastSeenFtIndexRef.current === null) {
			lastSeenFtIndexRef.current = events.length
			return
		}
		if (events.length === lastSeenFtIndexRef.current) return
		const newEvents = events.slice(lastSeenFtIndexRef.current)
		const queued: typeof ftAnimQueue = []
		for (const e of newEvents) {
			if (e?.kind !== 'fortune_teller_roll') continue
			const gainCount = RESOURCES.reduce(
				(n, r) => n + (e.gain[r] ?? 0),
				0
			)
			if (gainCount <= 0) continue
			const playerName =
				profilesById[game.player_order[e.player]]?.username ?? 'Player'
			queued.push({
				key: e.at + ':' + e.player,
				dice: e.dice,
				total: e.total,
				gain: e.gain,
				playerName,
				meIsFortuneTeller: e.player === meIdx,
			})
		}
		lastSeenFtIndexRef.current = events.length
		if (queued.length > 0) setFtAnimQueue((q) => [...q, ...queued])
	}, [game, meIdx, profilesById])
	const ftAnim = ftAnimQueue[0] ?? null

	const inBonusSelection =
		game?.status === 'placement' && gameState?.phase.kind === 'select_bonus'
	const inPlacement =
		game?.status === 'placement' &&
		gameState?.phase.kind === 'initial_placement'
	const inPostPlacement =
		game?.status === 'active' && gameState?.phase.kind === 'post_placement'
	// The active board tool for the local player during post_placement. Every
	// start-of-game bonus resolves after specialists declare (their overlay
	// blocks the board first). One bonus per player, so at most one applies.
	const postPlacementTool: BoardTool | null =
		inPostPlacement && gameState?.phase.kind === 'post_placement'
			? gameState.phase.pending.specialist.length > 0
				? null
				: (gameState.phase.pending.explorer?.[meIdx] ?? 0) > 0
					? 'explorer_road'
					: (gameState.phase.pending.fencer?.[meIdx] ?? 0) > 0
						? 'fence_token'
						: (gameState.phase.pending.haunt ?? []).includes(meIdx)
							? 'haunt_spot'
							: null
			: null
	const inMainLoop =
		game?.status === 'active' &&
		(gameState?.phase.kind === 'roll' || gameState?.phase.kind === 'main')
	const phaseKind = gameState?.phase.kind
	const inRobberFlow =
		game?.status === 'active' &&
		(phaseKind === 'discard' ||
			phaseKind === 'move_robber' ||
			phaseKind === 'steal')
	const inRoadBuilding =
		game?.status === 'active' && phaseKind === 'road_building'
	// Both endings, so a canceled game stops the board and shows the overlay
	// exactly as a completed one does.
	const inGameOver = isFinished(game?.status ?? '')

	// Undo availability is read straight off the snapshot the edge function
	// stashed before the last undoable action — deriving it from the event log
	// would drift from the server's own rule. The phase test adds the one thing
	// the server can't see: whether this seat is the one currently holding the
	// floor, which is `current_turn` in `main` but the queue head in
	// `special_build`.
	const canUndo =
		!!gameState?.undo &&
		gameState.undo.player === meIdx &&
		!isSpectator &&
		!inGameOver &&
		(phaseKind === 'main'
			? isMyActiveTurn
			: phaseKind === 'special_build'
				? isMySpecialBuild
				: inPostPlacement)

	// Forfeiting / ending. Both are plain user-id arrays on the games row with
	// no mechanical effect — see `.claude/specs/forfeit-and-end-game.md`. The
	// menu lives in the nav (`GameMenu`), which is why these hang off the
	// screen context rather than a zone.
	const forfeitedIds = game?.forfeits ?? []
	const endVoteIds = game?.end_votes ?? []
	const myForfeit = !!user && forfeitedIds.includes(user.id)
	const myEndVote = !!user && endVoteIds.includes(user.id)
	const canEndGame = !isSpectator && meIdx >= 0 && !inGameOver

	// Button enablement: only when it's my main-phase turn, I can afford the
	// cost (standard or bricklayer alt), AND there is at least one valid
	// spot on the board.
	const myHand = gameState?.players[meIdx]?.resources ?? null
	const myPlayer = gameState && meIdx >= 0 ? gameState.players[meIdx] : null
	// Hand-set on the player row for testing; unlocks the force-roll picker.
	const isDev = myPlayer?.dev === true

	// Forger: the token move is compulsory and gates the roll, so the board
	// pulses the valid hexes on its own — there is no affordance to open. The
	// server enforces the same gate in `handleRoll`.
	const forgerMustMove =
		!!gameState &&
		isMyActiveTurn &&
		gameState.phase.kind === 'roll' &&
		!gameState.phase.pending?.dice &&
		!!myPlayer &&
		mustMoveForgerToken(myPlayer)
	const forgerTokenFrom =
		forgerMustMove && myPlayer && gameState
			? forgerTokenHex(myPlayer, gameState.robber)
			: null

	async function onPickBonus(bonus: BonusId, curse: CurseId) {
		if (!game) return
		setSubmitting(true)
		const res = await pickBonus(game.id, bonus, curse)
		setSubmitting(false)
		if (res.error) notify('Pick failed', res.error)
	}

	async function onSetSpecialistResource(resource: Resource) {
		if (!game) return
		setSubmitting(true)
		const res = await setSpecialistResource(game.id, resource)
		setSubmitting(false)
		if (res.error) notify('Declare failed', res.error)
	}

	async function onBuyCarpenterVP() {
		if (!game) return
		setSubmitting(true)
		const res = await buyCarpenterVP(game.id)
		setSubmitting(false)
		if (res.error) notify('Purchase failed', res.error)
	}

	async function onTapKnight(r1: Resource, r2: Resource) {
		if (!game) return
		setSubmitting(true)
		const res = await tapKnight(game.id, r1, r2)
		setSubmitting(false)
		if (res.error) notify('Tap failed', res.error)
	}

	async function onRitualRoll(discard: ResourceHandType, total: number) {
		if (!game) return
		setSubmitting(true)
		const res = await ritualRoll(game.id, discard, total)
		setSubmitting(false)
		if (res.error) notify('Ritual failed', res.error)
		else setRitualOpen(false)
	}

	async function onShepherdSwap(take: [Resource, Resource]) {
		if (!game) return
		setSubmitting(true)
		const res = await shepherdSwap(game.id, take)
		setSubmitting(false)
		if (res.error) notify('Swap failed', res.error)
		else setShepherdOpen(false)
	}

	async function onClaimCurio(take: [Resource, Resource, Resource]) {
		if (!game) return
		setSubmitting(true)
		const res = await claimCurio(game.id, take)
		setSubmitting(false)
		if (res.error) notify('Claim failed', res.error)
	}

	function onMoveForgerTokenRequest(hex: Hex) {
		if (!game) return
		confirmAction('Move forger token here?', async () => {
			setSubmitting(true)
			const res = await moveForgerToken(game.id, hex)
			setSubmitting(false)
			if (res.error) notify('Move failed', res.error)
		})
	}

	async function onPickForgerTarget(target: number) {
		if (!game) return
		setSubmitting(true)
		const res = await pickForgerTarget(game.id, target)
		setSubmitting(false)
		if (res.error) notify('Pick failed', res.error)
	}

	async function onConfirmScoutCard(index: number) {
		if (!game) return
		setSubmitting(true)
		const res = await confirmScoutCard(game.id, index)
		setSubmitting(false)
		if (res.error) notify('Pick failed', res.error)
	}

	async function onLiquidate(target: LiquidationTarget) {
		if (!game) return
		setSubmitting(true)
		// The picker carries an `id` for dev_card target rows so the player
		// can see what they're dropping; the edge wants only kind+index.
		const payload =
			target.kind === 'dev_card'
				? { kind: 'dev_card' as const, index: target.index }
				: target
		const res = await liquidate(game.id, payload)
		setSubmitting(false)
		if (res.error) notify('Liquidate failed', res.error)
		else setAccountantOpen(false)
	}

	async function onPlaceExplorerRoad(edge: string) {
		if (!game) return
		setSubmitting(true)
		const res = await placeExplorerRoad(game.id, edge)
		setSubmitting(false)
		if (res.error) notify('Placement failed', res.error)
	}

	async function onPlaceFenceToken(edge: string) {
		if (!game) return
		setSubmitting(true)
		const res = await placeFenceToken(game.id, edge)
		setSubmitting(false)
		if (res.error) notify('Placement failed', res.error)
	}

	async function onSetHauntSpots(spots: [string, string]) {
		if (!game) return
		setSubmitting(true)
		const res = await setHauntSpots(game.id, spots)
		setSubmitting(false)
		if (res.error) notify('Haunt failed', res.error)
		else setHauntPicks([])
	}

	async function onInvest(resource: Resource) {
		if (!game) return
		setSubmitting(true)
		const res = await invest(game.id, resource)
		setSubmitting(false)
		if (res.error) notify('Invest failed', res.error)
		else setInvestOpen(false)
	}

	async function onCastMagic(target: number, discard: ResourceHandType) {
		if (!game) return
		setSubmitting(true)
		const res = await castMagic(game.id, target, discard)
		setSubmitting(false)
		if (res.error) notify('Magic failed', res.error)
	}

	async function onSkipMagic() {
		if (!game) return
		setSubmitting(true)
		const res = await skipMagic(game.id)
		setSubmitting(false)
		if (res.error) notify('Skip failed', res.error)
	}

	async function onUndo() {
		if (!game) return
		setSubmitting(true)
		const res = await undo(game.id)
		setSubmitting(false)
		if (res.error) notify('Undo failed', res.error)
		else {
			// The board state the tools were selected against is gone.
			setBuildTool(null)
			setSelection(null)
		}
	}

	async function onBuildSuperCity(vertex: string, swapDelta: number) {
		if (!game) return
		setSubmitting(true)
		const res = await buildSuperCity(game.id, vertex, swapDelta)
		setSubmitting(false)
		if (res.error) {
			notify('Upgrade failed', res.error)
			return
		}
		setBuildTool(null)
		setMetroPending(null)
	}

	// Metropolitan's wheat→ore swap picker resolves for both build kinds it
	// can front: a super city goes through its own action, a city is just a
	// normal build carrying the chosen swap.
	async function onConfirmMetropolitanCost(swapDelta: number) {
		if (!metroPending) return
		if (metroPending.kind === 'super_city') {
			await onBuildSuperCity(metroPending.vertex, swapDelta)
			return
		}
		if (!game) return
		setSubmitting(true)
		const res = await buildCity(game.id, metroPending.vertex, { swapDelta })
		setSubmitting(false)
		if (res.error) {
			notify('Build failed', res.error)
			return
		}
		setMetroPending(null)
		setBuildTool(null)
	}

	async function onConfirm() {
		if (!selection || !game) return
		const pickingLast =
			gameState?.phase.kind === 'initial_placement' &&
			gameState.phase.step === 'pick_last'
		setSubmitting(true)
		const res =
			pickingLast && selection.kind === 'settlement'
				? await chooseLastSettlement(game.id, selection.vertex)
				: selection.kind === 'settlement'
					? await placeSettlement(game.id, selection.vertex)
					: await placeRoad(game.id, selection.edge)
		setSubmitting(false)
		if (res.error) {
			notify('Placement failed', res.error)
			return
		}
		setSelection(null)
	}

	async function onRoll() {
		if (!game) return
		setSubmitting(true)
		const res = await roll(
			game.id,
			isDev ? (devRollTotal ?? undefined) : undefined
		)
		setSubmitting(false)
		if (res.error) notify('Roll failed', res.error)
	}

	async function onConfirmRoll(which?: 0 | 1) {
		if (!game) return
		setSubmitting(true)
		const res = await confirmRoll(game.id, which)
		setSubmitting(false)
		if (res.error) notify('Confirm failed', res.error)
	}

	async function onRerollDice() {
		if (!game) return
		setSubmitting(true)
		const res = await rerollDice(game.id)
		setSubmitting(false)
		if (res.error) notify('Reroll failed', res.error)
	}

	async function onEndTurn() {
		if (!game) return
		setSubmitting(true)
		const res = await endTurn(game.id)
		setSubmitting(false)
		if (res.error) notify(res.error)
	}

	async function onHonk() {
		if (!game) return
		setSubmitting(true)
		const res = await honk(game.id)
		setSubmitting(false)
		if (res.error) notify(res.error)
	}

	async function onEndSpecialBuild() {
		if (!game) return
		setSubmitting(true)
		const res = await endSpecialBuild(game.id)
		setSubmitting(false)
		if (res.error) notify(res.error)
	}

	async function onSetForfeit(on: boolean) {
		if (!game) return
		setSubmitting(true)
		const res = await setForfeit(game.id, on)
		setSubmitting(false)
		if (res.error) notify(res.error)
	}

	async function onSetEndVote(on: boolean) {
		if (!game) return
		setSubmitting(true)
		const res = await setEndVote(game.id, on)
		setSubmitting(false)
		if (res.error) notify(res.error)
	}

	async function onBuyDevCard() {
		if (!game || !myPlayer) return
		// A scout may pay with a swapped resource. If more than one payment
		// route is affordable, let them choose which cards to spend; a lone
		// route is submitted automatically.
		if (myPlayer.bonus === 'scout') {
			const options = affordableScoutSwaps(myPlayer.resources)
			if (options.length > 1) {
				setScoutCostOpen(true)
				return
			}
			return submitBuyDevCard(options[0] ?? null)
		}
		return submitBuyDevCard(null)
	}

	async function submitBuyDevCard(scoutSwap: ScoutSwap | null) {
		if (!game) return
		setSubmitting(true)
		const smith = myPlayer?.bonus === 'smith'
		const use =
			!smith && !scoutSwap && myPlayer
				? shouldUseBricklayer(myPlayer, 'dev_card')
				: false
		const smithSwap =
			smith && myPlayer ? smithSwapFor(myPlayer, 'dev_card') : 0
		const res = await buyDevCard(
			game.id,
			use,
			scoutSwap ?? undefined,
			smithSwap
		)
		setSubmitting(false)
		setScoutCostOpen(false)
		if (res.error) notify('Buy failed', res.error)
	}

	async function onPlayDevCard(payload: DevPlayPayload) {
		if (!game) return
		setSubmitting(true)
		let res
		if (payload.id === 'year_of_plenty') {
			res = await playDevCard(game.id, payload.id, {
				r1: payload.r1,
				r2: payload.r2,
			})
		} else if (payload.id === 'monopoly') {
			res = await playDevCard(game.id, payload.id, {
				resource: payload.resource,
			})
		} else {
			res = await playDevCard(game.id, payload.id)
		}
		setSubmitting(false)
		if (res.error) notify('Play failed', res.error)
	}

	function onBuildToolSelect(tool: BuildKind | 'super_city') {
		setBuildTool((prev) => (prev === tool ? null : tool))
	}

	function onBuildSpotSelect(sel: BuildSelection) {
		// Explorer free-road placement bypasses the confirm bar (the post-
		// placement layer is informational; just commit).
		if (sel.kind === 'explorer_road') {
			onPlaceExplorerRoad(sel.edge)
			return
		}
		// Fencer: tapping an empty edge drops a reserve token immediately.
		if (sel.kind === 'fence_token') {
			onPlaceFenceToken(sel.edge)
			return
		}
		// Haunt: toggle the tapped vertex in the local 2-spot selection; the
		// banner's Confirm button commits both at once.
		if (sel.kind === 'haunt_spot') {
			setHauntPicks((prev) =>
				prev.includes(sel.vertex)
					? prev.filter((v) => v !== sel.vertex)
					: prev.length >= 2
						? prev
						: [...prev, sel.vertex]
			)
			return
		}
		// Metropolitan: route city / super_city through the wheat→ore picker
		// so the player can choose how to pay.
		if (
			(sel.kind === 'city' || sel.kind === 'super_city') &&
			myPlayer?.bonus === 'metropolitan'
		) {
			setMetroPending({ kind: sel.kind, vertex: sel.vertex })
			return
		}
		// At this point sel is one of road/settlement/city (the non-
		// metropolitan branch). Narrow for confirmAction + commitBuild.
		if (sel.kind === 'super_city') return
		const standardSel = sel
		confirmAction(
			confirmBuildTitle(standardSel.kind),
			() => commitBuild(standardSel),
			standardSel
		)
	}

	async function commitBuild(
		sel: Exclude<
			BuildSelection,
			| { kind: 'explorer_road' }
			| { kind: 'super_city' }
			| { kind: 'fence_token' }
			| { kind: 'haunt_spot' }
		>
	) {
		if (!game || !gameState) return
		setSubmitting(true)
		// Smith pays with a brick↔ore swap; everyone else may fall back to the
		// bricklayer alt cost. One bonus per player, so these never combine.
		const buildOpts = (
			kind: PurchaseKind
		): { useBricklayer?: boolean; smithSwap?: number } =>
			myPlayer?.bonus === 'smith'
				? { smithSwap: smithSwapFor(myPlayer, kind) }
				: {
						useBricklayer: myPlayer
							? shouldUseBricklayer(myPlayer, kind)
							: false,
					}
		let res
		if (sel.kind === 'road') {
			// Fencer building on their own reserved edge → 1-card discount.
			const onOwnFence =
				myPlayer?.bonus === 'fencer' &&
				fenceOwner(gameState, sel.edge) === meIdx
			res = onOwnFence
				? await buildRoad(game.id, sel.edge, {
						fencePay:
							myPlayer!.resources.wood > 0 ? 'wood' : 'brick',
					})
				: await buildRoad(game.id, sel.edge, buildOpts('road'))
		} else if (sel.kind === 'settlement') {
			res = await buildSettlement(
				game.id,
				sel.vertex,
				buildOpts('settlement')
			)
		} else {
			res = await buildCity(game.id, sel.vertex, buildOpts('city'))
		}
		setSubmitting(false)
		if (res.error) {
			notify('Build failed', res.error)
			return
		}
		setBuildTool(null)
	}

	async function onDiscard(selection: ResourceHandType) {
		if (!game) return
		setSubmitting(true)
		const res = await discard(game.id, selection)
		setSubmitting(false)
		if (res.error) notify('Discard failed', res.error)
	}

	function onMoveRobberRequest(hex: Hex) {
		if (!game) return
		confirmAction('Move robber here?', async () => {
			setSubmitting(true)
			const res = await moveRobber(game.id, hex)
			setSubmitting(false)
			if (res.error) notify('Move failed', res.error)
		})
	}

	function onStealRequest(victim: number) {
		if (!game) return
		const victimId = game.player_order[victim]
		const name = profilesById[victimId]?.username ?? 'player'
		confirmAction(`Steal from ${name}?`, async () => {
			setSubmitting(true)
			const res = await steal(game.id, victim)
			setSubmitting(false)
			if (res.error) notify('Steal failed', res.error)
		})
	}

	function onTradePress() {
		if (!game) return
		// If we have a live offer we proposed, tapping the Trade button cancels
		// it outright. Otherwise we toggle the compose panel.
		if (liveOffer && liveOffer.from === meIdx) {
			;(async () => {
				setSubmitting(true)
				const res = await cancelTrade(game.id, liveOffer.id)
				setSubmitting(false)
				if (res.error) notify(res.error)
			})()
			return
		}
		setTradePanelOpen((prev) => !prev)
	}

	async function onProposeTrade(
		give: ResourceHandType,
		receive: ResourceHandType,
		to: number[]
	) {
		if (!game) return
		setSubmitting(true)
		const res = await proposeTrade(game.id, give, receive, to)
		setSubmitting(false)
		if (res.error) notify('Trade failed', res.error)
	}

	async function onAcceptTrade() {
		if (!game || !liveOffer) return
		setSubmitting(true)
		const res = await acceptTrade(game.id, liveOffer.id)
		setSubmitting(false)
		if (res.error) notify('Accept failed', res.error)
	}

	async function onCancelTrade() {
		if (!game || !liveOffer) return
		setSubmitting(true)
		const res = await cancelTrade(game.id, liveOffer.id)
		setSubmitting(false)
		if (res.error) notify(res.error)
	}

	async function onRejectTrade() {
		if (!game || !liveOffer) return
		setSubmitting(true)
		const res = await rejectTrade(game.id, liveOffer.id)
		setSubmitting(false)
		if (res.error) notify('Reject failed', res.error)
	}

	async function onConfirmTrade(accepterIdx: number) {
		if (!game || !liveOffer) return
		setSubmitting(true)
		const res = await confirmTrade(game.id, liveOffer.id, accepterIdx)
		setSubmitting(false)
		if (res.error) notify('Confirm failed', res.error)
	}

	async function onBankTrade(
		give: ResourceHandType,
		receive: ResourceHandType,
		merchant?: {
			resource: Resource
			count: number
			take: ResourceHandType
		}
	) {
		if (!game) return
		setSubmitting(true)
		const res = await bankTrade(game.id, give, receive, merchant)
		setSubmitting(false)
		if (res.error) notify('Bank trade failed', res.error)
		else setTradePanelOpen(false)
	}

	const canBuildThisTurn =
		isMyActiveTurn && gameState?.phase.kind === 'main' && !!myHand
	// During a special-build slot the same road/settlement/city/dev/bank actions
	// are open to the acting builder, subject to the `moreThanSeven` gate.
	const sbBuildAllowed =
		isMySpecialBuild &&
		!!myHand &&
		!!myPlayer &&
		(!gameState!.config.extraBuild.moreThanSeven || handSize(myPlayer) > 7)
	const canBuildBasic = canBuildThisTurn || sbBuildAllowed
	// Legal targets are computed once: they gate the build buttons and also
	// tell curseBuildReason whether a per-location curse is what's blocking.
	const hasLegalTarget = {
		road: !!gameState && validBuildRoadEdges(gameState, meIdx).length > 0,
		settlement:
			!!gameState &&
			validBuildSettlementVertices(gameState, meIdx).length > 0,
		city:
			!!gameState && validBuildCityVertices(gameState, meIdx).length > 0,
		dev_card: true,
	}
	const buildEnabled = {
		road:
			canBuildBasic &&
			!!myPlayer &&
			canAffordPurchase(myPlayer, 'road') &&
			hasLegalTarget.road,
		settlement:
			canBuildBasic &&
			!!myPlayer &&
			canAffordPurchase(myPlayer, 'settlement') &&
			hasLegalTarget.settlement,
		city:
			canBuildBasic &&
			!!myPlayer &&
			canAffordPurchase(myPlayer, 'city') &&
			hasLegalTarget.city,
		dev_card:
			!!gameState &&
			canBuyDevCard(gameState, meIdx, game?.current_turn ?? -1),
	}
	const buildCurseHints: BuildCurseHints = (() => {
		if (!gameState || meIdx < 0) return {}
		const out: BuildCurseHints = {}
		for (const kind of [
			'road',
			'settlement',
			'city',
			'dev_card',
		] as const) {
			const hint = curseBuildReason(
				gameState,
				meIdx,
				kind,
				hasLegalTarget[kind]
			)
			if (hint) out[kind] = hint
		}
		return out
	})()

	const hasLiveTrade = !!liveOffer
	const liveTradeIsMine = !!liveOffer && liveOffer.from === meIdx
	// Trading — player and bank/port alike — is a main-turn action only. A
	// special-build slot is build/buy, so the Trade button stays off there.
	const tradeButtonEnabled =
		canBuildThisTurn && !hasLiveTrade && !tradePanelOpen
	const tradeButtonActive = tradePanelOpen || liveTradeIsMine

	// Set-2 build-bar enablement.
	const superCityCanAfford =
		!!myPlayer &&
		(canAffordMetropolitanCost(myPlayer, 0) ||
			canAffordMetropolitanCost(myPlayer, 1) ||
			canAffordMetropolitanCost(myPlayer, 2))
	const superCityEnabled =
		canBuildThisTurn &&
		!!gameState &&
		!!myPlayer &&
		myPlayer.bonus === 'metropolitan' &&
		canBuildMoreSuperCities(gameState, meIdx) &&
		validBuildSuperCityVertices(gameState, meIdx).length > 0 &&
		superCityCanAfford
	const accountantEnabled =
		canBuildThisTurn && !!myPlayer && myPlayer.bonus === 'accountant'
	const investorEnabled =
		canBuildThisTurn &&
		!!myPlayer &&
		RESOURCES.some((r) =>
			canInvest(
				myPlayer,
				r,
				selfVP[meIdx],
				gameSizeFor(gameState?.players.length ?? 0)
			)
		)

	const bonusSelectionData =
		inBonusSelection && game && gameState?.phase.kind === 'select_bonus'
			? {
					phaseHands: gameState.phase.hands,
					myHand:
						meIdx >= 0 ? gameState.phase.hands[meIdx] : undefined,
					waitingOn: game.player_order
						.map((uid, i) => ({ uid, i }))
						.filter(({ i }) => {
							if (
								!gameState ||
								gameState.phase.kind !== 'select_bonus'
							)
								return false
							return gameState.phase.hands[i]?.chosen == null
						})
						.filter(({ i }) => i !== meIdx)
						.map(
							({ uid }) => profilesById[uid]?.username ?? 'Player'
						),
				}
			: null

	return {
		// --- Loaded game -----------------------------------------------
		game,
		gameState,
		ready,
		gameTabIndex,
		gameTabCount,
		meId: user?.id,
		meIdx,
		myHand,
		myPlayer,
		isDev,
		devRollTotal,
		setDevRollTotal,
		profilesById,
		isSpectator,
		publicVP,
		selfVP,
		displayVP,

		// --- Phase flags -----------------------------------------------
		isCurrentPlayer,
		isMyPlacementTurn,
		isMyActiveTurn,
		isMySpecialBuild,
		inBonusSelection,
		inPlacement,
		inPostPlacement,
		inMainLoop,
		inRobberFlow,
		inRoadBuilding,
		inGameOver,
		forgerMustMove,
		forgerTokenFrom,

		// --- Forfeiting / ending ---------------------------------------
		playerCount,
		forfeitedIds,
		endVoteIds,
		myForfeit,
		myEndVote,
		canEndGame,
		canUndo,
		postPlacementTool,
		liveOffer,
		bonusSelectionData,

		// --- Build / trade bar enablement ------------------------------
		buildEnabled,
		buildCurseHints,
		canBuildThisTurn,
		tradeButtonEnabled,
		tradeButtonActive,
		superCityEnabled,
		accountantEnabled,
		investorEnabled,

		// --- Local UI state --------------------------------------------
		submitting,
		selection,
		setSelection,
		buildTool,
		tradePanelOpen,
		setTradePanelOpen,
		pendingConfirm,
		setPendingConfirm,
		runPendingConfirm,
		hauntPicks,
		openPlayerIdx,
		setOpenPlayerIdx,
		boardTop,
		setBoardTop,
		bonusPaneCollapsed,
		setBonusPaneCollapsed,
		gameOverOpen,
		setGameOverOpen,
		ritualOpen,
		setRitualOpen,
		shepherdOpen,
		setShepherdOpen,
		accountantOpen,
		setAccountantOpen,
		scoutCostOpen,
		setScoutCostOpen,
		investOpen,
		setInvestOpen,
		metroPending,
		setMetroPending,

		// --- Animations -------------------------------------------------
		stealAnim,
		dismissStealAnim: () => setStealAnim(null),
		nomadAnim,
		dismissNomadAnim: () => setNomadAnimQueue((q) => q.slice(1)),
		ftAnim,
		dismissFtAnim: () => setFtAnimQueue((q) => q.slice(1)),

		// --- Actions ----------------------------------------------------
		onPickBonus,
		onSetSpecialistResource,
		onBuyCarpenterVP,
		onTapKnight,
		onRitualRoll,
		onShepherdSwap,
		onClaimCurio,
		onMoveForgerTokenRequest,
		onPickForgerTarget,
		onConfirmScoutCard,
		onLiquidate,
		onSetHauntSpots,
		onInvest,
		onCastMagic,
		onSkipMagic,
		onUndo,
		onConfirmMetropolitanCost,
		onConfirm,
		onRoll,
		onConfirmRoll,
		onRerollDice,
		onEndTurn,
		onHonk,
		onEndSpecialBuild,
		onSetForfeit,
		onSetEndVote,
		onBuyDevCard,
		submitBuyDevCard,
		onPlayDevCard,
		onBuildToolSelect,
		onBuildSpotSelect,
		onDiscard,
		onMoveRobberRequest,
		onStealRequest,
		onTradePress,
		onProposeTrade,
		onAcceptTrade,
		onCancelTrade,
		onRejectTrade,
		onConfirmTrade,
		onBankTrade,
	}
}

// Recover the stolen resource by diffing the victim's hand pre/post a
// `stolen` event. Returns null unless the diff looks like a steal and nothing
// else: exactly one resource down by exactly one card. Any gain, any bigger
// drop, or a second dropped resource means an unrelated hand change (a build,
// a bank trade, a discard) is layered on top and the steal is unrecoverable —
// answering anyway would attribute a random resource to the steal.
// The settlement a seat placed on round 2 — the one today's rules pay out on,
// and so the default answer on the `pick_last` step. Nominating it is a no-op
// server-side; nominating the other swaps the pair in the log.
function roundTwoSettlementOf(
	events: GameEvent[],
	playerIdx: number
): string | null {
	for (let i = events.length - 1; i >= 0; i--) {
		const e = events[i]
		if (
			e.kind === 'settlement_placed' &&
			e.player === playerIdx &&
			e.round === 2
		)
			return e.vertex
	}
	return null
}

function diffStolenResource(
	before: ResourceHandType,
	after: ResourceHandType
): Resource | null {
	let stolen: Resource | null = null
	for (const r of RESOURCES) {
		const delta = (before[r] ?? 0) - (after[r] ?? 0)
		if (delta === 0) continue
		if (delta !== 1 || stolen !== null) return null
		stolen = r
	}
	return stolen
}

function confirmBuildTitle(kind: BuildKind): string {
	switch (kind) {
		case 'road':
			return 'Confirm road placement'
		case 'settlement':
			return 'Confirm settlement placement'
		case 'city':
			return 'Confirm city placement'
	}
}

// Best-effort error notice. Alert.alert is a no-op on react-native-web;
// fall back to window.alert there. Confirms live inline in the game view
// (see BoardArea's ConfirmBar) rather than as a modal.
function notify(title: string, message?: string) {
	if (Platform.OS === 'web') {
		if (typeof window !== 'undefined') {
			window.alert(message ? `${title}\n\n${message}` : title)
		}
		return
	}
	Alert.alert(title, message)
}
