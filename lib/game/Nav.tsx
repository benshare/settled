// The fixed row at the top of the game screen: the back chevron and the game
// switcher. It sits outside every SlidingArea on purpose — it holds position
// while everything below it slides between games, which is what makes the tab
// strip a place to switch *from* rather than another thing in motion.

import { colors, spacing } from '@/lib/theme'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'
import { isWeb, sharedStyles } from './gameScreenShared'

import { GameTitle } from '@/lib/catan/GameTitle'
import { Ionicons } from '@expo/vector-icons'

export function Nav() {
	const { id: gameId } = useLocalSearchParams<{ id: string }>()

	const router = useRouter()
	return (
		<View style={styles.nav}>
			<Pressable
				onPress={() => router.back()}
				hitSlop={8}
				style={({ pressed }) => [
					styles.back,
					pressed && sharedStyles.pressed,
				]}
			>
				<Ionicons name="chevron-back" size={26} color={colors.text} />
			</Pressable>
			<GameTitle gameId={gameId} />
			{/* Balances the chevron so the title stays centred. */}
			<View style={styles.back} />
		</View>
	)
}

const styles = StyleSheet.create({
	nav: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingHorizontal: spacing.md,
		paddingTop: isWeb ? 2 : spacing.sm,
		paddingBottom: isWeb ? 2 : spacing.sm,
	},
	back: {
		width: isWeb ? 32 : 40,
		height: isWeb ? 32 : 40,
		alignItems: 'center',
		justifyContent: 'center',
	},
})
