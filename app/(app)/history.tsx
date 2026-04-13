import { useAuth } from '@/lib/auth'
import {
	describePendingRequest,
	type Game,
	type GameRequest,
	useGamesStore,
} from '@/lib/stores/useGamesStore'
import type { Profile } from '@/lib/stores/useProfileStore'
import { colors, font, radius, spacing } from '@/lib/theme'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import {
	ActivityIndicator,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function HistoryScreen() {
	const { user } = useAuth()
	const router = useRouter()
	const pendingRequests = useGamesStore((s) => s.pendingRequests)
	const activeGames = useGamesStore((s) => s.activeGames)
	const completeGames = useGamesStore((s) => s.completeGames)
	const profilesById = useGamesStore((s) => s.profilesById)
	const loading = useGamesStore((s) => s.loading)

	const allEmpty =
		pendingRequests.length === 0 &&
		activeGames.length === 0 &&
		completeGames.length === 0

	return (
		<SafeAreaView style={styles.safe}>
			<ScrollView contentContainerStyle={styles.container}>
				<Text style={styles.title}>History</Text>

				{loading && allEmpty ? (
					<ActivityIndicator color={colors.textMuted} />
				) : null}

				{pendingRequests.length > 0 && (
					<View style={styles.section}>
						<Text style={styles.sectionHeading}>Pending</Text>
						{pendingRequests.map((r) => (
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

				{activeGames.length > 0 && (
					<View style={styles.section}>
						<Text style={styles.sectionHeading}>Active</Text>
						{activeGames.map((g) => (
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

				{completeGames.length > 0 && (
					<View style={styles.section}>
						<Text style={styles.sectionHeading}>Complete</Text>
						{completeGames.map((g) => (
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

				{!loading && allEmpty && (
					<Text style={styles.emptyText}>No games yet.</Text>
				)}
			</ScrollView>
		</SafeAreaView>
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
	const { label } = describePendingRequest(request, meId, profilesById)
	return (
		<Pressable
			onPress={onPress}
			style={({ pressed }) => [styles.row, pressed && styles.pressed]}
		>
			<View style={styles.rowText}>
				<Text style={styles.rowPrimary} numberOfLines={1}>
					{label}
				</Text>
				<Text style={styles.rowSecondary}>
					{formatDate(request.created_at)}
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
			<View style={styles.rowText}>
				<Text style={styles.rowPrimary} numberOfLines={1}>
					{names}
				</Text>
				<Text style={styles.rowSecondary}>
					{formatDate(game.created_at)}
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

const styles = StyleSheet.create({
	safe: {
		flex: 1,
		backgroundColor: colors.background,
	},
	container: {
		padding: spacing.lg,
		gap: spacing.lg,
	},
	title: {
		fontSize: font.xl,
		fontWeight: '700',
		color: colors.text,
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
	pressed: {
		opacity: 0.7,
	},
	rowText: {
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
