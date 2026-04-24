import { useAuth } from '@/lib/auth'
import { type Hex, type Resource } from '@/lib/catan/board'
import { BoardView } from '@/lib/catan/BoardView'
import type { BonusId } from '@/lib/catan/bonuses'
import { BonusSelection } from '@/lib/catan/BonusSelection'
import {
	canBuildMoreSuperCities,
	canShepherdSwap,
	forgerActive,
	ritualCardCost,
} from '@/lib/catan/bonus'
import {
	AccountantPicker,
	type LiquidationTarget,
} from '@/lib/catan/AccountantPicker'
import {
	CurioPickOverlay,
	CurioWaitOverlay,
} from '@/lib/catan/CurioPickOverlay'
import { ForgerMovePicker } from '@/lib/catan/ForgerMovePicker'
import { ForgerPickOverlay } from '@/lib/catan/ForgerPickOverlay'
import { MetropolitanCostPicker } from '@/lib/catan/MetropolitanCostPicker'
import {
	ExplorerStatusBanner,
	SpecialistDeclareOverlay,
	SpecialistWaitOverlay,
} from '@/lib/catan/PostPlacementOverlay'
import { RitualistPicker } from '@/lib/catan/RitualistPicker'
import {
	ScoutPickOverlay,
	ScoutWaitOverlay,
} from '@/lib/catan/ScoutPickOverlay'
import { ShepherdSwapPicker } from '@/lib/catan/ShepherdSwapPicker'
import {
	canAffordPurchase,
	canAffordMetropolitanCost,
	shouldUseBricklayer,
	validBuildCityVertices,
	validBuildRoadEdges,
	validBuildSettlementVertices,
	validBuildSuperCityVertices,
	type BuildKind,
} from '@/lib/catan/build'
import type { BuildSelection } from '@/lib/catan/BuildLayer'
import { BuildTradeBar, type BuildCurseHints } from '@/lib/catan/BuildTradeBar'
import { curseBuildReason } from '@/lib/catan/curses'
import { canBuyDevCard } from '@/lib/catan/dev'
import { DevCardHand, type DevPlayPayload } from '@/lib/catan/DevCardHand'
import { KnightTapBar } from '@/lib/catan/KnightTapBar'
import { DiscardBar } from '@/lib/catan/DiscardBar'
import { FinalScoreButton, GameOverOverlay } from '@/lib/catan/GameOverOverlay'
import { GameProvider, useGame } from '@/lib/catan/gameContext'
import { waterColor } from '@/lib/catan/palette'
import type { PlacementSelection } from '@/lib/catan/PlacementLayer'
import { PlayerDetailOverlay } from '@/lib/catan/PlayerDetailOverlay'
import { PlayerStrip } from '@/lib/catan/PlayerStrip'
import { ResourceHand } from '@/lib/catan/ResourceHand'
import { TradeBanner } from '@/lib/catan/TradeBanner'
import { TradePanel } from '@/lib/catan/TradePanel'
import type { ResourceHand as ResourceHandType } from '@/lib/catan/types'
import { Button } from '@/lib/modules/Button'
import { useGamesStore } from '@/lib/stores/useGamesStore'
import type { Profile } from '@/lib/stores/useProfileStore'
import { colors, font, radius, spacing } from '@/lib/theme'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
	ActivityIndicator,
	Alert,
	Platform,
	Pressable,
	StyleSheet,
	Text,
	View,
} from 'react-native'
import Animated, {
	FadeIn,
	FadeOut,
	LinearTransition,
} from 'react-native-reanimated'
import { SafeAreaView } from 'react-native-safe-area-context'

const BOARD_RESIZE = LinearTransition.duration(220)
const PANEL_IN = FadeIn.duration(160)
const PANEL_OUT = FadeOut.duration(120)

// Best-effort error notice. Alert.alert is a no-op on react-native-web;
// fall back to window.alert there. Confirms live inline in the game view
// (see ConfirmBar) rather than as a modal.
function notify(title: string, message?: string) {
	if (Platform.OS === 'web') {
		if (typeof window !== 'undefined') {
			window.alert(message ? `${title}\n\n${message}` : title)
		}
		return
	}
	Alert.alert(title, message)
}

export default function GameDetailScreen() {
	const { id } = useLocalSearchParams<{ id: string }>()
	const router = useRouter()

	return (
		<SafeAreaView style={styles.safe}>
			<View style={styles.header}>
				<Pressable
					onPress={() => router.back()}
					hitSlop={8}
					style={({ pressed }) => [
						styles.back,
						pressed && styles.pressed,
					]}
				>
					<Ionicons
						name="chevron-back"
						size={26}
						color={colors.text}
					/>
				</Pressable>
				<Text style={styles.title}>Game</Text>
				<View style={styles.back} />
			</View>

			<GameProvider gameId={id}>
				<GameBody />
			</GameProvider>
		</SafeAreaView>
	)
}

function GameBody() {
	const { user } = useAuth()
	const { game, gameState, ready, publicVP, selfVP } = useGame()
	const profilesById = useGamesStore((s) => s.profilesById)
	const pickBonus = useGamesStore((s) => s.pickBonus)
	const placeSettlement = useGamesStore((s) => s.placeSettlement)
	const placeRoad = useGamesStore((s) => s.placeRoad)
	const roll = useGamesStore((s) => s.roll)
	const confirmRoll = useGamesStore((s) => s.confirmRoll)
	const rerollDice = useGamesStore((s) => s.rerollDice)
	const endTurn = useGamesStore((s) => s.endTurn)
	const buildRoad = useGamesStore((s) => s.buildRoad)
	const buildSettlement = useGamesStore((s) => s.buildSettlement)
	const buildCity = useGamesStore((s) => s.buildCity)
	const discard = useGamesStore((s) => s.discard)
	const moveRobber = useGamesStore((s) => s.moveRobber)
	const steal = useGamesStore((s) => s.steal)
	const proposeTrade = useGamesStore((s) => s.proposeTrade)
	const acceptTrade = useGamesStore((s) => s.acceptTrade)
	const cancelTrade = useGamesStore((s) => s.cancelTrade)
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

	const [selection, setSelection] = useState<PlacementSelection | null>(null)
	const [submitting, setSubmitting] = useState(false)
	const [buildTool, setBuildTool] = useState<BuildKind | 'super_city' | null>(
		null
	)
	const [tradePanelOpen, setTradePanelOpen] = useState(false)
	const [ritualOpen, setRitualOpen] = useState(false)
	const [shepherdOpen, setShepherdOpen] = useState(false)
	const [forgerMoveOpen, setForgerMoveOpen] = useState(false)
	const [accountantOpen, setAccountantOpen] = useState(false)
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
	} | null>(null)
	const [openPlayerIdx, setOpenPlayerIdx] = useState<number | null>(null)
	// Game-over overlay starts open when the game is complete; user can
	// dismiss to inspect the final board and reopen via FinalScoreButton.
	const [gameOverOpen, setGameOverOpen] = useState(true)
	const router = useRouter()

	function confirmAction(title: string, run: () => void | Promise<void>) {
		setPendingConfirm({ title, run })
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

	// One VP array shared by every surface that renders a player's score.
	// During active play opponents see publicVP (no hidden VP cards) and the
	// viewer sees their own selfVP. On game-over everyone is fully revealed.
	const displayVP = useMemo(() => {
		if (game?.status === 'complete') return selfVP
		return publicVP.map((pub, i) => (i === meIdx ? selfVP[i] : pub))
	}, [game?.status, publicVP, selfVP, meIdx])

	const isCurrentPlayer =
		!!game &&
		game.current_turn !== null &&
		game.current_turn === meIdx &&
		meIdx >= 0

	const isMyPlacementTurn = isCurrentPlayer && game?.status === 'placement'
	const isMyActiveTurn = isCurrentPlayer && game?.status === 'active'

	// Reset selection when the turn or phase step changes under us.
	const placementKey =
		gameState?.phase.kind === 'initial_placement'
			? `${game?.current_turn}-${gameState.phase.round}-${gameState.phase.step}`
			: null
	useEffect(() => {
		setSelection(null)
	}, [placementKey])

	// Clear build tool + trade panel when the turn flips away or we leave main.
	const mainTurnKey =
		gameState?.phase.kind === 'main' && isMyActiveTurn
			? `${game?.current_turn}`
			: 'off'
	useEffect(() => {
		if (mainTurnKey === 'off') {
			setBuildTool(null)
			setTradePanelOpen(false)
		}
	}, [mainTurnKey])

	// Trade rides on the main phase — there's no top-level field for it.
	const liveOffer =
		gameState?.phase.kind === 'main' ? gameState.phase.trade : null

	// Close the compose panel if a live offer appears (we just sent it) or
	// disappears (someone accepted/cancelled).
	const liveTradeId = liveOffer?.id ?? null
	useEffect(() => {
		setTradePanelOpen(false)
	}, [liveTradeId])

	// Any pending confirm is tied to the current phase/turn. If either flips
	// under us (realtime), drop the stale confirm so its closure doesn't
	// fire against the wrong state.
	const confirmScopeKey = `${game?.current_turn ?? 'x'}:${gameState?.phase.kind ?? 'x'}`
	useEffect(() => {
		setPendingConfirm(null)
	}, [confirmScopeKey])

	if (!ready && !game) {
		return (
			<View style={styles.center}>
				<ActivityIndicator color={colors.brand} />
			</View>
		)
	}
	if (!game) {
		return (
			<View style={styles.center}>
				<Text style={styles.hint}>Game not found.</Text>
			</View>
		)
	}

	const inBonusSelection =
		game.status === 'placement' && gameState?.phase.kind === 'select_bonus'
	const inPlacement =
		game.status === 'placement' &&
		gameState?.phase.kind === 'initial_placement'
	const inPostPlacement =
		game.status === 'active' && gameState?.phase.kind === 'post_placement'
	const inMainLoop =
		game.status === 'active' &&
		(gameState?.phase.kind === 'roll' || gameState?.phase.kind === 'main')
	const phaseKind = gameState?.phase.kind
	const inRobberFlow =
		game.status === 'active' &&
		(phaseKind === 'discard' ||
			phaseKind === 'move_robber' ||
			phaseKind === 'steal')
	const inRoadBuilding =
		game.status === 'active' && phaseKind === 'road_building'
	const inGameOver = game.status === 'complete'

	async function onPickBonus(bonus: BonusId) {
		if (!game) return
		setSubmitting(true)
		const res = await pickBonus(game.id, bonus)
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

	async function onMoveForgerToken(hex: Hex) {
		if (!game) return
		setSubmitting(true)
		const res = await moveForgerToken(game.id, hex)
		setSubmitting(false)
		if (res.error) notify('Move failed', res.error)
		else setForgerMoveOpen(false)
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

	async function onConfirm() {
		if (!selection || !game) return
		setSubmitting(true)
		const res =
			selection.kind === 'settlement'
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
		const res = await roll(game.id)
		setSubmitting(false)
		if (res.error) notify('Roll failed', res.error)
	}

	async function onConfirmRoll() {
		if (!game) return
		setSubmitting(true)
		const res = await confirmRoll(game.id)
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

	async function onBuyDevCard() {
		if (!game) return
		setSubmitting(true)
		const use = myPlayer ? shouldUseBricklayer(myPlayer, 'dev_card') : false
		const res = await buyDevCard(game.id, use)
		setSubmitting(false)
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
		confirmAction(confirmBuildTitle(standardSel.kind), () =>
			commitBuild(standardSel)
		)
	}

	async function commitBuild(
		sel: Exclude<
			BuildSelection,
			{ kind: 'explorer_road' } | { kind: 'super_city' }
		>
	) {
		if (!game) return
		setSubmitting(true)
		const use = myPlayer ? shouldUseBricklayer(myPlayer, sel.kind) : false
		const res =
			sel.kind === 'road'
				? await buildRoad(game.id, sel.edge, use)
				: sel.kind === 'settlement'
					? await buildSettlement(game.id, sel.vertex, use)
					: await buildCity(game.id, sel.vertex, use)
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

	async function onBankTrade(
		give: ResourceHandType,
		receive: ResourceHandType
	) {
		if (!game) return
		setSubmitting(true)
		const res = await bankTrade(game.id, give, receive)
		setSubmitting(false)
		if (res.error) notify('Bank trade failed', res.error)
		else setTradePanelOpen(false)
	}

	// Button enablement: only when it's my main-phase turn, I can afford the
	// cost (standard or bricklayer alt), AND there is at least one valid
	// spot on the board.
	const myHand = gameState?.players[meIdx]?.resources ?? null
	const myPlayer = gameState && meIdx >= 0 ? gameState.players[meIdx] : null
	const canBuildThisTurn =
		isMyActiveTurn && gameState?.phase.kind === 'main' && !!myHand
	const buildEnabled = {
		road:
			canBuildThisTurn &&
			!!myPlayer &&
			canAffordPurchase(myPlayer, 'road') &&
			validBuildRoadEdges(gameState!, meIdx).length > 0,
		settlement:
			canBuildThisTurn &&
			!!myPlayer &&
			canAffordPurchase(myPlayer, 'settlement') &&
			validBuildSettlementVertices(gameState!, meIdx).length > 0,
		city:
			canBuildThisTurn &&
			!!myPlayer &&
			canAffordPurchase(myPlayer, 'city') &&
			validBuildCityVertices(gameState!, meIdx).length > 0,
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
			const hint = curseBuildReason(gameState, meIdx, kind)
			if (hint) out[kind] = hint
		}
		return out
	})()

	const hasLiveTrade = !!liveOffer
	const liveTradeIsMine = !!liveOffer && liveOffer.from === meIdx
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

	if (
		inBonusSelection &&
		gameState &&
		gameState.phase.kind === 'select_bonus'
	) {
		const myHand = meIdx >= 0 ? gameState.phase.hands[meIdx] : undefined
		const waitingOn = game.player_order
			.map((uid, i) => ({ uid, i }))
			.filter(({ i }) => {
				if (gameState.phase.kind !== 'select_bonus') return false
				return gameState.phase.hands[i]?.chosen == null
			})
			.filter(({ i }) => i !== meIdx)
			.map(({ uid }) => profilesById[uid]?.username ?? 'Player')
		return (
			<View style={styles.bodyRoot}>
				<BonusSelection
					hand={myHand}
					waitingOn={waitingOn}
					submitting={submitting}
					onPick={onPickBonus}
				/>
			</View>
		)
	}

	return (
		<View style={styles.bodyRoot}>
			{gameState && (
				<PlayerStrip
					playerOrder={game.player_order}
					currentTurn={game.current_turn}
					meIdx={meIdx}
					profilesById={profilesById}
					gameState={gameState}
					pointsByPlayer={displayVP}
					onPressPlayer={setOpenPlayerIdx}
				/>
			)}

			{inPlacement && gameState && (
				<PlacementHeader
					game={game}
					gameState={gameState}
					meIdx={meIdx}
					isMyTurn={isMyPlacementTurn}
					profilesById={profilesById}
				/>
			)}

			{!inPlacement && !inGameOver && gameState && (
				<>
					{!inRoadBuilding && (
						<BuildTradeBar
							active={buildTool}
							enabled={buildEnabled}
							curseHints={buildCurseHints}
							meIdx={meIdx}
							tradeEnabled={tradeButtonEnabled}
							tradeActive={tradeButtonActive}
							devCardsEnabled={!!gameState?.config.devCards}
							carpenterEnabled={
								myPlayer?.bonus === 'carpenter'
									? canBuildThisTurn &&
										!myPlayer.boughtCarpenterVPThisTurn &&
										myPlayer.resources.wood >= 4
									: undefined
							}
							superCityEnabled={
								myPlayer?.bonus === 'metropolitan'
									? superCityEnabled
									: undefined
							}
							superCityActive={buildTool === 'super_city'}
							accountantEnabled={
								myPlayer?.bonus === 'accountant'
									? accountantEnabled
									: undefined
							}
							onSelect={onBuildToolSelect}
							onTradePress={onTradePress}
							onBuyDevCard={onBuyDevCard}
							onBuyCarpenterVP={onBuyCarpenterVP}
							onSelectSuperCity={() =>
								onBuildToolSelect('super_city')
							}
							onAccountant={() => setAccountantOpen(true)}
						/>
					)}
					{inRoadBuilding && (
						<RoadBuildingStatus
							game={game}
							gameState={gameState}
							meIdx={meIdx}
							profilesById={profilesById}
						/>
					)}
					{inRobberFlow && (
						<RobberStatus
							game={game}
							gameState={gameState}
							meIdx={meIdx}
							profilesById={profilesById}
						/>
					)}
					{gameState.phase.kind === 'discard' &&
						meIdx >= 0 &&
						gameState.phase.pending[meIdx] !== undefined && (
							<DiscardBar
								hand={gameState.players[meIdx].resources}
								required={gameState.phase.pending[meIdx]!}
								submitting={submitting}
								isShepherd={
									gameState.players[meIdx]?.bonus ===
									'shepherd'
								}
								onSubmit={onDiscard}
							/>
						)}
				</>
			)}

			{gameState && (
				<PlayerDetailOverlay
					playerIdx={openPlayerIdx}
					playerOrder={game.player_order}
					meIdx={meIdx}
					profilesById={profilesById}
					gameState={gameState}
					pointsByPlayer={displayVP}
					onClose={() => setOpenPlayerIdx(null)}
				/>
			)}

			{inPostPlacement &&
				gameState &&
				gameState.phase.kind === 'post_placement' &&
				(() => {
					const phase = gameState.phase
					const specialistPending = phase.pending.specialist
					const explorer = phase.pending.explorer ?? {}
					const waitingSpecialist = specialistPending
						.filter((i) => i !== meIdx)
						.map(
							(i) =>
								profilesById[game.player_order[i]]?.username ??
								'Player'
						)
					if (specialistPending.includes(meIdx)) {
						return (
							<SpecialistDeclareOverlay
								waitingOn={waitingSpecialist}
								submitting={submitting}
								onConfirm={onSetSpecialistResource}
							/>
						)
					}
					// Specialist still pending for someone else: block the
					// player with a wait overlay so the board doesn't become
					// interactive mid-resolution.
					if (waitingSpecialist.length > 0) {
						return (
							<SpecialistWaitOverlay
								waitingOn={waitingSpecialist}
							/>
						)
					}
					// Specialist done — explorer placements happen inline on
					// the board; surface a status banner so the player sees
					// the count.
					const myRemaining = explorer[meIdx] ?? 0
					const otherWaiting = Object.entries(explorer)
						.filter(
							([idx, n]) => Number(idx) !== meIdx && (n ?? 0) > 0
						)
						.map(
							([idx]) =>
								profilesById[game.player_order[Number(idx)]]
									?.username ?? 'Player'
						)
					if (myRemaining > 0 || otherWaiting.length > 0) {
						return (
							<ExplorerStatusBanner
								remaining={myRemaining}
								waitingOn={otherWaiting}
							/>
						)
					}
					return null
				})()}

			{gameState && gameState.phase.kind === 'scout_pick' && (
				<>
					{gameState.phase.owner === meIdx ? (
						<ScoutPickOverlay
							cards={gameState.phase.cards}
							submitting={submitting}
							onConfirm={onConfirmScoutCard}
						/>
					) : (
						<ScoutWaitOverlay
							ownerName={
								profilesById[
									game.player_order[gameState.phase.owner]
								]?.username ?? 'Player'
							}
						/>
					)}
				</>
			)}

			{gameState && gameState.phase.kind === 'curio_pick' && (
				<>
					{gameState.phase.pending.includes(meIdx) ? (
						<CurioPickOverlay
							submitting={submitting}
							onConfirm={onClaimCurio}
						/>
					) : (
						<CurioWaitOverlay
							waitingOn={gameState.phase.pending.map(
								(i) =>
									profilesById[game.player_order[i]]
										?.username ?? 'Player'
							)}
						/>
					)}
				</>
			)}

			{gameState &&
				gameState.phase.kind === 'forger_pick' &&
				gameState.phase.queue.length > 0 &&
				gameState.phase.queue[0].idx === meIdx && (
					<ForgerPickOverlay
						hex={gameState.phase.queue[0].hex}
						gainsByCandidate={
							gameState.phase.queue[0].gainsByCandidate
						}
						playerNames={Object.fromEntries(
							game.player_order.map((uid, i) => [
								i,
								i === meIdx
									? 'You'
									: (profilesById[uid]?.username ??
										`Player ${i + 1}`),
							])
						)}
						submitting={submitting}
						onConfirm={onPickForgerTarget}
					/>
				)}

			{ritualOpen && myPlayer && gameState && (
				<RitualistPicker
					hand={myPlayer.resources}
					cardCost={ritualCardCost(gameState, meIdx)}
					submitting={submitting}
					onCancel={() => setRitualOpen(false)}
					onConfirm={onRitualRoll}
				/>
			)}

			{shepherdOpen && (
				<ShepherdSwapPicker
					submitting={submitting}
					onCancel={() => setShepherdOpen(false)}
					onConfirm={onShepherdSwap}
				/>
			)}

			{forgerMoveOpen && myPlayer?.forgerToken && gameState && (
				<ForgerMovePicker
					state={gameState}
					currentHex={myPlayer.forgerToken}
					submitting={submitting}
					onCancel={() => setForgerMoveOpen(false)}
					onConfirm={onMoveForgerToken}
				/>
			)}

			{accountantOpen && gameState && (
				<AccountantPicker
					state={gameState}
					playerIdx={meIdx}
					submitting={submitting}
					onCancel={() => setAccountantOpen(false)}
					onConfirm={onLiquidate}
				/>
			)}

			{metroPending && myHand && (
				<MetropolitanCostPicker
					hand={myHand}
					titleKind={metroPending.kind}
					submitting={submitting}
					onCancel={() => setMetroPending(null)}
					onConfirm={(swapDelta) => {
						if (metroPending.kind === 'super_city') {
							onBuildSuperCity(metroPending.vertex, swapDelta)
						} else {
							;(async () => {
								if (!game) return
								setSubmitting(true)
								const res = await buildCity(
									game.id,
									metroPending.vertex,
									false,
									swapDelta
								)
								setSubmitting(false)
								if (res.error) {
									notify('Build failed', res.error)
									return
								}
								setMetroPending(null)
								setBuildTool(null)
							})()
						}
					}}
				/>
			)}

			<Animated.View style={styles.boardContainer} layout={BOARD_RESIZE}>
				{liveOffer && (
					<TradeBanner
						offer={liveOffer}
						meIdx={meIdx}
						myHand={myHand}
						playerOrder={game.player_order}
						profilesById={profilesById}
						submitting={submitting}
						onAccept={onAcceptTrade}
						onCancel={onCancelTrade}
					/>
				)}
				{gameState ? (
					<BoardView
						state={gameState}
						interaction={
							inPlacement && isMyPlacementTurn
								? {
										meIdx,
										selection,
										onSelect: setSelection,
									}
								: undefined
						}
						build={
							buildTool && isMyActiveTurn && !tradePanelOpen
								? {
										meIdx,
										tool: buildTool,
										onSelect: onBuildSpotSelect,
									}
								: inRoadBuilding && isCurrentPlayer
									? {
											meIdx,
											tool: 'road',
											onSelect: onBuildSpotSelect,
										}
									: inPostPlacement &&
										  gameState.phase.kind ===
												'post_placement' &&
										  (gameState.phase.pending.explorer?.[
												meIdx
										  ] ?? 0) > 0 &&
										  gameState.phase.pending.specialist
												.length === 0
										? {
												meIdx,
												tool: 'explorer_road' as const,
												onSelect: onBuildSpotSelect,
											}
										: undefined
						}
						robber={
							isMyActiveTurn &&
							(gameState.phase.kind === 'move_robber' ||
								gameState.phase.kind === 'steal')
								? {
										meIdx,
										onMoveRobber: onMoveRobberRequest,
										onSteal: onStealRequest,
									}
								: undefined
						}
					/>
				) : (
					<View style={styles.loadingFill}>
						<ActivityIndicator color={colors.brand} />
					</View>
				)}
				<View pointerEvents="none" style={styles.boardInsetTop} />
				<View pointerEvents="none" style={styles.boardInsetBottom} />
				{pendingConfirm && (
					<ConfirmBar
						title={pendingConfirm.title}
						submitting={submitting}
						onConfirm={runPendingConfirm}
						onCancel={() => setPendingConfirm(null)}
					/>
				)}
			</Animated.View>

			{inPlacement && isMyPlacementTurn && (
				<View style={styles.actionBar}>
					<Button
						onPress={onConfirm}
						disabled={!selection}
						loading={submitting}
					>
						{confirmLabel(gameState, selection)}
					</Button>
				</View>
			)}

			{inMainLoop && !inGameOver && gameState && !tradePanelOpen && (
				<Animated.View entering={PANEL_IN} exiting={PANEL_OUT}>
					<MainLoopBar
						game={game}
						gameState={gameState}
						meIdx={meIdx}
						isMyTurn={isMyActiveTurn}
						profilesById={profilesById}
						submitting={submitting}
						onRoll={onRoll}
						onConfirmRoll={onConfirmRoll}
						onRerollDice={onRerollDice}
						onEndTurn={onEndTurn}
						onRitualPress={
							isMyActiveTurn &&
							gameState.phase.kind === 'roll' &&
							!gameState.phase.pending?.dice &&
							myPlayer?.bonus === 'ritualist' &&
							!myPlayer?.ritualWasUsedThisTurn
								? () => setRitualOpen(true)
								: undefined
						}
						onShepherdPress={
							isMyActiveTurn &&
							gameState.phase.kind === 'roll' &&
							!gameState.phase.pending?.dice &&
							myPlayer &&
							canShepherdSwap(myPlayer)
								? () => setShepherdOpen(true)
								: undefined
						}
						onForgerMovePress={
							isMyActiveTurn &&
							gameState.phase.kind === 'roll' &&
							!gameState.phase.pending?.dice &&
							myPlayer &&
							forgerActive(myPlayer) &&
							!myPlayer.forgerMovedThisTurn
								? () => setForgerMoveOpen(true)
								: undefined
						}
					/>
				</Animated.View>
			)}

			{tradePanelOpen && myHand && gameState && (
				<Animated.View entering={PANEL_IN} exiting={PANEL_OUT}>
					<TradePanel
						meIdx={meIdx}
						myHand={myHand}
						state={gameState}
						playerOrder={game.player_order}
						profilesById={profilesById}
						submitting={submitting}
						onSend={onProposeTrade}
						onSendBank={onBankTrade}
						onCancel={() => setTradePanelOpen(false)}
					/>
				</Animated.View>
			)}

			{!inPlacement &&
				!inGameOver &&
				!tradePanelOpen &&
				gameState &&
				meIdx >= 0 &&
				gameState.players[meIdx] && (
					<Animated.View entering={PANEL_IN} exiting={PANEL_OUT}>
						<ResourceHand
							hand={gameState.players[meIdx].resources}
						/>
						{gameState.config.devCards && (
							<DevCardHand
								entries={gameState.players[meIdx].devCards}
								round={gameState.round}
								myTurn={isMyActiveTurn}
								phaseKind={gameState.phase.kind}
								playedDevThisTurn={
									gameState.players[meIdx].playedDevThisTurn
								}
								onPlay={onPlayDevCard}
							/>
						)}
						{myPlayer?.bonus === 'veteran' && (
							<KnightTapBar
								untappedKnights={
									(myPlayer.devCardsPlayed.knight ?? 0) -
									(myPlayer.tappedKnights ?? 0)
								}
								enabled={
									isMyActiveTurn &&
									gameState.phase.kind === 'main'
								}
								onTap={onTapKnight}
							/>
						)}
					</Animated.View>
				)}

			{inGameOver && gameState && (
				<GameOverOverlay
					visible={gameOverOpen}
					winnerIdx={game.winner}
					playerOrder={game.player_order}
					meIdx={meIdx}
					profilesById={profilesById}
					gameState={gameState}
					pointsByPlayer={displayVP}
					onDismiss={() => setGameOverOpen(false)}
					onBackToGames={() => router.replace('/play')}
				/>
			)}
			{inGameOver && !gameOverOpen && (
				<FinalScoreButton onPress={() => setGameOverOpen(true)} />
			)}
		</View>
	)
}

function ConfirmBar({
	title,
	submitting,
	onConfirm,
	onCancel,
}: {
	title: string
	submitting: boolean
	onConfirm: () => void
	onCancel: () => void
}) {
	return (
		<View style={styles.confirmFloat}>
			<Text style={styles.confirmTitle}>{title}</Text>
			<View style={styles.confirmRow}>
				<Pressable
					onPress={onCancel}
					disabled={submitting}
					style={({ pressed }) => [
						styles.confirmBtn,
						styles.confirmCancel,
						pressed && !submitting && styles.pressed,
					]}
				>
					<Text style={styles.confirmCancelText}>Cancel</Text>
				</Pressable>
				<Pressable
					onPress={onConfirm}
					disabled={submitting}
					style={({ pressed }) => [
						styles.confirmBtn,
						styles.confirmOk,
						pressed && !submitting && styles.pressed,
					]}
				>
					<Text style={styles.confirmOkText}>
						{submitting ? '…' : 'Confirm'}
					</Text>
				</Pressable>
			</View>
		</View>
	)
}

function MainLoopBar({
	game,
	gameState,
	meIdx,
	isMyTurn,
	profilesById,
	submitting,
	onRoll,
	onConfirmRoll,
	onRerollDice,
	onEndTurn,
	onRitualPress,
	onShepherdPress,
	onForgerMovePress,
}: {
	game: NonNullable<ReturnType<typeof useGame>['game']>
	gameState: NonNullable<ReturnType<typeof useGame>['gameState']>
	meIdx: number
	isMyTurn: boolean
	profilesById: Record<string, Profile>
	submitting: boolean
	onRoll: () => void
	onConfirmRoll: () => void
	onRerollDice: () => void
	onEndTurn: () => void
	// Set-2 pre-roll affordances. Each is `undefined` when the bar should
	// not show the corresponding button (wrong player / wrong phase / cap
	// reached).
	onRitualPress?: () => void
	onShepherdPress?: () => void
	onForgerMovePress?: () => void
}) {
	const phase = gameState.phase
	if (phase.kind !== 'roll' && phase.kind !== 'main') return null

	const currentIdx = game.current_turn ?? 0
	const currentId = game.player_order[currentIdx]
	const currentName =
		meIdx === currentIdx
			? 'You'
			: (profilesById[currentId]?.username ?? 'Player')

	// Gambler pending-dice path: dice are shown but not yet applied. The
	// player must Confirm (apply distribution / 7-chain) or Reroll (once
	// per turn). Non-gambler rolls skip this — dice go from roll → main
	// atomically.
	const pendingDice =
		phase.kind === 'roll' ? (phase.pending?.dice ?? null) : null
	const committedDice = phase.kind === 'main' ? phase.roll : null
	const dice = pendingDice ?? committedDice
	const total = dice ? dice.a + dice.b : null
	const rerolledThisTurn = gameState.players[meIdx]?.rerolledThisTurn ?? false

	let status: string
	if (pendingDice) {
		status = isMyTurn
			? `You rolled ${total} — confirm or reroll`
			: `${currentName} rolled ${total}`
	} else if (phase.kind === 'roll') {
		status = isMyTurn
			? 'Your turn — roll the dice'
			: `${currentName} to roll`
	} else {
		status = isMyTurn
			? `You rolled ${total}`
			: `${currentName} rolled ${total}`
	}

	const showBonusRow =
		!!onRitualPress || !!onShepherdPress || !!onForgerMovePress
	return (
		<View style={styles.mainLoopBar}>
			<View style={styles.mainLoopRow}>
				<View style={styles.diceSlot}>
					{dice && (
						<View style={styles.diceRow}>
							<DieFaceView value={dice.a} />
							<DieFaceView value={dice.b} />
						</View>
					)}
				</View>
				<Text style={styles.mainLoopStatus} numberOfLines={2}>
					{status}
				</Text>
				{isMyTurn && phase.kind === 'roll' && !pendingDice && (
					<Button onPress={onRoll} loading={submitting}>
						Roll
					</Button>
				)}
				{isMyTurn && pendingDice && (
					<View style={styles.gamblerActions}>
						{!rerolledThisTurn && (
							<Button
								onPress={onRerollDice}
								loading={submitting}
								variant="secondary"
							>
								Reroll
							</Button>
						)}
						<Button onPress={onConfirmRoll} loading={submitting}>
							Confirm
						</Button>
					</View>
				)}
				{isMyTurn && phase.kind === 'main' && (
					<Button onPress={onEndTurn} loading={submitting}>
						End turn
					</Button>
				)}
			</View>
			{showBonusRow && (
				<View style={styles.bonusRow}>
					{onRitualPress && (
						<Button
							variant="secondary"
							onPress={onRitualPress}
							disabled={submitting}
						>
							Ritual roll
						</Button>
					)}
					{onShepherdPress && (
						<Button
							variant="secondary"
							onPress={onShepherdPress}
							disabled={submitting}
						>
							Shepherd swap
						</Button>
					)}
					{onForgerMovePress && (
						<Button
							variant="secondary"
							onPress={onForgerMovePress}
							disabled={submitting}
						>
							Move forger token
						</Button>
					)}
				</View>
			)}
		</View>
	)
}

function DieFaceView({ value }: { value: number }) {
	return (
		<View style={styles.die}>
			<Text style={styles.dieText}>{value}</Text>
		</View>
	)
}

function RobberStatus({
	game,
	gameState,
	meIdx,
	profilesById,
}: {
	game: NonNullable<ReturnType<typeof useGame>['game']>
	gameState: NonNullable<ReturnType<typeof useGame>['gameState']>
	meIdx: number
	profilesById: Record<string, Profile>
}) {
	const phase = gameState.phase
	if (
		phase.kind !== 'discard' &&
		phase.kind !== 'move_robber' &&
		phase.kind !== 'steal'
	)
		return null

	const currentIdx = game.current_turn ?? 0
	const currentId = game.player_order[currentIdx]
	const currentName =
		meIdx === currentIdx
			? 'You'
			: (profilesById[currentId]?.username ?? 'Player')

	let status: string
	if (phase.kind === 'discard') {
		const pendingIdxs = Object.keys(phase.pending)
			.map((k) => Number(k))
			.sort((a, b) => a - b)
		const iOwe = meIdx >= 0 && phase.pending[meIdx] !== undefined
		if (iOwe) {
			status = `You rolled 7 — discard ${phase.pending[meIdx]!}`
		} else {
			const names = pendingIdxs.map((i) =>
				i === meIdx
					? 'You'
					: (profilesById[game.player_order[i]]?.username ?? 'Player')
			)
			status = `Waiting for ${names.join(', ')} to discard`
		}
	} else if (phase.kind === 'move_robber') {
		status =
			meIdx === currentIdx
				? 'You rolled 7 — move the robber'
				: `${currentName} is moving the robber`
	} else {
		status =
			meIdx === currentIdx
				? 'Pick a player to steal from'
				: `${currentName} is stealing`
	}

	// Dice are only relevant when the sub-phase was triggered by a 7-roll
	// (resume.kind === 'main'). Knight-triggered pre-roll chains resume to
	// `roll` and have no dice to show yet.
	const dice = phase.resume.kind === 'main' ? phase.resume.roll : null
	return (
		<View style={styles.actionBar}>
			<View style={styles.mainLoopRow}>
				{dice && (
					<View style={styles.diceRow}>
						<DieFaceView value={dice.a} />
						<DieFaceView value={dice.b} />
					</View>
				)}
				<Text style={styles.mainLoopStatus}>{status}</Text>
			</View>
		</View>
	)
}

function RoadBuildingStatus({
	game,
	gameState,
	meIdx,
	profilesById,
}: {
	game: NonNullable<ReturnType<typeof useGame>['game']>
	gameState: NonNullable<ReturnType<typeof useGame>['gameState']>
	meIdx: number
	profilesById: Record<string, Profile>
}) {
	const phase = gameState.phase
	if (phase.kind !== 'road_building') return null
	const currentIdx = game.current_turn ?? 0
	const isMyTurn = meIdx === currentIdx
	const currentName = isMyTurn
		? 'You'
		: (profilesById[game.player_order[currentIdx]]?.username ?? 'Player')
	const placedSoFar = 2 - phase.remaining + 1
	const status = isMyTurn
		? `Place free road ${placedSoFar}/2`
		: `${currentName} is placing 2 roads`
	return (
		<View style={styles.actionBar}>
			<View style={styles.mainLoopRow}>
				<Text style={styles.mainLoopStatus}>{status}</Text>
			</View>
		</View>
	)
}

function confirmLabel(
	gameState: ReturnType<typeof useGame>['gameState'],
	selection: PlacementSelection | null
): string {
	if (!selection) {
		if (gameState?.phase.kind === 'initial_placement') {
			return gameState.phase.step === 'settlement'
				? 'Tap a spot to place settlement'
				: 'Tap an edge to place road'
		}
		return 'Select a spot'
	}
	return selection.kind === 'settlement'
		? 'Confirm settlement'
		: 'Confirm road'
}

function PlacementHeader({
	game,
	gameState,
	meIdx,
	isMyTurn,
	profilesById,
}: {
	game: NonNullable<ReturnType<typeof useGame>['game']>
	gameState: NonNullable<ReturnType<typeof useGame>['gameState']>
	meIdx: number
	isMyTurn: boolean
	profilesById: Record<string, Profile>
}) {
	if (gameState.phase.kind !== 'initial_placement') return null
	const currentIdx = game.current_turn ?? 0
	const currentId = game.player_order[currentIdx]
	const currentName =
		meIdx === currentIdx
			? 'You'
			: (profilesById[currentId]?.username ?? 'Player')

	const stepLabel =
		gameState.phase.step === 'settlement' ? 'settlement' : 'road'
	const message = isMyTurn
		? `Your turn — place ${prefix(stepLabel)} ${stepLabel}`
		: `Waiting for ${currentName} to place ${prefix(stepLabel)} ${stepLabel}`

	return (
		<View style={styles.statusWrap}>
			<Text style={styles.statusLine}>{message}</Text>
		</View>
	)
}

function prefix(word: string): string {
	return /^[aeiou]/i.test(word) ? 'an' : 'a'
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

const styles = StyleSheet.create({
	safe: {
		flex: 1,
		backgroundColor: colors.background,
	},
	header: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingHorizontal: spacing.md,
		paddingTop: spacing.sm,
		paddingBottom: spacing.sm,
	},
	back: {
		width: 40,
		height: 40,
		alignItems: 'center',
		justifyContent: 'center',
	},
	pressed: {
		opacity: 0.7,
	},
	title: {
		fontSize: font.md,
		fontWeight: '700',
		color: colors.text,
	},
	center: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
		gap: spacing.md,
	},
	hint: {
		fontSize: font.base,
		color: colors.textMuted,
		textAlign: 'center',
	},
	bodyRoot: {
		flex: 1,
	},
	statusWrap: {
		paddingHorizontal: spacing.md,
		paddingTop: spacing.xs,
		paddingBottom: spacing.sm,
		gap: spacing.xs,
		alignItems: 'center',
	},
	statusLine: {
		fontSize: font.base,
		color: colors.text,
		fontWeight: '600',
	},
	boardContainer: {
		flex: 1,
		backgroundColor: waterColor,
	},
	boardInsetTop: {
		position: 'absolute',
		top: 0,
		left: 0,
		right: 0,
		height: 12,
		boxShadow: 'inset 0 6px 6px -2px rgba(0,0,0,0.28)',
	},
	boardInsetBottom: {
		position: 'absolute',
		bottom: 0,
		left: 0,
		right: 0,
		height: 12,
		boxShadow: 'inset 0 -6px 6px -2px rgba(0,0,0,0.28)',
	},
	loadingFill: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
	},
	actionBar: {
		paddingHorizontal: spacing.md,
		paddingTop: spacing.sm,
		paddingBottom: spacing.md,
		height: 76,
		justifyContent: 'center',
	},
	mainLoopBar: {
		paddingHorizontal: spacing.md,
		paddingTop: spacing.sm,
		paddingBottom: spacing.md,
		height: 76,
		justifyContent: 'center',
	},
	diceSlot: {
		width: 72,
		height: 32,
		justifyContent: 'center',
	},
	confirmFloat: {
		position: 'absolute',
		top: spacing.sm,
		right: spacing.sm,
		backgroundColor: colors.card,
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radius.md,
		paddingHorizontal: spacing.sm,
		paddingVertical: spacing.xs,
		gap: spacing.xs,
		shadowColor: '#000',
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.12,
		shadowRadius: 6,
		elevation: 3,
		maxWidth: 220,
	},
	confirmTitle: {
		fontSize: font.sm,
		fontWeight: '600',
		color: colors.text,
	},
	confirmRow: {
		flexDirection: 'row',
		gap: spacing.xs,
	},
	confirmBtn: {
		paddingHorizontal: spacing.sm,
		paddingVertical: 4,
		borderRadius: radius.sm,
		borderWidth: 1,
	},
	confirmCancel: {
		borderColor: colors.border,
		backgroundColor: colors.white,
	},
	confirmCancelText: {
		fontSize: font.sm,
		color: colors.text,
	},
	confirmOk: {
		borderColor: colors.brand,
		backgroundColor: colors.brand,
	},
	confirmOkText: {
		fontSize: font.sm,
		fontWeight: '600',
		color: colors.white,
	},
	mainLoopRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		height: 52,
	},
	bonusRow: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: spacing.xs,
		marginTop: spacing.xs,
	},
	gamblerActions: {
		flexDirection: 'row',
		gap: spacing.xs,
	},
	diceRow: {
		flexDirection: 'row',
		gap: spacing.xs,
	},
	die: {
		width: 32,
		height: 32,
		borderRadius: radius.sm,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.white,
		alignItems: 'center',
		justifyContent: 'center',
	},
	dieText: {
		fontSize: font.base,
		fontWeight: '700',
		color: colors.text,
	},
	mainLoopStatus: {
		flex: 1,
		fontSize: font.base,
		color: colors.text,
		fontWeight: '600',
	},
})
