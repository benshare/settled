import { useAuth } from '@/lib/auth'
import { BoardView } from '@/lib/catan/BoardView'
import { BuildTradeBar } from '@/lib/catan/BuildTradeBar'
import { GameProvider, useGame } from '@/lib/catan/gameContext'
import { PlayerStrip } from '@/lib/catan/PlayerStrip'
import { playerColors } from '@/lib/catan/palette'
import type { PlacementSelection } from '@/lib/catan/PlacementLayer'
import { ResourceHand } from '@/lib/catan/ResourceHand'
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
	Pressable,
	StyleSheet,
	Text,
	View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

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

	const [selection, setSelection] = useState<PlacementSelection | null>(null)
	const [submitting, setSubmitting] = useState(false)

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

	async function onConfirm() {
		if (!selection || !game) return
		setSubmitting(true)
		const res =
			selection.kind === 'settlement'
				? await placeSettlement(game.id, selection.vertex)
				: await placeRoad(game.id, selection.edge)
		setSubmitting(false)
		if (res.error) {
			Alert.alert('Placement failed', res.error)
			return
		}
		setSelection(null)
	}

	async function onRoll() {
		if (!game) return
		setSubmitting(true)
		const res = await roll(game.id)
		setSubmitting(false)
		if (res.error) Alert.alert('Roll failed', res.error)
	}

	async function onEndTurn() {
		if (!game) return
		setSubmitting(true)
		const res = await endTurn(game.id)
		setSubmitting(false)
		if (res.error) Alert.alert(res.error)
	}

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
					<BuildTradeBar />
				</>
			)}

			<View style={styles.boardContainer}>
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
					/>
				) : (
					<ActivityIndicator color={colors.brand} />
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

			{inMainLoop && gameState && (
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

			{gameState && meIdx >= 0 && gameState.players[meIdx] && (
				<ResourceHand hand={gameState.players[meIdx].resources} />
			)}
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
		alignItems: 'center',
		justifyContent: 'center',
	},
	actionBar: {
		paddingHorizontal: spacing.md,
		paddingTop: spacing.sm,
		paddingBottom: spacing.md,
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
