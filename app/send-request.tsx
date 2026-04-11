import { useAuth } from '@/lib/auth'
import { Avatar } from '@/lib/modules/Avatar'
import { Button } from '@/lib/modules/Button'
import { Input } from '@/lib/modules/Input'
import {
	SearchRelationship,
	SearchResult,
	useFriendsStore,
} from '@/lib/stores/useFriendsStore'
import { colors, font, spacing } from '@/lib/theme'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
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

export default function SendRequestScreen() {
	const { user } = useAuth()
	const router = useRouter()
	const search = useFriendsStore((s) => s.search)

	const [query, setQuery] = useState('')
	const [results, setResults] = useState<SearchResult[]>([])
	const [searching, setSearching] = useState(false)

	useEffect(() => {
		if (!user?.id) return
		const trimmed = query.trim()
		if (trimmed.length < 2) {
			setResults([])
			setSearching(false)
			return
		}
		setSearching(true)
		const handle = setTimeout(async () => {
			const out = await search(user.id, trimmed)
			setResults(out)
			setSearching(false)
		}, 300)
		return () => clearTimeout(handle)
	}, [query, user?.id, search])

	function updateResultRelationship(
		profileId: string,
		relationship: SearchRelationship
	) {
		setResults((prev) =>
			prev.map((r) =>
				r.profile.id === profileId ? { ...r, relationship } : r
			)
		)
	}

	const trimmedLength = query.trim().length

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
					<Text style={styles.title}>Add friend</Text>
					<View style={styles.back} />
				</View>

				<ScrollView
					contentContainerStyle={styles.container}
					keyboardShouldPersistTaps="handled"
				>
					<Input
						value={query}
						onChangeText={setQuery}
						placeholder="Search by username"
						autoFocus
						autoCapitalize="none"
						autoCorrect={false}
					/>

					{trimmedLength < 2 ? (
						<Text style={styles.hint}>
							Type at least 2 characters
						</Text>
					) : searching ? (
						<Text style={styles.hint}>Searching…</Text>
					) : results.length === 0 ? (
						<Text style={styles.hint}>No users found.</Text>
					) : (
						<View style={styles.list}>
							{results.map((r) => (
								<SearchRow
									key={r.profile.id}
									result={r}
									onUpdateRelationship={
										updateResultRelationship
									}
								/>
							))}
						</View>
					)}
				</ScrollView>
			</KeyboardAvoidingView>
		</SafeAreaView>
	)
}

function SearchRow({
	result,
	onUpdateRelationship,
}: {
	result: SearchResult
	onUpdateRelationship: (
		profileId: string,
		relationship: SearchRelationship
	) => void
}) {
	const { user } = useAuth()
	const sendRequest = useFriendsStore((s) => s.sendRequest)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function onAdd() {
		if (!user?.id) return
		setBusy(true)
		setError(null)
		const { error } = await sendRequest(user.id, result.profile.id)
		setBusy(false)
		if (error) {
			setError(error)
			return
		}
		onUpdateRelationship(result.profile.id, 'pending')
	}

	return (
		<View>
			<View style={styles.row}>
				<Avatar profile={result.profile} size={40} />
				<Text style={styles.rowUsername} numberOfLines={1}>
					{result.profile.username}
				</Text>
				{result.relationship === 'none' ? (
					<Button
						onPress={onAdd}
						loading={busy}
						disabled={busy}
						style={styles.rowAction}
					>
						Add
					</Button>
				) : (
					<Button
						variant="secondary"
						disabled
						style={styles.rowAction}
					>
						{result.relationship === 'friends'
							? 'Friends'
							: result.relationship === 'declined'
								? 'Declined'
								: 'Pending'}
					</Button>
				)}
			</View>
			{error && <Text style={styles.errorText}>{error}</Text>}
		</View>
	)
}

const styles = StyleSheet.create({
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
	list: {
		gap: spacing.md,
	},
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
	},
	rowUsername: {
		flex: 1,
		fontSize: font.md,
		color: colors.text,
	},
	rowAction: {
		paddingHorizontal: spacing.md,
		minHeight: 40,
		paddingVertical: 0,
	},
	errorText: {
		color: colors.error,
		fontSize: font.sm,
		marginTop: spacing.xs,
	},
})
