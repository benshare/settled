import { useAuth } from '@/lib/auth'
import { Avatar } from '@/lib/modules/Avatar'
import { Button } from '@/lib/modules/Button'
import { useGamesStore } from '@/lib/stores/useGamesStore'
import type { Profile } from '@/lib/stores/useProfileStore'
import { colors, font, radius, spacing } from '@/lib/theme'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function GameDetailScreen() {
	const { id } = useLocalSearchParams<{ id: string }>()
	const { user } = useAuth()
	const router = useRouter()
	const activeGames = useGamesStore((s) => s.activeGames)
	const completeGames = useGamesStore((s) => s.completeGames)
	const profilesById = useGamesStore((s) => s.profilesById)
	const complete = useGamesStore((s) => s.complete)

	const game = useMemo(
		() =>
			activeGames.find((g) => g.id === id) ??
			completeGames.find((g) => g.id === id),
		[activeGames, completeGames, id]
	)

	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function onComplete() {
		if (!user?.id || !game) return
		setBusy(true)
		setError(null)
		const { error } = await complete(user.id, game.id)
		setBusy(false)
		if (error) {
			setError(error)
			return
		}
		router.back()
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

			{!game ? (
				<View style={styles.body}>
					<Text style={styles.hint}>Game not found.</Text>
				</View>
			) : (
				<ScrollView contentContainerStyle={styles.body}>
					<View style={styles.card}>
						{game.participants.map((pid) => (
							<PersonRow
								key={pid}
								profile={profilesById[pid]}
								youMark={pid === user?.id}
							/>
						))}
					</View>

					{game.status === 'active' ? (
						<View style={styles.actions}>
							{error && (
								<Text style={styles.errorText}>{error}</Text>
							)}
							<Button
								onPress={onComplete}
								loading={busy}
								disabled={busy}
							>
								Mark complete
							</Button>
						</View>
					) : (
						<Text style={styles.hint}>Completed</Text>
					)}
				</ScrollView>
			)}
		</SafeAreaView>
	)
}

function PersonRow({
	profile,
	youMark,
}: {
	profile: Profile | undefined
	youMark?: boolean
}) {
	return (
		<View style={styles.personRow}>
			{profile ? (
				<Avatar profile={profile} size={40} />
			) : (
				<View style={styles.avatarPlaceholder} />
			)}
			<Text style={styles.personName} numberOfLines={1}>
				{profile?.username ?? '…'}
				{youMark ? ' (you)' : ''}
			</Text>
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
	card: {
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.card,
		borderRadius: radius.md,
		padding: spacing.md,
		gap: spacing.md,
	},
	personRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
	},
	avatarPlaceholder: {
		width: 40,
		height: 40,
	},
	personName: {
		flex: 1,
		fontSize: font.md,
		color: colors.text,
	},
	actions: {
		gap: spacing.sm,
	},
	hint: {
		fontSize: font.base,
		color: colors.textMuted,
		textAlign: 'center',
	},
	errorText: {
		color: colors.error,
		fontSize: font.sm,
		textAlign: 'center',
	},
})
