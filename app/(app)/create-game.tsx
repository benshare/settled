import { useAuth } from '@/lib/auth'
import { Avatar } from '@/lib/modules/Avatar'
import { Button } from '@/lib/modules/Button'
import { Input } from '@/lib/modules/Input'
import { useFriendsStore, type FriendEntry } from '@/lib/stores/useFriendsStore'
import { useGamesStore } from '@/lib/stores/useGamesStore'
import { useTheme } from '@/lib/ThemeContext'
import { ColorScheme, font, spacing } from '@/lib/theme'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import {
	KeyboardAvoidingView,
	Platform,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function CreateGameScreen() {
	const { user } = useAuth()
	const router = useRouter()
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const friends = useFriendsStore((s) => s.friends)
	const createRequest = useGamesStore((s) => s.createRequest)

	const [query, setQuery] = useState('')
	const [selected, setSelected] = useState<Set<string>>(new Set())
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase()
		if (!q) return friends
		return friends.filter((f) =>
			f.profile.username.toLowerCase().includes(q)
		)
	}, [friends, query])

	function toggle(id: string) {
		setSelected((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}

	async function onCreate() {
		if (!user?.id || selected.size === 0) return
		setBusy(true)
		setError(null)
		const { error } = await createRequest(user.id, Array.from(selected))
		setBusy(false)
		if (error) {
			setError(error)
			return
		}
		router.replace('/play')
	}

	return (
		<SafeAreaView style={styles.safe}>
			<KeyboardAvoidingView
				style={styles.flex}
				behavior={Platform.OS === 'ios' ? 'padding' : undefined}
			>
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
					<Text style={styles.title}>Create game</Text>
					<View style={styles.back} />
				</View>

				{friends.length === 0 ? (
					<View style={styles.emptyWrap}>
						<Text style={styles.hint}>
							Add friends before starting a game.
						</Text>
					</View>
				) : (
					<>
						<ScrollView
							contentContainerStyle={styles.container}
							keyboardShouldPersistTaps="handled"
						>
							<Input
								value={query}
								onChangeText={setQuery}
								placeholder="Search friends"
								autoCapitalize="none"
								autoCorrect={false}
							/>

							{filtered.length === 0 ? (
								<Text style={styles.hint}>
									No friends match.
								</Text>
							) : (
								<View style={styles.list}>
									{filtered.map((f) => (
										<FriendToggleRow
											key={f.otherId}
											friend={f}
											selected={selected.has(f.otherId)}
											onToggle={() => toggle(f.otherId)}
										/>
									))}
								</View>
							)}
						</ScrollView>

						<View style={styles.footer}>
							{error && (
								<Text style={styles.errorText}>{error}</Text>
							)}
							<Button
								onPress={onCreate}
								loading={busy}
								disabled={busy || selected.size === 0}
							>
								{selected.size === 0
									? 'Create game'
									: `Create game (${selected.size})`}
							</Button>
						</View>
					</>
				)}
			</KeyboardAvoidingView>
		</SafeAreaView>
	)
}

function FriendToggleRow({
	friend,
	selected,
	onToggle,
}: {
	friend: FriendEntry
	selected: boolean
	onToggle: () => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<Pressable
			onPress={onToggle}
			style={({ pressed }) => [styles.row, pressed && styles.pressed]}
		>
			<Avatar profile={friend.profile} size={40} />
			<Text style={styles.rowUsername} numberOfLines={1}>
				{friend.profile.username}
			</Text>
			<View style={[styles.check, selected && styles.checkSelected]}>
				{selected && (
					<Ionicons name="checkmark" size={18} color={colors.white} />
				)}
			</View>
		</Pressable>
	)
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		safe: {
			flex: 1,
			backgroundColor: colors.background,
		},
		flex: {
			flex: 1,
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
		container: {
			padding: spacing.lg,
			gap: spacing.md,
		},
		hint: {
			fontSize: font.base,
			color: colors.textMuted,
			textAlign: 'center',
			marginTop: spacing.lg,
		},
		emptyWrap: {
			flex: 1,
			padding: spacing.lg,
		},
		list: {
			gap: spacing.sm,
		},
		row: {
			flexDirection: 'row',
			alignItems: 'center',
			gap: spacing.sm,
			paddingVertical: spacing.sm,
		},
		rowUsername: {
			flex: 1,
			fontSize: font.md,
			color: colors.text,
		},
		check: {
			width: 28,
			height: 28,
			borderRadius: 999,
			borderWidth: 1.5,
			borderColor: colors.border,
			alignItems: 'center',
			justifyContent: 'center',
			backgroundColor: colors.background,
		},
		checkSelected: {
			backgroundColor: colors.brand,
			borderColor: colors.brand,
		},
		footer: {
			padding: spacing.lg,
			gap: spacing.sm,
			borderTopWidth: 1,
			borderTopColor: colors.border,
			backgroundColor: colors.background,
		},
		errorText: {
			color: colors.error,
			fontSize: font.sm,
			textAlign: 'center',
		},
	})
}
