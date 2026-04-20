import { useAuth } from '@/lib/auth'
import { GameProvider, useGame } from '@/lib/catan/gameContext'
import { Avatar } from '@/lib/modules/Avatar'
import { type Game, useGamesStore } from '@/lib/stores/useGamesStore'
import type { Profile } from '@/lib/stores/useProfileStore'
import { colors, font, radius, spacing } from '@/lib/theme'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
	ActivityIndicator,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

const CIRCLE_SIZE = 260
const SLOT_SIZE = 88

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
	const profilesById = useGamesStore((s) => s.profilesById)
	const { game, gameState, ready } = useGame()

	if (!ready && !game) {
		return (
			<View style={[styles.body, styles.center]}>
				<ActivityIndicator color={colors.brand} />
			</View>
		)
	}
	if (!game) {
		return (
			<View style={styles.body}>
				<Text style={styles.hint}>Game not found.</Text>
			</View>
		)
	}

	return (
		<ScrollView contentContainerStyle={styles.body}>
			{game.status === 'complete' && (
				<WinnerCallout game={game} profilesById={profilesById} />
			)}

			<PlayerCircle
				playerOrder={game.player_order}
				currentTurn={
					game.status === 'complete' ? null : game.current_turn
				}
				profilesById={profilesById}
				meId={user?.id}
			/>

			{game.status !== 'complete' && (
				<Text style={styles.hint}>
					{game.status === 'placement'
						? 'Placing initial settlements and roads…'
						: 'Game in progress.'}
				</Text>
			)}

			{gameState ? (
				<Text style={styles.hint}>Phase: {gameState.phase.kind}</Text>
			) : (
				<ActivityIndicator color={colors.brand} />
			)}
		</ScrollView>
	)
}

function WinnerCallout({
	game,
	profilesById,
}: {
	game: Game
	profilesById: Record<string, Profile>
}) {
	if (game.winner === null) return null
	const uid = game.player_order[game.winner]
	const name = profilesById[uid]?.username ?? '…'
	return (
		<View style={styles.winner}>
			<Text style={styles.winnerText}>{name} wins!</Text>
		</View>
	)
}

function PlayerCircle({
	playerOrder,
	currentTurn,
	profilesById,
	meId,
}: {
	playerOrder: string[]
	currentTurn: number | null
	profilesById: Record<string, Profile>
	meId: string | undefined
}) {
	const n = playerOrder.length
	const radiusPx = CIRCLE_SIZE / 2 - SLOT_SIZE / 2
	const cx = CIRCLE_SIZE / 2 - SLOT_SIZE / 2
	const cy = CIRCLE_SIZE / 2 - SLOT_SIZE / 2

	return (
		<View style={styles.circleWrap}>
			<View style={styles.circle}>
				{playerOrder.map((uid, i) => {
					const angle = (i / n) * Math.PI * 2 - Math.PI / 2
					const left = cx + radiusPx * Math.cos(angle)
					const top = cy + radiusPx * Math.sin(angle)
					const isTurn = i === currentTurn
					const profile = profilesById[uid]
					return (
						<View
							key={uid}
							style={[
								styles.slot,
								{ left, top },
								isTurn && styles.slotActive,
							]}
						>
							{profile ? (
								<Avatar profile={profile} size={40} />
							) : (
								<View style={styles.avatarPlaceholder} />
							)}
							<Text style={styles.slotName} numberOfLines={1}>
								{profile?.username ?? '…'}
								{uid === meId ? ' (you)' : ''}
							</Text>
						</View>
					)
				})}
			</View>
		</View>
	)
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
	body: {
		padding: spacing.lg,
		gap: spacing.lg,
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
	circleWrap: {
		alignItems: 'center',
	},
	circle: {
		width: CIRCLE_SIZE,
		height: CIRCLE_SIZE,
		position: 'relative',
	},
	slot: {
		position: 'absolute',
		width: SLOT_SIZE,
		height: SLOT_SIZE,
		alignItems: 'center',
		justifyContent: 'center',
		borderRadius: radius.md,
		padding: spacing.xs,
		gap: 2,
	},
	slotActive: {
		borderWidth: 2,
		borderColor: colors.brand,
		backgroundColor: colors.brandDim,
	},
	avatarPlaceholder: {
		width: 40,
		height: 40,
		borderRadius: radius.full,
		backgroundColor: colors.border,
	},
	slotName: {
		fontSize: font.sm,
		color: colors.text,
		maxWidth: SLOT_SIZE,
	},
	winner: {
		alignItems: 'center',
		padding: spacing.md,
		borderRadius: radius.md,
		backgroundColor: colors.brandDim,
	},
	winnerText: {
		fontSize: font.lg,
		fontWeight: '700',
		color: colors.brand,
	},
})
