// The fixed row at the top of the game screen: the back chevron and the game
// switcher. It sits outside every SlidingArea on purpose — it holds position
// while everything below it slides between games, which is what makes the tab
// strip a place to switch *from* rather than another thing in motion.

import { useChat } from '@/lib/catan/chatContext'
import { colors, spacing } from '@/lib/theme'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect } from 'react'
import { Pressable, StyleSheet } from 'react-native'
import Animated, {
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from 'react-native-reanimated'
import { isWeb, sharedStyles } from './gameScreenShared'

import { GameTitle } from '@/lib/catan/GameTitle'
import { Ionicons } from '@expo/vector-icons'
import { GameMenu } from './GameMenu'

// Matches the HUD top bar's fade under an open chat panel.
const CHAT_FADE_MS = 180

export function Nav() {
	const { id: gameId } = useLocalSearchParams<{ id: string }>()

	const router = useRouter()

	// The chat panel now runs the full height of the screen, so this row has
	// nothing left to sit against — it fades rather than ghosting through the
	// translucent conversation (the same treatment as the HUD's top bar).
	const { open: chatOpen } = useChat()
	const opacity = useSharedValue(1)
	useEffect(() => {
		opacity.value = withTiming(chatOpen ? 0 : 1, { duration: CHAT_FADE_MS })
	}, [chatOpen, opacity])
	const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }))

	return (
		<Animated.View
			style={[styles.nav, fadeStyle]}
			// `none` while faded, so the strip it occupies falls through to the
			// chat scrim's dismiss layer instead of eating taps.
			pointerEvents={chatOpen ? 'none' : 'box-none'}
		>
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
			{/* The forfeit / end-game menu — the only thing besides the title
			    that is about *which game you're on*. It renders a spacer of the
			    same width when there's nothing to offer (spectator, or a game
			    that's already over), so the title stays centred either way. */}
			<GameMenu />
		</Animated.View>
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
