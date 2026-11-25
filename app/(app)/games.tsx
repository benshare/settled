import { useAuth } from '@/lib/auth'
import { Avatar } from '@/lib/modules/Avatar'
import { useGameStatesStore } from '@/lib/stores/useGameStatesStore'
import {
	describePendingRequest,
	isFinished,
	isMyTurn,
	needsMyResponse,
	useGamesStore,
	type Game,
	type GameRequest,
} from '@/lib/stores/useGamesStore'
import type { Profile } from '@/lib/stores/useProfileStore'
import { useTheme } from '@/lib/ThemeContext'
import { ColorScheme, font, radius, spacing } from '@/lib/theme'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import {
	ActivityIndicator,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

const TURN_BADGE_SIZE = 10

export default function GamesScreen() {
	const { user } = useAuth()
	const router = useRouter()
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const pendingRequests = useGamesStore((s) => s.pendingRequests)
	const activeGames = useGamesStore((s) => s.activeGames)
	const spectatableGames = useGamesStore((s) => s.spectatableGames)
	const completeGames = useGamesStore((s) => s.completeGames)
	const unseenGameIds = useGamesStore((s) => s.unseenGameIds)
	const pinnedGames = useGamesStore((s) => s.pinnedGames)
	const profilesById = useGamesStore((s) => s.profilesById)
	const [historyOpen, setHistoryOpen] = useState(false)

	// Invites I still owe an answer sit unheaded at the very top — they're the
	// only thing on this screen asking for an action outside a game. The rest
	// (mine to send, already answered, dead) wait under Pending.
	const [toAnswer, awaitingOthers] = useMemo(() => {
		const toAnswer: GameRequest[] = []
		const awaitingOthers: GameRequest[] = []
		for (const r of pendingRequests ?? []) {
			if (needsMyResponse(r, user?.id)) toAnswer.push(r)
			else awaitingOthers.push(r)
		}
		return [toAnswer, awaitingOthers]
	}, [pendingRequests, user?.id])

	// A finished game stays up under Active, tagged, until I've opened its
	// result; only then does it drop to History.
	const [unseenFinished, history] = useMemo(() => {
		const unseen: Game[] = []
		const seen: Game[] = []
		for (const g of completeGames ?? []) {
			if (unseenGameIds.includes(g.id)) unseen.push(g)
			else seen.push(g)
		}
		return [unseen, seen]
	}, [completeGames, unseenGameIds])

	// A pinned game is lifted out of Watch rather than listed twice.
	const watchable = useMemo(() => {
		const pinnedIds = new Set((pinnedGames ?? []).map((g) => g.id))
		return (spectatableGames ?? []).filter((g) => !pinnedIds.has(g.id))
	}, [spectatableGames, pinnedGames])

	const storeLoaded =
		pendingRequests !== undefined &&
		activeGames !== undefined &&
		spectatableGames !== undefined &&
		completeGames !== undefined
	// A populated Watch list isn't "no games yet" in spirit, but the prompt to
	// start one reads as wrong sitting under a list of games on screen.
	const showEmpty =
		storeLoaded &&
		pendingRequests.length === 0 &&
		activeGames.length === 0 &&
		spectatableGames.length === 0 &&
		completeGames.length === 0 &&
		(pinnedGames ?? []).length === 0

	return (
		<SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
			<ScrollView contentContainerStyle={styles.container}>
				<View style={styles.header}>
					<Text style={styles.title}>Games</Text>
					<Pressable
						onPress={() => router.push('/create-game')}
						style={({ pressed }) => [
							styles.addButton,
							pressed && styles.pressed,
						]}
						hitSlop={8}
					>
						<Ionicons
							name="add-outline"
							size={24}
							color={colors.text}
						/>
					</Pressable>
				</View>

				{!storeLoaded ? (
					<ActivityIndicator color={colors.textMuted} />
				) : null}

				{toAnswer.length > 0 && (
					<View style={styles.section}>
						{toAnswer.map((r) => (
							<PendingRow
								key={r.id}
								request={r}
								meId={user?.id}
								profilesById={profilesById}
								onPress={() =>
									router.push(`/game/request/${r.id}`)
								}
							/>
						))}
					</View>
				)}

				{unseenFinished.length + (activeGames ?? []).length > 0 && (
					<View style={styles.section}>
						<Text style={styles.sectionHeading}>Active</Text>
						{unseenFinished.map((g) => (
							<GameRow
								key={g.id}
								game={g}
								profilesById={profilesById}
								meId={user?.id}
								onPress={() => router.push(`/game/${g.id}`)}
							/>
						))}
						{(activeGames ?? []).map((g) => (
							<GameRow
								key={g.id}
								game={g}
								profilesById={profilesById}
								meId={user?.id}
								onPress={() => router.push(`/game/${g.id}`)}
							/>
						))}
					</View>
				)}

				{awaitingOthers.length > 0 && (
					<View style={styles.section}>
						<Text style={styles.sectionHeading}>Pending</Text>
						{awaitingOthers.map((r) => (
							<PendingRow
								key={r.id}
								request={r}
								meId={user?.id}
								profilesById={profilesById}
								onPress={() =>
									router.push(`/game/request/${r.id}`)
								}
							/>
						))}
					</View>
				)}

				{(pinnedGames ?? []).length > 0 && (
					<View style={styles.section}>
						<Text style={styles.sectionHeading}>Pinned</Text>
						{(pinnedGames ?? []).map((g) => (
							<SpectateRow
								key={g.id}
								game={g}
								profilesById={profilesById}
								onPress={() => router.push(`/game/${g.id}`)}
							/>
						))}
					</View>
				)}

				{watchable.length > 0 && (
					<View style={styles.section}>
						<Text style={styles.sectionHeading}>Watch</Text>
						{watchable.map((g) => (
							<SpectateRow
								key={g.id}
								game={g}
								profilesById={profilesById}
								onPress={() => router.push(`/game/${g.id}`)}
							/>
						))}
					</View>
				)}

				{history.length > 0 && (
					<View style={styles.section}>
						<Pressable
							onPress={() => setHistoryOpen((open) => !open)}
							style={({ pressed }) => [
								styles.historyHeader,
								pressed && styles.pressed,
							]}
							hitSlop={8}
						>
							<Text style={styles.sectionHeading}>History</Text>
							<Ionicons
								name={
									historyOpen
										? 'chevron-down'
										: 'chevron-forward'
								}
								size={16}
								color={colors.textSecondary}
							/>
						</Pressable>
						{historyOpen &&
							history.map((g) => (
								<GameHistoryRow
									key={g.id}
									game={g}
									profilesById={profilesById}
									meId={user?.id}
									onPress={() => router.push(`/game/${g.id}`)}
								/>
							))}
					</View>
				)}

				{showEmpty && (
					<Text style={styles.emptyText}>
						No games yet. Tap + to start one.
					</Text>
				)}
			</ScrollView>
		</SafeAreaView>
	)
}

function PendingRow({
	request,
	meId,
	profilesById,
	onPress,
}: {
	request: GameRequest
	meId: string | undefined
	profilesById: Record<string, Profile>
	onPress: () => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const { label, proposerProfile, mineIsProposer } = describePendingRequest(
		request,
		meId,
		profilesById
	)
	return (
		<Pressable
			onPress={onPress}
			style={({ pressed }) => [styles.row, pressed && styles.pressed]}
		>
			{mineIsProposer ? (
				<Ionicons
					name="paper-plane-outline"
					size={24}
					color={colors.text}
					style={styles.rowIcon}
				/>
			) : proposerProfile ? (
				<Avatar profile={proposerProfile} size={40} />
			) : (
				<View style={styles.avatarPlaceholder} />
			)}
			<Text style={styles.rowText} numberOfLines={1}>
				{label}
			</Text>
			<Ionicons
				name="chevron-forward"
				size={20}
				color={colors.textMuted}
			/>
		</Pressable>
	)
}

function GameRow({
	game,
	profilesById,
	meId,
	onPress,
}: {
	game: Game
	profilesById: Record<string, Profile>
	meId: string | undefined
	onPress: () => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const names = game.participants
		.map((id) => {
			if (id === meId) return 'me'
			return profilesById[id]?.username ?? '…'
		})
		.join(', ')

	const state = useGameStatesStore((s) => s.byId[game.id])
	const myTurn = isMyTurn(game, meId, state)
	const finished = isFinished(game.status)

	return (
		<Pressable
			onPress={onPress}
			style={({ pressed }) => [styles.row, pressed && styles.pressed]}
		>
			<Ionicons
				name="game-controller-outline"
				size={24}
				color={colors.text}
				style={styles.rowIcon}
			/>
			<Text style={styles.rowText} numberOfLines={1}>
				{names}
			</Text>
			{finished ? (
				<FinishedTag game={game} />
			) : (
				myTurn && <View style={styles.turnBadge} />
			)}
			<Ionicons
				name="chevron-forward"
				size={20}
				color={colors.textMuted}
			/>
		</Pressable>
	)
}

// A game the viewer isn't in but is allowed to watch. No "me" in the name list
// — they're not at the table — and no seat, so the row is purely descriptive.
function SpectateRow({
	game,
	profilesById,
	onPress,
}: {
	game: Game
	profilesById: Record<string, Profile>
	onPress: () => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const names = game.participants.map(
		(id) => profilesById[id]?.username ?? '…'
	)
	const label =
		names.length > 3
			? `${names.slice(0, 3).join(', ')}, +${names.length - 3}`
			: names.join(', ')
	return (
		<Pressable
			onPress={onPress}
			style={({ pressed }) => [styles.row, pressed && styles.pressed]}
		>
			<Ionicons
				name="eye-outline"
				size={24}
				color={colors.text}
				style={styles.rowIcon}
			/>
			<Text style={styles.rowText} numberOfLines={1}>
				{label}
			</Text>
			{isFinished(game.status) && <FinishedTag game={game} />}
			<Ionicons
				name="chevron-forward"
				size={20}
				color={colors.textMuted}
			/>
		</Pressable>
	)
}

// Marks a finished game sitting in a list of live ones (an unseen result under
// Active, an ended game under Pinned).
function FinishedTag({ game }: { game: Game }) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<View style={styles.tag}>
			<Text style={styles.tagText}>
				{game.status === 'canceled' ? 'Canceled' : 'Complete'}
			</Text>
		</View>
	)
}

// A finished game, listed under History: same participants, but dated rather
// than tappable-into-a-turn, so the row carries a secondary line instead of an
// icon.
function GameHistoryRow({
	game,
	profilesById,
	meId,
	onPress,
}: {
	game: Game
	profilesById: Record<string, Profile>
	meId: string | undefined
	onPress: () => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const names = game.participants
		.map((id) => {
			if (id === meId) return 'me'
			return profilesById[id]?.username ?? '…'
		})
		.join(', ')
	return (
		<Pressable
			onPress={onPress}
			style={({ pressed }) => [styles.row, pressed && styles.pressed]}
		>
			<View style={styles.historyRowText}>
				<Text style={styles.rowPrimary} numberOfLines={1}>
					{names}
				</Text>
				<Text style={styles.rowSecondary}>
					{formatDate(game.created_at)}
					{game.status === 'canceled' && ' · Canceled'}
				</Text>
			</View>
			<Ionicons
				name="chevron-forward"
				size={20}
				color={colors.textMuted}
			/>
		</Pressable>
	)
}

function formatDate(iso: string): string {
	const d = new Date(iso)
	return d.toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
	})
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		safe: {
			flex: 1,
			backgroundColor: colors.background,
		},
		container: {
			padding: spacing.lg,
			gap: spacing.lg,
		},
		header: {
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'space-between',
		},
		title: {
			fontSize: font.xl,
			fontWeight: '700',
			color: colors.text,
		},
		addButton: {
			width: 40,
			height: 40,
			borderRadius: 999,
			alignItems: 'center',
			justifyContent: 'center',
			backgroundColor: colors.card,
			borderWidth: 1,
			borderColor: colors.border,
		},
		pressed: {
			opacity: 0.7,
		},
		section: {
			gap: spacing.sm,
		},
		sectionHeading: {
			fontSize: font.sm,
			fontWeight: '600',
			letterSpacing: 0.5,
			textTransform: 'uppercase',
			color: colors.textSecondary,
		},
		row: {
			flexDirection: 'row',
			alignItems: 'center',
			gap: spacing.sm,
			paddingVertical: spacing.sm,
			paddingHorizontal: spacing.md,
			borderWidth: 1,
			borderColor: colors.border,
			backgroundColor: colors.card,
			borderRadius: radius.md,
		},
		rowIcon: {
			width: 40,
			textAlign: 'center',
		},
		avatarPlaceholder: {
			width: 40,
			height: 40,
		},
		rowText: {
			flex: 1,
			fontSize: font.md,
			color: colors.text,
		},
		turnBadge: {
			width: TURN_BADGE_SIZE,
			height: TURN_BADGE_SIZE,
			borderRadius: TURN_BADGE_SIZE / 2,
			backgroundColor: colors.accent,
		},
		tag: {
			paddingHorizontal: spacing.sm,
			paddingVertical: 2,
			borderRadius: radius.full,
			backgroundColor: colors.accentDim,
		},
		tagText: {
			fontSize: font.xs,
			fontWeight: '600',
			color: colors.accent,
		},
		historyHeader: {
			flexDirection: 'row',
			alignItems: 'center',
			gap: spacing.xs,
		},
		historyRowText: {
			flex: 1,
			gap: 2,
		},
		rowPrimary: {
			fontSize: font.md,
			color: colors.text,
		},
		rowSecondary: {
			fontSize: font.sm,
			color: colors.textMuted,
		},
		emptyText: {
			fontSize: font.base,
			color: colors.textMuted,
			textAlign: 'center',
			marginTop: spacing.xl,
		},
	})
}
