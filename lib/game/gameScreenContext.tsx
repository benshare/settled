// Everything the game screen's three zones act on: local UI state, the flags
// derived from the current phase, and one handler per store action. The zones
// (TopArea / BoardArea / BottomArea) read it through `useGameScreen()` rather
// than a prop list, so an affordance moving from one bar to another is a
// change in one file instead of three prop chains.
//
// Must be mounted inside <GameProvider> — it builds on useGame().

import { applyLocalAction, isApplyError, projectQueue } from '@/lib/catan/apply'
import { totalVP } from '@/lib/catan/dev'
import type { LocalAction } from '@/lib/catan/types'
import { useAuth } from '@/lib/auth'
import { RESOURCES, type Hex, type Resource } from '@/lib/catan/board'
import type { BonusId, CurseId } from '@/lib/catan/bonuses'
import {
	affordableScoutSwaps,
	canBuildMoreSuperCities,
	canInvest,
	forgerTokenHex,
	isOwnFence,
	liquidatableTargets,
	mustMoveForgerToken,
	type LiquidationTarget,
	type ScoutSwap,
} from '@/lib/catan/bonus'
import {
	canAffordPurchase,
	canAffordMetropolitanCost,
	canBuildFence,
	handSize,
	payableBuildRoadEdges,
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
import {
	orderedPlacementPairs,
	placementPairsExpected,
	type PlacementDraftEntry,
} from '@/lib/catan/placement'
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
import { parsePlayPrefs, useProfileStore } from '@/lib/stores/useProfileStore'
import {
	createContext,
	useCallback,
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

// Each event-driven animation (steal, nomad, fortune teller) keeps a cursor
// into `games.events` so it fires only on events that land while the game is
// open. The cursor carries the game it belongs to because the header's tab
// strip switches games without remounting this provider — an untagged count
// survives the switch, and every event past it in the new game's log reads as
// new, replaying the whole game's animations back-to-back on load.
type EventCursor = { gameId: string; count: number } | null

// What the placement board is waiting on — stages of one locally-drafted turn
// ('ready' = every piece chosen, awaiting confirm). All local: `phase.step`
// stays 'settlement' for the whole turn. `null` outside initial placement.
export type PlacementStage = 'settlement' | 'road' | 'ready' | null

// Where a flush of the local queue stands. A transport failure retries the
// same batch on a backoff; a 4xx is the server refusing the moves themselves,
// which retrying can never fix — it stops and names what was refused so the
// player can undo back to something legal. Neither ever drops the queue.
// Growing pauses before resending an identical batch. After the last one the
// flush parks in `retrying` and waits for the player, rather than hammering a
// server that clearly isn't there.
const FLUSH_RETRY_DELAYS_MS = [1000, 3000, 8000]

export type FlushState =
	| { kind: 'idle' }
	| { kind: 'sending' }
	| { kind: 'retrying'; attempt: number; message: string }
	| { kind: 'rejected'; message: string }

// The one start-of-game bonus affordance this seat owes, or `waiting` when the
// only thing left is somebody else's. `null` outside post_placement, or once
// this seat is done and nobody is left to wait on.
export type PostPlacementData =
	| { kind: 'specialist'; waitingOn: string[] }
	| { kind: 'explorer'; remaining: number; waitingOn: string[] }
	// Every explorer road is placed but still only queued on this device.
	| { kind: 'explorer_confirm'; waitingOn: string[] }
	| { kind: 'haunt'; waitingOn: string[] }
	| { kind: 'waiting'; waitingOn: string[] }
	| null

// What the build bar's tool row has selected. Each entry drives a pulse layer
// on the board; `liquidate` is the accountant's, which marks their own pieces
// rather than empty spots and so is mutually exclusive with the build tools by
// construction.
export type BoardToolChoice =
	BuildKind | 'super_city' | 'fence' | 'liquidate' | null

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
	const {
		game,
		gameState: serverState,
		ready,
		seatColors,
		isSpectator,
	} = useGame()
	const switchableGames = useSwitchableGames()
	const profilesById = useGamesStore((s) => s.profilesById)
	const pickBonus = useGamesStore((s) => s.pickBonus)
	const placeStart = useGamesStore((s) => s.placeStart)
	const roll = useGamesStore((s) => s.roll)
	const confirmRoll = useGamesStore((s) => s.confirmRoll)
	const rerollDice = useGamesStore((s) => s.rerollDice)
	const endTurn = useGamesStore((s) => s.endTurn)
	const honk = useGamesStore((s) => s.honk)
	const endSpecialBuild = useGamesStore((s) => s.endSpecialBuild)
	const discard = useGamesStore((s) => s.discard)
	const moveRobber = useGamesStore((s) => s.moveRobber)
	const steal = useGamesStore((s) => s.steal)
	const proposeTrade = useGamesStore((s) => s.proposeTrade)
	const acceptTrade = useGamesStore((s) => s.acceptTrade)
	const cancelTrade = useGamesStore((s) => s.cancelTrade)
	const rejectTrade = useGamesStore((s) => s.rejectTrade)
	const confirmTrade = useGamesStore((s) => s.confirmTrade)
	const buyDevCard = useGamesStore((s) => s.buyDevCard)
	const playDevCard = useGamesStore((s) => s.playDevCard)
	const setSpecialistResource = useGamesStore((s) => s.setSpecialistResource)
	const ritualRoll = useGamesStore((s) => s.ritualRoll)
	const shepherdSwap = useGamesStore((s) => s.shepherdSwap)
	const claimCurio = useGamesStore((s) => s.claimCurio)
	const moveForgerToken = useGamesStore((s) => s.moveForgerToken)
	const pickForgerTarget = useGamesStore((s) => s.pickForgerTarget)
	const confirmScoutCard = useGamesStore((s) => s.confirmScoutCard)
	const setHauntSpots = useGamesStore((s) => s.setHauntSpots)
	const batch = useGamesStore((s) => s.batch)
	const setForfeit = useGamesStore((s) => s.setForfeit)
	const setEndVote = useGamesStore((s) => s.setEndVote)

	// The placement turn being drafted locally: a settlement, its road, and a
	// second pair for the seat that places both back-to-back. Nothing is sent
	// until the player confirms, which is what makes taking a piece back free.
	// `pickLast` is that seat's nomination of which settlement counts as its
	// second — null until they say, and Confirm stays disabled that whole time.
	const [placementDraft, setPlacementDraft] = useState<PlacementDraftEntry[]>(
		[]
	)
	const [pickLast, setPickLast] = useState<string | null>(null)
	const [submitting, setSubmitting] = useState(false)
	const [buildTool, setBuildTool] = useState<BoardToolChoice>(null)
	const [tradePanelOpen, setTradePanelOpen] = useState(false)
	const [ritualOpen, setRitualOpen] = useState(false)
	const [shepherdOpen, setShepherdOpen] = useState(false)
	const [scoutCostOpen, setScoutCostOpen] = useState(false)
	// When a city / super_city build is pending and the metropolitan
	// player can swap wheat→ore, this carries the picked vertex until the
	// swap modal resolves.
	const [metroPending, setMetroPending] = useState<
		| { kind: 'city'; vertex: string }
		| { kind: 'super_city'; vertex: string }
		| null
	>(null)
	// The three confirms that survive the local queue: move robber, steal, and
	// the forger's token move. All three are actions the player cannot take
	// back — everything undoable now answers "are you sure?" with the arrow
	// instead. See `.claude/specs/local-action-queue.md`.
	// The player's own opt-in confirm before a dev card buy (`play_prefs`). A
	// modal rather than the confirm bar above, since it names no board spot.
	const confirmDevCardBuy = parsePlayPrefs(
		useProfileStore((s) => s.profile?.play_prefs)
	).confirmDevCardBuy
	const [devBuyConfirmOpen, setDevBuyConfirmOpen] = useState(false)
	const [pendingConfirm, setPendingConfirm] = useState<{
		title: string
		run: () => void | Promise<void>
	} | null>(null)
	const [openPlayerIdx, setOpenPlayerIdx] = useState<number | null>(null)
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
	// A transient confirmation line. It hangs off the screen context because
	// what raises it (the nav's `GameMenu`) and what renders it (the screen
	// root, so it floats over every zone) are in different parts of the tree.
	const [toast, setToast] = useState<string | null>(null)

	function confirmAction(title: string, run: () => void | Promise<void>) {
		setPendingConfirm({ title, run })
	}

	async function runPendingConfirm() {
		if (!pendingConfirm) return
		const { run } = pendingConfirm
		setPendingConfirm(null)
		await run()
	}

	// The one way to arm, switch, or drop a board tool. Everything a tool has
	// raised goes with it: a confirm bar names a spot on a layer that is about
	// to disappear, and a metropolitan cost picker is a build that no longer
	// has a tool behind it. Both would otherwise stand there and still commit.
	function selectBoardTool(next: BoardToolChoice) {
		setBuildTool(next)
		setPendingConfirm(null)
		setMetroPending(null)
	}

	const meIdx = useMemo(() => {
		if (!game || !user) return -1
		return game.player_order.indexOf(user.id)
	}, [game, user])

	// --- The local action queue ---------------------------------------------
	//
	// Undoable actions are not sent when they are taken. They append here and
	// are folded onto the server row to produce `gameState` — which is what
	// every surface below (and every consumer of this context) reads, so the
	// board, the hand and every affordance agree about a build that only exists
	// on this device. The queue flushes as one `batch` at the next action that
	// isn't undoable. See `.claude/specs/local-action-queue.md`.
	//
	// Never persisted: leaving the screen or killing the app drops it, the same
	// way the placement draft already behaves.
	const [queue, setQueue] = useState<LocalAction[]>([])
	const [flushState, setFlushState] = useState<FlushState>({ kind: 'idle' })

	const projection = useMemo(
		() =>
			serverState
				? projectQueue(serverState, meIdx, queue)
				: { state: undefined, valid: 0 },
		[serverState, meIdx, queue]
	)
	// **The projection is the game state.** Shadowing the name is deliberate:
	// every reader in this file and every consumer of the context picks it up
	// without knowing the queue exists, which is the only way to guarantee no
	// surface is left reading a hand that can still afford a road the board
	// says is spent. `serverState` stays reachable for the two jobs that need
	// the truth — building the flush payload and rebasing.
	const gameState = projection.state

	// The server row moves under a pending queue (an opponent acting in the
	// parallel `post_placement` phase, a resync after backgrounding). Anything
	// that no longer applies is cut, newest-first, rather than the whole queue
	// being thrown away.
	useEffect(() => {
		if (projection.valid < queue.length) {
			setQueue((q) => q.slice(0, projection.valid))
			notify(
				'Some moves were undone',
				'The board changed before they were sent.'
			)
		}
	}, [projection.valid, queue.length])

	// VP is recomputed from the projection rather than taken from `useGame()`,
	// whose arrays are derived from the server row — a queued city has to move
	// the score, or the win cue below could never fire.
	const { publicVP, selfVP } = useMemo(() => {
		if (!gameState)
			return { publicVP: [] as number[], selfVP: [] as number[] }
		return {
			publicVP: gameState.players.map((_, i) =>
				totalVP(gameState, i, false)
			),
			selfVP: gameState.players.map((_, i) =>
				totalVP(gameState, i, true)
			),
		}
	}, [gameState])

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
		gameState?.currentTurn !== null &&
		gameState?.currentTurn === meIdx &&
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

	// Reset the draft when the turn or round changes under us.
	const placementKey =
		gameState?.phase.kind === 'initial_placement'
			? `${gameState?.currentTurn}-${gameState.phase.round}-${gameState.phase.step}`
			: null
	useEffect(() => {
		setPickLast(null)
		setPlacementDraft([])
	}, [placementKey])

	// How many settlement+road pairs this turn submits — two for the seat the
	// snake order hands both of its turns to back-to-back.
	const placementPairs: 1 | 2 =
		gameState?.phase.kind === 'initial_placement' && game
			? placementPairsExpected(
					gameState.phase.round,
					meIdx,
					game.player_order.length
				)
			: 1
	// The stage is a local derivation, not a server field: `phase.step` stays
	// 'settlement' for the whole of a drafted turn.
	const openPair = placementDraft[placementDraft.length - 1]
	const placementStage: PlacementStage =
		gameState?.phase.kind !== 'initial_placement'
			? null
			: openPair && openPair.edge === undefined
				? 'road'
				: placementDraft.length < placementPairs
					? 'settlement'
					: 'ready'
	// The back-to-back seat also says which settlement counts as its second —
	// the one that pays starting resources. An aristocrat collects on both, so
	// it has nothing to choose. See `.claude/specs/inline-last-settlement.md`.
	const canNominate =
		isMyPlacementTurn &&
		placementPairs === 2 &&
		gameState?.players[meIdx]?.bonus !== 'aristocrat'
	// Deliberately not seeded to the settlement drafted second: a default the
	// player never has to touch is one they never notice, which is exactly how
	// this choice used to get skipped. Resolved against the draft, so a
	// nomination for a vertex that has since been taken back clears itself.
	const nominatedVertex = canNominate
		? (placementDraft.find((e) => e.vertex === pickLast)?.vertex ?? null)
		: null
	// The nomination is the last thing owed at 'ready', and Confirm is blocked
	// on it — the only arrangement the flow can't carry the player past.
	const needsNomination =
		canNominate && placementStage === 'ready' && nominatedVertex === null
	const canUndoPlacement = isMyPlacementTurn && placementDraft.length > 0
	const canConfirmPlacement =
		isMyPlacementTurn && placementStage === 'ready' && !needsNomination

	// Clear build tool + trade panel when we can no longer build — the turn
	// flips away / we leave main, or a special-build slot passes to someone
	// else. The key also changes between distinct special-build slots so the
	// tool resets for each actor.
	const canActBuild =
		(gameState?.phase.kind === 'main' && isMyActiveTurn) || isMySpecialBuild
	const mainTurnKey = canActBuild
		? `${gameState?.currentTurn}-${gameState?.phase.kind}-${sbActor ?? ''}`
		: 'off'
	useEffect(() => {
		if (mainTurnKey === 'off') {
			selectBoardTool(null)
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

	// A pending confirm — and the metropolitan cost picker, which is the same
	// thing behind a sheet — is tied to the current phase/turn. If either flips
	// under us (realtime), drop it so its closure doesn't fire against the
	// wrong state.
	const confirmScopeKey = `${gameState?.currentTurn ?? 'x'}:${gameState?.phase.kind ?? 'x'}`
	useEffect(() => {
		setPendingConfirm(null)
		setMetroPending(null)
	}, [confirmScopeKey])

	// --- Held hand ---------------------------------------------------------
	// The three reveal animations below all fire *after* the resource has
	// reached the hand — the steal one recovers which resource it was by
	// diffing the hand, so it cannot fire any earlier — and their backdrop is
	// translucent, so the card sits legible under the roulette that is about to
	// reveal it. Each animation that moves the viewer's own hand therefore
	// registers the hand as it stood before, keyed the same way the animation
	// is; the fanned hand renders that until the animation dismisses.
	//
	// Only the viewer's own hand needs this. Every other seat is shown as a
	// card count, which never gave the resource away.
	const [heldHands, setHeldHands] = useState<
		{ key: string; hand: ResourceHandType }[]
	>([])
	useEffect(() => {
		setHeldHands([])
	}, [game?.id])
	const holdMyHand = useCallback(
		(key: string, hand: ResourceHandType | undefined) => {
			if (!hand) return
			setHeldHands((h) => [...h, { key, hand }])
		},
		[]
	)
	const releaseHold = useCallback((key: string | undefined) => {
		if (!key) return
		setHeldHands((h) => h.filter((entry) => entry.key !== key))
	}, [])
	// The viewer's hand as it stood before this render adopted a new state row —
	// what the nomad and fortune-teller animations hold, since (unlike the
	// steal) their events carry no pre-state to reconstruct it from. Advanced by
	// an effect declared *after* all three animation effects, so they read the
	// previous render's value rather than one they just moved past.
	const prevMyHandRef = useRef<ResourceHandType | undefined>(undefined)

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
	const lastSeenEventCountRef = useRef<EventCursor>(null)
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

		if (lastSeenEventCountRef.current?.gameId !== game.id) {
			lastSeenEventCountRef.current = {
				gameId: game.id,
				count: events.length,
			}
			prevPlayersRef.current = players
			pendingStealRef.current = null
			setStealAnim(null)
			return
		}

		const newEvents = events.slice(lastSeenEventCountRef.current.count)
		const stealEvent = newEvents.find(
			(e): e is Extract<GameEvent, { kind: 'stolen' }> =>
				e?.kind === 'stolen' &&
				(e.thief === meIdx || e.victim === meIdx)
		)
		lastSeenEventCountRef.current = {
			gameId: game.id,
			count: events.length,
		}

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

		const key =
			pending.event.at +
			':' +
			pending.event.thief +
			':' +
			pending.event.victim
		const meIsThief = pending.event.thief === meIdx

		setStealAnim({
			key,
			preHand: pending.preHand,
			stolen,
			thiefName,
			victimName,
			meIsThief,
		})
		// The diff only resolves once players[] carries the steal, so the
		// viewer's hand already shows it either way: a victim's pre-steal hand
		// is `preHand`, and a thief's is what they hold now less the card they
		// just took.
		if (meIsThief) {
			const mine = players[meIdx]?.resources
			holdMyHand(
				key,
				mine && {
					...mine,
					[stolen]: Math.max(0, (mine[stolen] ?? 0) - 1),
				}
			)
		} else {
			holdMyHand(key, pending.preHand)
		}
	}, [game, gameState, meIdx, profilesById, holdMyHand])

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
	const lastSeenNomadIndexRef = useRef<EventCursor>(null)
	useEffect(() => {
		if (!game) return
		const events = (game.events ?? []) as GameEvent[]
		if (lastSeenNomadIndexRef.current?.gameId !== game.id) {
			lastSeenNomadIndexRef.current = {
				gameId: game.id,
				count: events.length,
			}
			setNomadAnimQueue([])
			return
		}
		if (events.length === lastSeenNomadIndexRef.current.count) return
		const firstNew = lastSeenNomadIndexRef.current.count
		const newEvents = events.slice(firstNew)
		const queued: typeof nomadAnimQueue = []
		for (const [i, e] of newEvents.entries()) {
			if (e?.kind !== 'nomad_produce') continue
			const playerName =
				profilesById[game.player_order[e.player]]?.username ?? 'Player'
			// Event index, not timestamp — a nomad on two deserts produces
			// two events that can share a millisecond.
			const key = firstNew + i + ':' + e.player
			queued.push({
				key,
				produced: e.resource,
				count: e.count,
				playerName,
				meIsNomad: e.player === meIdx,
			})
			if (e.player === meIdx) holdMyHand(key, prevMyHandRef.current)
		}
		lastSeenNomadIndexRef.current = {
			gameId: game.id,
			count: events.length,
		}
		if (queued.length > 0) setNomadAnimQueue((q) => [...q, ...queued])
	}, [game, meIdx, profilesById, holdMyHand])
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
	const lastSeenFtIndexRef = useRef<EventCursor>(null)
	useEffect(() => {
		if (!game) return
		const events = (game.events ?? []) as GameEvent[]
		if (lastSeenFtIndexRef.current?.gameId !== game.id) {
			lastSeenFtIndexRef.current = {
				gameId: game.id,
				count: events.length,
			}
			setFtAnimQueue([])
			return
		}
		if (events.length === lastSeenFtIndexRef.current.count) return
		const newEvents = events.slice(lastSeenFtIndexRef.current.count)
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
			const key = e.at + ':' + e.player
			queued.push({
				key,
				dice: e.dice,
				total: e.total,
				gain: e.gain,
				playerName,
				meIsFortuneTeller: e.player === meIdx,
			})
			if (e.player === meIdx) holdMyHand(key, prevMyHandRef.current)
		}
		lastSeenFtIndexRef.current = { gameId: game.id, count: events.length }
		if (queued.length > 0) setFtAnimQueue((q) => [...q, ...queued])
	}, [game, meIdx, profilesById, holdMyHand])
	const ftAnim = ftAnimQueue[0] ?? null

	// Declared after all three animation effects on purpose: they read this to
	// learn the hand as it stood *before* the state row they are reacting to.
	useEffect(() => {
		prevMyHandRef.current = gameState?.players[meIdx]?.resources
	}, [gameState, meIdx])

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

	// The projection reached `game_over` on a move that hasn't been sent: this
	// client knows the game is won and the table doesn't. Deliberately not
	// auto-sent — the cue names what ending the turn would do, and undo still
	// reaches back past the winning move.
	const pendingWin =
		queue.length > 0 && gameState?.phase.kind === 'game_over' && !inGameOver

	// Undo pops the local queue, so availability is just "is there anything in
	// it". No phase test: the queue is this client's own, and a client only
	// appends to it in a phase it was allowed to act in — unlike the old server
	// snapshot, which was a property of the game and so had to ask whether this
	// seat still held the floor. See `.claude/specs/local-action-queue.md`.
	const canUndo = queue.length > 0 && !isSpectator && !inGameOver

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
	// What the fanned hand renders — `myHand` less anything a reveal animation
	// is still sitting on. A hold counts only while its own animation is in
	// flight, so a stranded entry can never leave the hand showing stale cards.
	// Everything else, affordability included, reads the live `myHand`, so a
	// hold can never disable a build the player can actually make.
	const liveAnimKeys = [
		stealAnim?.key,
		...nomadAnimQueue.map((a) => a.key),
		...ftAnimQueue.map((a) => a.key),
	]
	const displayHand =
		heldHands.find((h) => liveAnimKeys.includes(h.key))?.hand ?? myHand
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
		if (!(await flushBeforeBarrier())) return
		const res = await pickBonus(game.id, bonus, curse)
		setSubmitting(false)
		if (res.error) notify('Pick failed', res.error)
	}

	async function onSetSpecialistResource(resource: Resource) {
		if (!game) return
		if (!(await flushBeforeBarrier())) return
		const res = await setSpecialistResource(game.id, resource)
		setSubmitting(false)
		if (res.error) notify('Declare failed', res.error)
	}

	function onBuyCarpenterVP() {
		enqueue({ action: 'buy_carpenter_vp' })
	}

	function onTapKnight(r1: Resource, r2: Resource) {
		enqueue({ action: 'tap_knight', r1, r2 })
	}

	async function onRitualRoll(discard: ResourceHandType, total: number) {
		if (!game) return
		if (!(await flushBeforeBarrier())) return
		const res = await ritualRoll(game.id, discard, total)
		setSubmitting(false)
		if (res.error) notify('Ritual failed', res.error)
		else setRitualOpen(false)
	}

	async function onShepherdSwap(take: [Resource, Resource]) {
		if (!game) return
		if (!(await flushBeforeBarrier())) return
		const res = await shepherdSwap(game.id, take)
		setSubmitting(false)
		if (res.error) notify('Swap failed', res.error)
		else setShepherdOpen(false)
	}

	async function onClaimCurio(take: [Resource, Resource, Resource]) {
		if (!game) return
		if (!(await flushBeforeBarrier())) return
		const res = await claimCurio(game.id, take)
		setSubmitting(false)
		if (res.error) notify('Claim failed', res.error)
	}

	function onMoveForgerTokenRequest(hex: Hex) {
		if (!game) return
		confirmAction('Move forger token here?', async () => {
			if (!(await flushBeforeBarrier())) return
			const res = await moveForgerToken(game.id, hex)
			setSubmitting(false)
			if (res.error) notify('Move failed', res.error)
		})
	}

	async function onPickForgerTarget(target: number) {
		if (!game) return
		if (!(await flushBeforeBarrier())) return
		const res = await pickForgerTarget(game.id, target)
		setSubmitting(false)
		if (res.error) notify('Pick failed', res.error)
	}

	async function onConfirmScoutCard(index: number) {
		if (!game) return
		if (!(await flushBeforeBarrier())) return
		const res = await confirmScoutCard(game.id, index)
		setSubmitting(false)
		if (res.error) notify('Pick failed', res.error)
	}

	// No confirm bar any more: cashing in the wrong piece is now a tap of the
	// undo arrow. The refund the bar used to name is visible instead in the
	// hand, which jumps the moment the piece leaves the board.
	function onLiquidateSelect(target: LiquidationTarget) {
		if (enqueue({ action: 'liquidate', target })) selectBoardTool(null)
	}

	function onPlaceExplorerRoad(edge: string) {
		enqueue({ action: 'place_explorer_road', edge })
	}

	// The roads are queued like any build, but post_placement has no barrier
	// action of its own to carry them up — so the explorer sends them outright
	// once the last one is down.
	async function onConfirmExplorerRoads() {
		await flushBeforeBarrier()
		setSubmitting(false)
	}

	async function onSetHauntSpots(spots: [string, string]) {
		if (!game) return
		if (!(await flushBeforeBarrier())) return
		const res = await setHauntSpots(game.id, spots)
		setSubmitting(false)
		if (res.error) notify('Haunt failed', res.error)
		else setHauntPicks([])
	}

	function onInvest(resource: Resource) {
		if (enqueue({ action: 'invest', resource })) setInvestOpen(false)
	}

	function onCastMagic(target: number, discard: ResourceHandType) {
		enqueue({ action: 'cast_magic', target, discard })
	}

	function onSkipMagic() {
		enqueue({ action: 'skip_magic' })
	}

	function onBuildSuperCity(vertex: string, swapDelta: number) {
		if (
			!enqueue({
				action: 'build_super_city',
				vertex,
				swap_wheat_to_ore: swapDelta,
			})
		)
			return
		selectBoardTool(null)
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
		if (
			!enqueue({
				action: 'build_city',
				vertex: metroPending.vertex,
				swap_wheat_to_ore: swapDelta,
			})
		)
			return
		selectBoardTool(null)
	}

	// --- Queueing, flushing, undoing ----------------------------------------

	// Append one action to the local queue, after checking it against the
	// projection. Validating here means an illegal action never enters the
	// queue at all, so `projectQueue`'s truncation only ever fires on a rebase
	// — never on something this client chose.
	function enqueue(action: LocalAction): boolean {
		if (!gameState || meIdx < 0) return false
		const res = applyLocalAction(gameState, meIdx, action, '')
		if (isApplyError(res)) {
			notify("Can't do that", res.error)
			return false
		}
		setQueue((q) => [...q, action])
		return true
	}

	// Send the queue as one batch. Resolves only once it has landed or given
	// up; the queue is never dropped either way.
	async function flushQueue(): Promise<{ error: string | null }> {
		if (!game) return { error: null }
		const actions = queue
		if (actions.length === 0) return { error: null }
		setFlushState({ kind: 'sending' })
		for (let attempt = 0; ; attempt++) {
			const res = await batch(game.id, actions)
			if (!res.error) {
				// Slice by length rather than clearing: anything queued while
				// this was in flight is still owed.
				setQueue((q) => q.slice(actions.length))
				setFlushState({ kind: 'idle' })
				return { error: null }
			}
			const message = res.error
			if (!res.retriable) {
				// The server considered these moves and refused them. Sending
				// the same bytes again can only be refused again.
				setFlushState({ kind: 'rejected', message })
				return { error: message }
			}
			const delay = FLUSH_RETRY_DELAYS_MS[attempt]
			setFlushState({ kind: 'retrying', attempt: attempt + 1, message })
			if (delay === undefined) return { error: message }
			await new Promise((r) => setTimeout(r, delay))
		}
	}

	// Every action that isn't queued locally is a barrier: the queue goes up
	// first, and the action is abandoned if it can't — so nothing is ever
	// applied on top of a board the server never saw. Each barrier handler
	// below opens with this; `honk` and `send_message` deliberately don't,
	// being the same two the server treats as move-neutral. It raises
	// `submitting` up front, so the button spins while the queue sends, and
	// lowers it only on failure — on success the caller lowers it once its own
	// action lands.
	async function flushBeforeBarrier(): Promise<boolean> {
		setSubmitting(true)
		const flushed = await flushQueue()
		if (!flushed.error) return true
		setSubmitting(false)
		notify("Couldn't send your moves", flushed.error)
		return false
	}

	// A manual retry for a flush that ran out of attempts or was refused. The
	// rejected case is worth re-offering because the player may have undone
	// their way back to something legal in the meantime.
	async function onRetryFlush() {
		await flushQueue()
	}

	// Undo is `slice(0, -1)` and nothing else: the projection re-folds and the
	// board re-renders. Nothing was sent, so there is no failure mode and no
	// spinner — and no limit on how far back it goes within a turn.
	function onUndo() {
		setQueue((q) => q.slice(0, -1))
		// The board state a tool was armed against is gone.
		selectBoardTool(null)
	}

	// A board tap during placement: it appends to the locally-drafted turn, or
	// — once every piece is drafted, where the only tappable things are the
	// seat's own two settlements — nominates the one placed second.
	function onPlacementSelect(s: PlacementSelection) {
		if (placementStage === 'ready') {
			if (canNominate && s.kind === 'settlement') setPickLast(s.vertex)
			return
		}
		setPlacementDraft((draft) => {
			if (s.kind === 'settlement') return [...draft, { vertex: s.vertex }]
			const open = draft[draft.length - 1]
			if (!open || open.edge !== undefined) return draft
			return [...draft.slice(0, -1), { ...open, edge: s.edge }]
		})
	}

	// Takes back the last piece drafted — a road returns to road-picking, a
	// settlement to settlement-picking. Nothing has been sent, so this is local
	// state and not the server's undo.
	function onUndoPlacement() {
		setPlacementDraft((draft) => {
			const open = draft[draft.length - 1]
			if (!open) return draft
			return open.edge === undefined
				? draft.slice(0, -1)
				: [...draft.slice(0, -1), { vertex: open.vertex }]
		})
	}

	async function onConfirm() {
		if (!game || gameState?.phase.kind !== 'initial_placement') return
		// The nominated pair goes last, which is how the server is told: it
		// stamps the last pair round 2 and pays its starting resources.
		const pairs = orderedPlacementPairs(placementDraft, nominatedVertex)
		// The same conditions the confirm button is disabled on, so a stray call
		// can't half-submit a turn or submit an unnominated one in draft order.
		if (pairs.length !== placementPairs) return
		if (needsNomination) return

		if (!(await flushBeforeBarrier())) return
		const res = await placeStart(game.id, pairs)
		setSubmitting(false)
		if (res.error) {
			notify('Placement failed', res.error)
			return
		}
		setPickLast(null)
		setPlacementDraft([])
	}

	async function onRoll() {
		if (!game) return
		if (!(await flushBeforeBarrier())) return
		const res = await roll(
			game.id,
			isDev ? (devRollTotal ?? undefined) : undefined
		)
		setSubmitting(false)
		if (res.error) notify('Roll failed', res.error)
	}

	async function onConfirmRoll(which?: 0 | 1) {
		if (!game) return
		if (!(await flushBeforeBarrier())) return
		const res = await confirmRoll(game.id, which)
		setSubmitting(false)
		if (res.error) notify('Confirm failed', res.error)
	}

	async function onRerollDice() {
		if (!game) return
		if (!(await flushBeforeBarrier())) return
		const res = await rerollDice(game.id)
		setSubmitting(false)
		if (res.error) notify('Reroll failed', res.error)
	}

	async function onEndTurn() {
		if (!game) return
		// The batch itself ends the game (the server's fold reaches `game_over`
		// just as the projection did), so there is no turn left to end — an
		// `end_turn` after it would only be refused.
		if (pendingWin) {
			await flushBeforeBarrier()
			setSubmitting(false)
			return
		}
		if (!(await flushBeforeBarrier())) return
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
		if (!(await flushBeforeBarrier())) return
		const res = await endSpecialBuild(game.id)
		setSubmitting(false)
		if (res.error) notify(res.error)
	}

	async function onSetForfeit(on: boolean) {
		if (!game) return
		if (!(await flushBeforeBarrier())) return
		const res = await setForfeit(game.id, on)
		setSubmitting(false)
		if (res.error) notify(res.error)
	}

	async function onSetEndVote(on: boolean) {
		if (!game) return
		if (!(await flushBeforeBarrier())) return
		const res = await setEndVote(game.id, on)
		setSubmitting(false)
		if (res.error) notify(res.error)
	}

	async function onBuyDevCard() {
		if (!game || !myPlayer) return
		if (confirmDevCardBuy) {
			setDevBuyConfirmOpen(true)
			return
		}
		return startBuyDevCard()
	}

	async function onConfirmDevCardBuy() {
		setDevBuyConfirmOpen(false)
		return startBuyDevCard()
	}

	async function startBuyDevCard() {
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
		const smith = myPlayer?.bonus === 'smith'
		const use =
			!smith && !scoutSwap && myPlayer
				? shouldUseBricklayer(myPlayer, 'dev_card')
				: false
		const smithSwap =
			smith && myPlayer ? smithSwapFor(myPlayer, 'dev_card') : 0
		if (!(await flushBeforeBarrier())) return
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
		let res
		if (payload.id === 'year_of_plenty') {
			if (!(await flushBeforeBarrier())) return
			res = await playDevCard(game.id, payload.id, {
				r1: payload.r1,
				r2: payload.r2,
			})
		} else if (payload.id === 'monopoly') {
			if (!(await flushBeforeBarrier())) return
			res = await playDevCard(game.id, payload.id, {
				resource: payload.resource,
			})
		} else {
			if (!(await flushBeforeBarrier())) return
			res = await playDevCard(game.id, payload.id)
		}
		setSubmitting(false)
		if (res.error) notify('Play failed', res.error)
	}

	function onBuildToolSelect(tool: NonNullable<BoardToolChoice>) {
		selectBoardTool(buildTool === tool ? null : tool)
	}

	function onBuildSpotSelect(sel: BuildSelection) {
		if (sel.kind === 'explorer_road') {
			onPlaceExplorerRoad(sel.edge)
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
		// At this point sel is one of road/fence/settlement/city (the
		// non-metropolitan branch). Straight into the queue: there is no
		// confirm any more, because the undo arrow is the answer to "are you
		// sure" and it reaches back further than one step.
		if (sel.kind === 'super_city') return
		queueBuild(sel)
	}

	function queueBuild(
		sel: Exclude<
			BuildSelection,
			| { kind: 'explorer_road' }
			| { kind: 'super_city' }
			| { kind: 'haunt_spot' }
		>
	) {
		if (!gameState) return
		// Smith pays with a brick↔ore swap; everyone else may fall back to the
		// bricklayer alt cost. One bonus per player, so these never combine.
		// Resolved against the projection, so a second build this turn is
		// priced against what the first one already spent.
		const buildOpts = (
			kind: PurchaseKind
		): { use_bricklayer?: boolean; smith_swap?: number } =>
			myPlayer?.bonus === 'smith'
				? { smith_swap: smithSwapFor(myPlayer, kind) }
				: {
						use_bricklayer: myPlayer
							? shouldUseBricklayer(myPlayer, kind)
							: false,
					}
		const action: LocalAction =
			sel.kind === 'fence'
				? { action: 'build_fence', edge: sel.edge }
				: sel.kind === 'road'
					? // A road onto the fencer's own fence is priced by the
						// edge (1 brick), so no substitution payload applies.
						isOwnFence(gameState, sel.edge, meIdx)
						? { action: 'build_road', edge: sel.edge }
						: {
								action: 'build_road',
								edge: sel.edge,
								...buildOpts('road'),
							}
					: sel.kind === 'settlement'
						? {
								action: 'build_settlement',
								vertex: sel.vertex,
								...buildOpts('settlement'),
							}
						: {
								action: 'build_city',
								vertex: sel.vertex,
								...buildOpts('city'),
							}
		if (enqueue(action)) selectBoardTool(null)
	}

	async function onDiscard(selection: ResourceHandType) {
		if (!game) return
		if (!(await flushBeforeBarrier())) return
		const res = await discard(game.id, selection)
		setSubmitting(false)
		if (res.error) notify('Discard failed', res.error)
	}

	function onMoveRobberRequest(hex: Hex) {
		if (!game) return
		confirmAction('Move robber here?', async () => {
			if (!(await flushBeforeBarrier())) return
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
			if (!(await flushBeforeBarrier())) return
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
				if (!(await flushBeforeBarrier())) return
				const res = await cancelTrade(game.id, liveOffer.id)
				setSubmitting(false)
				if (res.error) notify(res.error)
			})()
			return
		}
		// Opening the composer hides the board's tool layers, so anything they
		// raised has to go with them — the same rule as putting a tool away.
		const opening = !tradePanelOpen
		setTradePanelOpen(opening)
		if (opening) {
			setPendingConfirm(null)
			setMetroPending(null)
		}
	}

	async function onProposeTrade(
		give: ResourceHandType,
		receive: ResourceHandType,
		to: number[]
	) {
		if (!game) return
		if (!(await flushBeforeBarrier())) return
		const res = await proposeTrade(game.id, give, receive, to)
		setSubmitting(false)
		if (res.error) notify('Trade failed', res.error)
	}

	async function onAcceptTrade() {
		if (!game || !liveOffer) return
		if (!(await flushBeforeBarrier())) return
		const res = await acceptTrade(game.id, liveOffer.id)
		setSubmitting(false)
		if (res.error) notify('Accept failed', res.error)
	}

	async function onCancelTrade() {
		if (!game || !liveOffer) return
		if (!(await flushBeforeBarrier())) return
		const res = await cancelTrade(game.id, liveOffer.id)
		setSubmitting(false)
		if (res.error) notify(res.error)
	}

	async function onRejectTrade() {
		if (!game || !liveOffer) return
		if (!(await flushBeforeBarrier())) return
		const res = await rejectTrade(game.id, liveOffer.id)
		setSubmitting(false)
		if (res.error) notify('Reject failed', res.error)
	}

	async function onConfirmTrade(accepterIdx: number) {
		if (!game || !liveOffer) return
		if (!(await flushBeforeBarrier())) return
		const res = await confirmTrade(game.id, liveOffer.id, accepterIdx)
		setSubmitting(false)
		if (res.error) notify('Confirm failed', res.error)
	}

	function onBankTrade(give: ResourceHandType, receive: ResourceHandType) {
		if (enqueue({ action: 'bank_trade', give, receive }))
			setTradePanelOpen(false)
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
		// A fencer short of Wood + Brick can still build — but only the 1-brick
		// upgrade on their own fences, so gate on the payable set rather than
		// the standard cost.
		road:
			canBuildBasic &&
			!!gameState &&
			payableBuildRoadEdges(gameState, meIdx).length > 0,
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
			canBuyDevCard(gameState, meIdx, gameState?.currentTurn ?? -1),
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
	// A fence is an ordinary build, so it rides `canBuildBasic` (main turn or
	// a special-build slot) rather than main-turn-only like the modal bonuses.
	const fenceEnabled =
		canBuildBasic && !!gameState && canBuildFence(gameState, meIdx)
	// Gated on having something to cash in, the same way the build buttons are
	// gated on a legal spot: the tool's only affordance is the board pulse, so
	// arming it with nothing to pulse would leave the player nowhere to tap.
	const accountantEnabled =
		canBuildThisTurn &&
		!!myPlayer &&
		myPlayer.bonus === 'accountant' &&
		!!gameState &&
		liquidatableTargets(gameState, meIdx).length > 0
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

	const seatName = (i: number) =>
		profilesById[game?.player_order[i] ?? '']?.username ?? 'Player'
	// The other seats still owing an explorer road or a haunt pick.
	function postPlacementWaitingOn(pending: {
		explorer?: Partial<Record<number, number>>
		haunt?: number[]
	}): string[] {
		const idxs = new Set([
			...Object.entries(pending.explorer ?? {})
				.filter(([, n]) => (n ?? 0) > 0)
				.map(([i]) => Number(i)),
			...(pending.haunt ?? []),
		])
		return [...idxs].filter((i) => i !== meIdx).map(seatName)
	}

	// Which post_placement affordance this seat owes, already resolved to the
	// one thing to render. Derived here rather than in the view because both
	// layouts render it from `BoardArea` and the ordering rule is subtle:
	// specialists declare first (their overlay blocks the board), so nobody
	// falls through to an explorer/haunt banner until every specialist is in —
	// the same gate `postPlacementTool` applies to the board itself.
	const postPlacementData = ((): PostPlacementData => {
		if (!game) return null
		// Read off the server row, not the projection: once the last road is
		// queued the projection has drained this seat's entry — and, if it was
		// the last entry anywhere, already moved on to `roll` — while the table
		// is still waiting on the roads.
		if (
			serverState?.phase.kind === 'post_placement' &&
			(serverState.phase.pending.explorer?.[meIdx] ?? 0) > 0 &&
			queue.length > 0 &&
			!(
				gameState?.phase.kind === 'post_placement' &&
				(gameState.phase.pending.explorer?.[meIdx] ?? 0) > 0
			)
		) {
			const waitingOn =
				gameState?.phase.kind === 'post_placement'
					? postPlacementWaitingOn(gameState.phase.pending)
					: []
			return { kind: 'explorer_confirm', waitingOn }
		}
		if (!inPostPlacement) return null
		if (gameState?.phase.kind !== 'post_placement') return null
		const {
			specialist,
			explorer = {},
			haunt = [],
		} = gameState.phase.pending

		if (specialist.includes(meIdx))
			return {
				kind: 'specialist',
				waitingOn: specialist.filter((i) => i !== meIdx).map(seatName),
			}
		// Somebody else is still declaring: nothing to render here, since both
		// layouts' status surfaces already narrate the wait from the phase.
		if (specialist.length > 0) return null

		const waitingOn = postPlacementWaitingOn(gameState.phase.pending)
		const remaining = explorer[meIdx] ?? 0
		if (remaining > 0) return { kind: 'explorer', remaining, waitingOn }
		if (haunt.includes(meIdx)) return { kind: 'haunt', waitingOn }
		return waitingOn.length > 0 ? { kind: 'waiting', waitingOn } : null
	})()

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
		displayHand,
		myPlayer,
		isDev,
		devRollTotal,
		setDevRollTotal,
		profilesById,
		isSpectator,
		publicVP,
		selfVP,
		displayVP,
		seatColors,

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
		postPlacementData,
		liveOffer,
		bonusSelectionData,

		// --- Build / trade bar enablement ------------------------------
		buildEnabled,
		buildCurseHints,
		canBuildThisTurn,
		tradeButtonEnabled,
		tradeButtonActive,
		superCityEnabled,
		fenceEnabled,
		accountantEnabled,
		investorEnabled,

		// --- The local action queue ------------------------------------
		// `gameState` above is already the projection, so these are only for
		// the surfaces that talk about the queue itself.
		queuedCount: queue.length,
		flushState,
		onRetryFlush,
		pendingWin,

		// --- Local UI state --------------------------------------------
		submitting,
		canNominate,
		nominatedVertex,
		needsNomination,
		placementDraft,
		placementPairs,
		placementStage,
		canUndoPlacement,
		canConfirmPlacement,
		buildTool,
		tradePanelOpen,
		setTradePanelOpen,
		pendingConfirm,
		devBuyConfirmOpen,
		setDevBuyConfirmOpen,
		onConfirmDevCardBuy,
		setPendingConfirm,
		runPendingConfirm,
		hauntPicks,
		openPlayerIdx,
		setOpenPlayerIdx,
		bonusPaneCollapsed,
		setBonusPaneCollapsed,
		gameOverOpen,
		setGameOverOpen,
		toast,
		showToast: (message: string) => setToast(message),
		hideToast: () => setToast(null),
		ritualOpen,
		setRitualOpen,
		shepherdOpen,
		setShepherdOpen,
		scoutCostOpen,
		setScoutCostOpen,
		investOpen,
		setInvestOpen,
		metroPending,
		setMetroPending,

		// --- Animations -------------------------------------------------
		// Each dismiss releases the animation's hold on the fanned hand, so the
		// card appears as the reveal ends rather than before it starts.
		stealAnim,
		dismissStealAnim: () => {
			releaseHold(stealAnim?.key)
			setStealAnim(null)
		},
		nomadAnim,
		dismissNomadAnim: () => {
			releaseHold(nomadAnim?.key)
			setNomadAnimQueue((q) => q.slice(1))
		},
		ftAnim,
		dismissFtAnim: () => {
			releaseHold(ftAnim?.key)
			setFtAnimQueue((q) => q.slice(1))
		},

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
		onLiquidateSelect,
		onSetHauntSpots,
		onConfirmExplorerRoads,
		onInvest,
		onCastMagic,
		onSkipMagic,
		onUndo,
		onConfirmMetropolitanCost,
		onPlacementSelect,
		onUndoPlacement,
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
