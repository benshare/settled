// The game screen's header title. With more than one game in flight it becomes
// a horizontal switcher — one tab per game, oldest-created on the left — so a
// player juggling several boards can move between them without going back out
// to the Games list.

import { useAuth } from '@/lib/auth'
import { Avatar } from '@/lib/modules/Avatar'
import { useGamesStore, type Game } from '@/lib/stores/useGamesStore'
import type { Profile } from '@/lib/stores/useProfileStore'
import { colors, font, radius, spacing } from '@/lib/theme'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useRef } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useGame } from './gameContext'

const AVATAR_SIZE = 26
// How many faces a tab shows before collapsing the rest into a "+N".
const MAX_FACES = 3
const TURN_BADGE_SIZE = 10

export function GameTitle({ gameId }: { gameId: string }) {
	const activeGames = useGamesStore((s) => s.activeGames)
	const spectatableGames = useGamesStore((s) => s.spectatableGames)

	// Games I'm seated at plus the friends' games I'm allowed to watch, oldest
	// first. Completed games aren't switchable — one opened from History has no
	// tab of its own, so it falls back to the plain title.
	const games = useMemo(() => {
		const all = [...(activeGames ?? []), ...(spectatableGames ?? [])]
		return all.sort((a, b) => a.created_at.localeCompare(b.created_at))
	}, [activeGames, spectatableGames])

	if (games.length < 2 || !games.some((g) => g.id === gameId)) {
		return <CurrentGameTitle />
	}
	return <GameTabs games={games} currentId={gameId} />
}

// "Game with alice" for a 1v1, "Game with 3 others" beyond that. Named from
// the viewer's seat, so a spectator counts every player as an "other".
function CurrentGameTitle() {
	const { game } = useGame()
	const { user } = useAuth()
	const profilesById = useGamesStore((s) => s.profilesById)

	const others = (game?.player_order ?? []).filter((uid) => uid !== user?.id)
	const title =
		others.length === 0
			? 'Game'
			: others.length === 1
				? `Game with ${profilesById[others[0]]?.username ?? 'player'}`
				: `Game with ${others.length} others`

	return (
		<Text style={styles.title} numberOfLines={1}>
			{title}
		</Text>
	)
}

function GameTabs({ games, currentId }: { games: Game[]; currentId: string }) {
	const router = useRouter()
	const { user } = useAuth()
	const profilesById = useGamesStore((s) => s.profilesById)

	// Enough games and the current one sits off-screen on landing (a push
	// notification can drop you on the newest game with the strip scrolled to
	// the oldest), so bring it into view whenever it changes.
	const scrollRef = useRef<ScrollView>(null)
	const xById = useRef<Record<string, number>>({})
	useEffect(() => {
		const x = xById.current[currentId]
		if (x === undefined) return
		scrollRef.current?.scrollTo({
			x: Math.max(0, x - spacing.lg),
			animated: true,
		})
	}, [currentId])

	return (
		<ScrollView
			ref={scrollRef}
			horizontal
			showsHorizontalScrollIndicator={false}
			contentContainerStyle={styles.strip}
			style={styles.stripScroll}
		>
			{games.map((game) => (
				<GameTab
					key={game.id}
					game={game}
					active={game.id === currentId}
					meId={user?.id}
					profilesById={profilesById}
					onLayout={(x) => {
						xById.current[game.id] = x
					}}
					// Replace rather than push, so Back always returns to the
					// Games list however many tabs were tapped through.
					onPress={() => {
						if (game.id === currentId) return
						router.replace(`/game/${game.id}`)
					}}
				/>
			))}
		</ScrollView>
	)
}

function GameTab({
	game,
	active,
	meId,
	profilesById,
	onPress,
	onLayout,
}: {
	game: Game
	active: boolean
	meId: string | undefined
	profilesById: Record<string, Profile>
	onPress: () => void
	onLayout: (x: number) => void
}) {
	const others = game.player_order.filter((uid) => uid !== meId)
	const faces = others.slice(0, MAX_FACES)
	const overflow = others.length - faces.length

	// `games.current_turn` is the only turn field readable across games without
	// each one's `game_states` row, so the badge tracks it rather than the
	// phase. That makes it approximate in the one case where the two diverge —
	// during a special build phase `current_turn` has already advanced to the
	// next roller while the acting builder is the head of the phase queue.
	const myIdx = meId ? game.player_order.indexOf(meId) : -1
	const myTurn = myIdx >= 0 && game.current_turn === myIdx

	return (
		<Pressable
			onPress={onPress}
			onLayout={(e) => onLayout(e.nativeEvent.layout.x)}
			style={({ pressed }) => [
				styles.tab,
				active && styles.tabActive,
				pressed && styles.pressed,
			]}
		>
			{faces.map((uid, i) => (
				<View key={uid} style={i > 0 && styles.faceStacked}>
					<Avatar profile={profilesById[uid]} size={AVATAR_SIZE} />
				</View>
			))}
			{overflow > 0 && <Text style={styles.overflow}>+{overflow}</Text>}
			{myTurn && <View style={styles.turnBadge} />}
		</Pressable>
	)
}

const styles = StyleSheet.create({
	title: {
		flex: 1,
		textAlign: 'center',
		fontSize: font.md,
		fontWeight: '700',
		color: colors.text,
	},
	stripScroll: {
		flex: 1,
	},
	strip: {
		alignItems: 'center',
		gap: spacing.xs,
		paddingHorizontal: spacing.xs,
	},
	tab: {
		flexDirection: 'row',
		alignItems: 'center',
		paddingHorizontal: spacing.xs,
		paddingVertical: spacing.xs,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: 'transparent',
		opacity: 0.5,
	},
	tabActive: {
		opacity: 1,
		borderColor: colors.brand,
		backgroundColor: colors.brandDim,
	},
	pressed: {
		opacity: 0.7,
	},
	faceStacked: {
		marginLeft: -AVATAR_SIZE / 3,
	},
	overflow: {
		marginLeft: spacing.xs,
		fontSize: font.sm,
		fontWeight: '700',
		color: colors.text,
	},
	// Ringed in the header's own background so it stays legible against
	// whichever avatar it lands on.
	turnBadge: {
		position: 'absolute',
		top: 0,
		right: 0,
		width: TURN_BADGE_SIZE,
		height: TURN_BADGE_SIZE,
		borderRadius: TURN_BADGE_SIZE / 2,
		backgroundColor: colors.accent,
		borderWidth: 2,
		borderColor: colors.background,
	},
})
