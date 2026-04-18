import { useAuth } from '@/lib/auth'
import { Avatar } from '@/lib/modules/Avatar'
import { Button } from '@/lib/modules/Button'
import {
	type Game,
	type GameEvent,
	useGamesStore,
} from '@/lib/stores/useGamesStore'
import type { Profile } from '@/lib/stores/useProfileStore'
import { supabase } from '@/lib/supabase'
import { colors, font, radius, spacing } from '@/lib/theme'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
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
	const { user } = useAuth()
	const router = useRouter()
	const activeGames = useGamesStore((s) => s.activeGames)
	const completeGames = useGamesStore((s) => s.completeGames)
	const profilesById = useGamesStore((s) => s.profilesById)
	const rollDice = useGamesStore((s) => s.rollDice)
	const storeLoaded = activeGames !== undefined && completeGames !== undefined

	const storeGame = useMemo(
		() =>
			(activeGames ?? []).find((g) => g.id === id) ??
			(completeGames ?? []).find((g) => g.id === id),
		[activeGames, completeGames, id]
	)

	const [liveGame, setLiveGame] = useState<Game | undefined>(storeGame)
	useEffect(() => {
		if (storeGame && !liveGame) setLiveGame(storeGame)
	}, [storeGame, liveGame])

	useEffect(() => {
		if (!id) return
		const channel = supabase
			.channel(`game:${id}`)
			.on(
				'postgres_changes',
				{
					event: 'UPDATE',
					schema: 'public',
					table: 'games',
					filter: `id=eq.${id}`,
				},
				(payload) => setLiveGame(payload.new as Game)
			)
			.subscribe()
		return () => {
			supabase.removeChannel(channel)
		}
	}, [id])

	const game = liveGame ?? storeGame
	const events = useMemo(
		() => (game?.events as GameEvent[] | undefined) ?? [],
		[game]
	)

	const [rolling, setRolling] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function onRoll() {
		if (!game) return
		setRolling(true)
		setError(null)
		const { error } = await rollDice(game.id)
		setRolling(false)
		if (error) {
			setError(error)
		}
	}

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

			{!game && !storeLoaded ? (
				<View style={[styles.body, styles.center]}>
					<ActivityIndicator color={colors.brand} />
				</View>
			) : !game ? (
				<View style={styles.body}>
					<Text style={styles.hint}>Game not found.</Text>
				</View>
			) : game.status === 'setup' ? (
				<View style={[styles.body, styles.center]}>
					<ActivityIndicator color={colors.brand} />
					<Text style={styles.hint}>Starting soon…</Text>
				</View>
			) : (
				<ScrollView contentContainerStyle={styles.body}>
					{game.status === 'complete' && (
						<WinnerCallout
							game={game}
							profilesById={profilesById}
						/>
					)}

					<PlayerCircle
						playerOrder={game.player_order}
						scores={game.scores}
						currentTurn={
							game.status === 'active' ? game.current_turn : null
						}
						profilesById={profilesById}
						meId={user?.id}
					/>

					{game.status === 'active' && (
						<View style={styles.actions}>
							{error && (
								<Text style={styles.errorText}>{error}</Text>
							)}
							<Button
								onPress={onRoll}
								loading={rolling}
								disabled={
									rolling ||
									game.player_order[
										game.current_turn ?? -1
									] !== user?.id
								}
							>
								{turnLabel(game, user?.id, profilesById)}
							</Button>
						</View>
					)}

					<EventFeed
						events={events}
						playerOrder={game.player_order}
						profilesById={profilesById}
					/>
				</ScrollView>
			)}
		</SafeAreaView>
	)
}

function turnLabel(
	game: Game,
	meId: string | undefined,
	profilesById: Record<string, Profile>
): string {
	if (game.current_turn === null) return 'Roll'
	const turnUser = game.player_order[game.current_turn]
	if (turnUser === meId) return 'Roll'
	const name = profilesById[turnUser]?.username ?? '…'
	return `Waiting for ${name}…`
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
	scores,
	currentTurn,
	profilesById,
	meId,
}: {
	playerOrder: string[]
	scores: number[]
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
							<Text style={styles.slotScore}>{scores[i]}</Text>
						</View>
					)
				})}
			</View>
		</View>
	)
}

function EventFeed({
	events,
	playerOrder,
	profilesById,
}: {
	events: GameEvent[]
	playerOrder: string[]
	profilesById: Record<string, Profile>
}) {
	const tail = events.slice(-20)
	if (tail.length === 0) return null
	return (
		<View style={styles.feed}>
			{tail.map((e, i) => (
				<Text key={i} style={styles.feedLine}>
					{formatEvent(e, playerOrder, profilesById)}
				</Text>
			))}
		</View>
	)
}

function formatEvent(
	e: GameEvent,
	playerOrder: string[],
	profilesById: Record<string, Profile>
): string {
	switch (e.kind) {
		case 'setup_complete':
			return 'Game started'
		case 'roll': {
			const name =
				profilesById[playerOrder[e.player_index]]?.username ?? '…'
			return `${name} rolled a ${e.value} (total ${e.new_score})`
		}
		case 'game_complete': {
			const name =
				profilesById[playerOrder[e.winner_index]]?.username ?? '…'
			return `${name} wins!`
		}
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
	slotScore: {
		fontSize: font.sm,
		color: colors.textSecondary,
		fontWeight: '700',
	},
	actions: {
		gap: spacing.sm,
	},
	errorText: {
		color: colors.error,
		fontSize: font.sm,
		textAlign: 'center',
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
	feed: {
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.card,
		borderRadius: radius.md,
		padding: spacing.md,
		gap: spacing.xs,
	},
	feedLine: {
		fontSize: font.sm,
		color: colors.textSecondary,
	},
})
