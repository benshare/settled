import { useAuth } from '@/lib/auth'
import type { Hex } from '@/lib/catan/board'
import { BoardView } from '@/lib/catan/BoardView'
import {
	BUILD_COSTS,
	canAfford,
	validBuildCityVertices,
	validBuildRoadEdges,
	validBuildSettlementVertices,
	type BuildKind,
} from '@/lib/catan/build'
import type { BuildSelection } from '@/lib/catan/BuildLayer'
import { BuildTradeBar } from '@/lib/catan/BuildTradeBar'
import { DiscardBar } from '@/lib/catan/DiscardBar'
import { GameProvider, useGame } from '@/lib/catan/gameContext'
import { playerColors, waterColor } from '@/lib/catan/palette'
import type { PlacementSelection } from '@/lib/catan/PlacementLayer'
import { PlayerStrip } from '@/lib/catan/PlayerStrip'
import { ResourceHand } from '@/lib/catan/ResourceHand'
import { TradeBanner } from '@/lib/catan/TradeBanner'
import { TradePanel } from '@/lib/catan/TradePanel'
import type { ResourceHand as ResourceHandType } from '@/lib/catan/types'
import { Avatar } from '@/lib/modules/Avatar'
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
import { SafeAreaView } from 'react-native-safe-area-context'

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
	const { game, gameState, ready } = useGame()
	const profilesById = useGamesStore((s) => s.profilesById)
	const placeSettlement = useGamesStore((s) => s.placeSettlement)
	const placeRoad = useGamesStore((s) => s.placeRoad)
	const roll = useGamesStore((s) => s.roll)
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

	const [selection, setSelection] = useState<PlacementSelection | null>(null)
	const [submitting, setSubmitting] = useState(false)
	const [buildTool, setBuildTool] = useState<BuildKind | null>(null)
	const [tradePanelOpen, setTradePanelOpen] = useState(false)
	const [pendingConfirm, setPendingConfirm] = useState<{
		title: string
		run: () => void | Promise<void>
	} | null>(null)

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

	const inPlacement =
		game.status === 'placement' &&
		gameState?.phase.kind === 'initial_placement'
	const inMainLoop =
		game.status === 'active' &&
		(gameState?.phase.kind === 'roll' || gameState?.phase.kind === 'main')
	const phaseKind = gameState?.phase.kind
	const inRobberFlow =
		game.status === 'active' &&
		(phaseKind === 'discard' ||
			phaseKind === 'move_robber' ||
			phaseKind === 'steal')

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

	async function onEndTurn() {
		if (!game) return
		setSubmitting(true)
		const res = await endTurn(game.id)
		setSubmitting(false)
		if (res.error) notify(res.error)
	}

	function onBuildToolSelect(tool: BuildKind) {
		setBuildTool((prev) => (prev === tool ? null : tool))
	}

	function onBuildSpotSelect(sel: BuildSelection) {
		confirmAction(confirmBuildTitle(sel.kind), () => commitBuild(sel))
	}

	async function commitBuild(sel: BuildSelection) {
		if (!game) return
		setSubmitting(true)
		const res =
			sel.kind === 'road'
				? await buildRoad(game.id, sel.edge)
				: sel.kind === 'settlement'
					? await buildSettlement(game.id, sel.vertex)
					: await buildCity(game.id, sel.vertex)
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

	// Button enablement: only when it's my main-phase turn, I can afford the
	// cost, AND there is at least one valid spot on the board.
	const myHand = gameState?.players[meIdx]?.resources ?? null
	const canBuildThisTurn =
		isMyActiveTurn && gameState?.phase.kind === 'main' && !!myHand
	const buildEnabled = {
		road:
			canBuildThisTurn &&
			!!myHand &&
			canAfford(myHand, BUILD_COSTS.road) &&
			validBuildRoadEdges(gameState!, meIdx).length > 0,
		settlement:
			canBuildThisTurn &&
			!!myHand &&
			canAfford(myHand, BUILD_COSTS.settlement) &&
			validBuildSettlementVertices(gameState!, meIdx).length > 0,
		city:
			canBuildThisTurn &&
			!!myHand &&
			canAfford(myHand, BUILD_COSTS.city) &&
			validBuildCityVertices(gameState!, meIdx).length > 0,
		dev_card: false,
	}

	const hasLiveTrade = !!liveOffer
	const liveTradeIsMine = !!liveOffer && liveOffer.from === meIdx
	const tradeButtonEnabled =
		canBuildThisTurn && !hasLiveTrade && !tradePanelOpen
	const tradeButtonActive = tradePanelOpen || liveTradeIsMine

	return (
		<View style={styles.bodyRoot}>
			{inPlacement && gameState && (
				<PlacementHeader
					game={game}
					gameState={gameState}
					meIdx={meIdx}
					isMyTurn={isMyPlacementTurn}
					profilesById={profilesById}
				/>
			)}

			{!inPlacement && gameState && (
				<>
					<PlayerStrip
						playerOrder={game.player_order}
						currentTurn={game.current_turn}
						meIdx={meIdx}
						profilesById={profilesById}
						gameState={gameState}
					/>
					<BuildTradeBar
						active={buildTool}
						enabled={buildEnabled}
						meIdx={meIdx}
						tradeEnabled={tradeButtonEnabled}
						tradeActive={tradeButtonActive}
						onSelect={onBuildToolSelect}
						onTradePress={onTradePress}
					/>
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
								onSubmit={onDiscard}
							/>
						)}
				</>
			)}

			<View style={styles.boardContainer}>
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
				{pendingConfirm && (
					<ConfirmBar
						title={pendingConfirm.title}
						submitting={submitting}
						onConfirm={runPendingConfirm}
						onCancel={() => setPendingConfirm(null)}
					/>
				)}
			</View>

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

			{inMainLoop && gameState && !tradePanelOpen && (
				<MainLoopBar
					game={game}
					gameState={gameState}
					meIdx={meIdx}
					isMyTurn={isMyActiveTurn}
					profilesById={profilesById}
					submitting={submitting}
					onRoll={onRoll}
					onEndTurn={onEndTurn}
				/>
			)}

			{tradePanelOpen && myHand && (
				<TradePanel
					meIdx={meIdx}
					myHand={myHand}
					playerOrder={game.player_order}
					profilesById={profilesById}
					submitting={submitting}
					onSend={onProposeTrade}
					onCancel={() => setTradePanelOpen(false)}
				/>
			)}

			{gameState && meIdx >= 0 && gameState.players[meIdx] && (
				<ResourceHand hand={gameState.players[meIdx].resources} />
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
	onEndTurn,
}: {
	game: NonNullable<ReturnType<typeof useGame>['game']>
	gameState: NonNullable<ReturnType<typeof useGame>['gameState']>
	meIdx: number
	isMyTurn: boolean
	profilesById: Record<string, Profile>
	submitting: boolean
	onRoll: () => void
	onEndTurn: () => void
}) {
	const phase = gameState.phase
	if (phase.kind !== 'roll' && phase.kind !== 'main') return null

	const currentIdx = game.current_turn ?? 0
	const currentId = game.player_order[currentIdx]
	const currentName =
		meIdx === currentIdx
			? 'You'
			: (profilesById[currentId]?.username ?? 'Player')

	const dice = phase.kind === 'main' ? phase.roll : null
	const total = dice ? dice.a + dice.b : null

	let status: string
	if (phase.kind === 'roll') {
		status = isMyTurn
			? 'Your turn — roll the dice'
			: `${currentName} to roll`
	} else {
		status = isMyTurn
			? `You rolled ${total}`
			: `${currentName} rolled ${total}`
	}

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
				{isMyTurn && phase.kind === 'roll' && (
					<Button onPress={onRoll} loading={submitting}>
						Roll
					</Button>
				)}
				{isMyTurn && phase.kind === 'main' && (
					<Button onPress={onEndTurn} loading={submitting}>
						End turn
					</Button>
				)}
			</View>
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

	const dice = phase.roll
	return (
		<View style={styles.actionBar}>
			<View style={styles.mainLoopRow}>
				<View style={styles.diceRow}>
					<DieFaceView value={dice.a} />
					<DieFaceView value={dice.b} />
				</View>
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
			<View style={styles.avatarRow}>
				{game.player_order.map((uid, i) => {
					const profile = profilesById[uid]
					const isActive = i === currentIdx
					const color = playerColors[i] ?? playerColors[0]
					return (
						<View
							key={uid}
							style={[
								styles.avatarSlot,
								isActive && {
									borderColor: color,
								},
							]}
						>
							{profile ? (
								<Avatar profile={profile} size={32} />
							) : (
								<View style={styles.avatarPlaceholder} />
							)}
						</View>
					)
				})}
			</View>
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
	avatarRow: {
		flexDirection: 'row',
		gap: spacing.xs,
	},
	avatarSlot: {
		padding: 2,
		borderRadius: radius.full,
		borderWidth: 2,
		borderColor: 'transparent',
	},
	avatarPlaceholder: {
		width: 32,
		height: 32,
		borderRadius: radius.full,
		backgroundColor: colors.border,
	},
	boardContainer: {
		flex: 1,
		backgroundColor: waterColor,
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
