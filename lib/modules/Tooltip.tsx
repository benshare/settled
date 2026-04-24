// Cross-platform tooltip primitive. Wraps any trigger; shows a small label
// bubble above it on hover (web) or long-press (mobile). Dismisses on
// release. No portal — positioned absolutely relative to the wrapper, so
// ancestors must not clip overflow if the bubble should render outside.
//
// Used by disabled build controls under a curse to explain why the control
// is unavailable. Children are responsible for their own disabled styling;
// the tooltip is purely additive.

import { useState, type ReactNode } from 'react'
import {
	Platform,
	Pressable,
	StyleSheet,
	Text,
	View,
	type PressableProps,
} from 'react-native'
import { useTheme } from '../ThemeContext'
import { font, radius, spacing, type ColorScheme } from '../theme'

type TooltipProps = {
	label: string
	children: ReactNode
	// Position of the bubble relative to the trigger. Defaults to 'top'.
	placement?: 'top' | 'bottom'
	// Fall-through props for the wrapping Pressable (onPress / disabled /
	// accessibilityLabel etc). The tooltip activates on hover (web) or long
	// press (mobile) regardless of onPress behaviour.
	pressableProps?: PressableProps
}

export function Tooltip({
	label,
	children,
	placement = 'top',
	pressableProps,
}: TooltipProps) {
	const { colors } = useTheme()
	const [visible, setVisible] = useState(false)
	const styles = makeStyles(colors)

	// On web, Pressable supports onHoverIn / onHoverOut. On native, we fall
	// back to a long-press that dismisses on press-out. Both routes share the
	// same `visible` state so the bubble rendering is identical.
	const hoverHandlers =
		Platform.OS === 'web'
			? {
					onHoverIn: () => setVisible(true),
					onHoverOut: () => setVisible(false),
				}
			: {
					onLongPress: () => setVisible(true),
					onPressOut: () => setVisible(false),
				}

	return (
		<View style={styles.wrap}>
			<Pressable {...pressableProps} {...hoverHandlers}>
				{children}
			</Pressable>
			{visible && (
				<View
					pointerEvents="none"
					style={[
						styles.bubble,
						placement === 'top'
							? styles.bubbleTop
							: styles.bubbleBottom,
					]}
				>
					<Text style={styles.label}>{label}</Text>
				</View>
			)}
		</View>
	)
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		wrap: {
			position: 'relative',
		},
		bubble: {
			position: 'absolute',
			left: '50%',
			transform: [{ translateX: -80 }],
			width: 160,
			paddingHorizontal: spacing.sm,
			paddingVertical: spacing.xs,
			borderRadius: radius.sm,
			backgroundColor: colors.text,
			shadowColor: '#000',
			shadowOffset: { width: 0, height: 2 },
			shadowOpacity: 0.2,
			shadowRadius: 4,
			elevation: 4,
			zIndex: 10,
		},
		bubbleTop: {
			bottom: '100%',
			marginBottom: spacing.xs,
		},
		bubbleBottom: {
			top: '100%',
			marginTop: spacing.xs,
		},
		label: {
			color: colors.background,
			fontSize: font.xs,
			textAlign: 'center',
			fontWeight: '600',
		},
	})
}
