// A `Modal` whose body can be collapsed away, leaving just its title bar.
// Anchored to the top rather than centered so the header holds position as the
// body collapses — minimizing shrinks the sheet upward, revealing whatever is
// behind it. That's the whole point: use this for a prompt the player may need
// to consult the screen behind (the game board) before answering, instead of
// forcing them to dismiss and reopen.

import { Ionicons } from '@expo/vector-icons'
import { ReactNode, useMemo, useState } from 'react'
import {
	Pressable,
	StyleProp,
	StyleSheet,
	Text,
	View,
	ViewStyle,
} from 'react-native'
import Animated, {
	FadeIn,
	FadeOut,
	LinearTransition,
	useAnimatedStyle,
	withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Modal } from './Modal'
import { ColorScheme, font, spacing } from '../theme'
import { useTheme } from '../ThemeContext'

const DURATION = 220

export function MinimizableModal({
	title,
	visible = true,
	onDismiss,
	dismissOnBackdropPress = true,
	contentStyle,
	children,
}: {
	title: string
	visible?: boolean
	onDismiss?: () => void
	dismissOnBackdropPress?: boolean
	contentStyle?: StyleProp<ViewStyle>
	children: ReactNode
}) {
	const { colors } = useTheme()
	const insets = useSafeAreaInsets()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const [minimized, setMinimized] = useState(false)

	// Single chevron that flips by mirroring on the Y axis (scaleY 1 → -1);
	// animating through 0 reads as a vertical flip rather than a swap. Driven
	// straight off `minimized` — the worklet re-runs when it changes and
	// withTiming animates to the new target.
	const chevronStyle = useAnimatedStyle(() => ({
		transform: [
			{ scaleY: withTiming(minimized ? -1 : 1, { duration: DURATION }) },
		],
	}))

	return (
		<Modal
			visible={visible}
			onDismiss={onDismiss}
			dismissOnBackdropPress={dismissOnBackdropPress}
			contentStyle={[styles.sheet, contentStyle]}
			backdropStyle={[
				styles.backdrop,
				{ paddingTop: insets.top + spacing.lg },
			]}
			layout={LinearTransition.duration(DURATION)}
		>
			<View style={styles.titleRow}>
				<Text style={styles.title}>{title}</Text>
				<Pressable
					onPress={() => setMinimized((m) => !m)}
					hitSlop={8}
					style={({ pressed }) => pressed && styles.pressed}
				>
					<Animated.View style={chevronStyle}>
						<Ionicons
							name="chevron-down"
							size={22}
							color={colors.textSecondary}
						/>
					</Animated.View>
				</Pressable>
			</View>
			{!minimized && (
				<Animated.View
					entering={FadeIn.duration(180)}
					exiting={FadeOut.duration(160)}
					style={styles.body}
				>
					{children}
				</Animated.View>
			)}
		</Modal>
	)
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		backdrop: {
			flex: 1,
			backgroundColor: 'rgba(0,0,0,0.55)',
			alignItems: 'center',
			justifyContent: 'flex-start',
			paddingHorizontal: spacing.lg,
			paddingBottom: spacing.lg,
		},
		sheet: {
			width: '100%',
			backgroundColor: colors.card,
			padding: spacing.lg,
			gap: spacing.md,
			overflow: 'hidden',
		},
		body: {
			gap: spacing.md,
		},
		titleRow: {
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'space-between',
			gap: spacing.sm,
		},
		title: {
			flex: 1,
			fontSize: font.lg,
			fontWeight: '700',
			color: colors.text,
		},
		pressed: {
			opacity: 0.8,
		},
	})
}
