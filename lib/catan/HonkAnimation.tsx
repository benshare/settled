// The goose shown to a honked player: pops in, wobbles for a beat over
// "<name> honked you", and fades out on its own (or on a tap). Decorative only
// — the honk itself is the log line and the push. Triggering lives in
// `lib/game/useHonkAlert.ts`; the art is `assets/images/goose.png`.

import { useEffect } from 'react'
import { Image, Modal, Pressable, StyleSheet, Text } from 'react-native'
import Animated, {
	Easing,
	runOnJS,
	useAnimatedStyle,
	useSharedValue,
	withDelay,
	withRepeat,
	withSequence,
	withSpring,
	withTiming,
} from 'react-native-reanimated'
import { font, spacing } from '../theme'

const GOOSE_SIZE = 160
const WOBBLE_DEG = 9
const WOBBLE_MS = 110
const HOLD_MS = 2200
const FADE_OUT_MS = 260

export function HonkAnimation({
	text,
	onDismiss,
}: {
	text: string
	onDismiss: () => void
}) {
	const opacity = useSharedValue(0)
	const scale = useSharedValue(0.4)
	const twist = useSharedValue(0)

	useEffect(() => {
		opacity.value = withSequence(
			withTiming(1, { duration: 160 }),
			withDelay(
				HOLD_MS,
				withTiming(0, { duration: FADE_OUT_MS }, (finished) => {
					if (finished) runOnJS(onDismiss)()
				})
			)
		)
		scale.value = withSpring(1, { damping: 7, stiffness: 180 })
		// A shake in bursts rather than a constant buzz: three quick twists,
		// a pause, repeat.
		const ease = { duration: WOBBLE_MS, easing: Easing.inOut(Easing.quad) }
		twist.value = withRepeat(
			withSequence(
				withTiming(-WOBBLE_DEG, ease),
				withTiming(WOBBLE_DEG, ease),
				withTiming(-WOBBLE_DEG * 0.6, ease),
				withTiming(WOBBLE_DEG * 0.6, ease),
				withTiming(0, ease),
				withDelay(260, withTiming(0, { duration: 0 }))
			),
			-1
		)
		// Scoped to mount; the parent remounts via key for a new honk.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }))
	const gooseStyle = useAnimatedStyle(() => ({
		transform: [
			{ scale: scale.value },
			{ rotate: `${twist.value}deg` },
			{ translateX: twist.value * 0.4 },
		],
	}))

	return (
		<Modal
			visible
			transparent
			animationType="none"
			onRequestClose={onDismiss}
		>
			<Pressable style={StyleSheet.absoluteFill} onPress={onDismiss}>
				<Animated.View style={[styles.backdrop, fadeStyle]}>
					<Animated.View style={gooseStyle}>
						<Image
							source={require('../../assets/images/goose.png')}
							style={styles.goose}
							resizeMode="contain"
						/>
					</Animated.View>
					<Text style={styles.text}>{text}</Text>
				</Animated.View>
			</Pressable>
		</Modal>
	)
}

const styles = StyleSheet.create({
	backdrop: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
		gap: spacing.md,
		backgroundColor: 'rgba(0, 0, 0, 0.35)',
	},
	goose: {
		width: GOOSE_SIZE,
		height: GOOSE_SIZE,
	},
	text: {
		fontSize: font.lg,
		fontWeight: '800',
		color: '#FFFFFF',
		textAlign: 'center',
		paddingHorizontal: spacing.lg,
		textShadowColor: 'rgba(0, 0, 0, 0.6)',
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 4,
	},
})
