import { BoardView } from '@/lib/catan/BoardView'
import { GameProvider, useGame } from '@/lib/catan/gameContext'
import { colors, font, spacing } from '@/lib/theme'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
	ActivityIndicator,
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
	const { game, gameState, ready } = useGame()

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

	return (
		<View style={styles.boardContainer}>
			{gameState ? (
				<BoardView state={gameState} />
			) : (
				<ActivityIndicator color={colors.brand} />
			)}
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
	boardContainer: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
	},
})
