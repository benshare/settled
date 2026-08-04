// A brief, non-interactive confirmation that something happened. Deliberately
// NOT built on `Modal`: it has no dismissal to keep uniform, and an RN `<Modal>`
// takes the touch responder for its whole window — a toast that swallowed taps
// for a second and a half would be worse than no toast. So it's an in-tree
// `pointerEvents="none"` overlay instead, and the caller mounts it at the root
// of the screen it belongs to (see the stacking note in this directory's
// CLAUDE.md — it needs a `z` token above whatever it floats over).
//
// It owns its own lifetime: pass a message to show it, and `onHide` fires once
// the window has elapsed so the caller can clear the message back to null.

import { useEffect, useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated'
import { useTheme } from '../ThemeContext'
import { ColorScheme, font, radius, spacing } from '../theme'

const TOAST_MS = 1600

export function Toast({
	message,
	onHide,
	duration = TOAST_MS,
}: {
	message: string | null
	onHide: () => void
	duration?: number
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])

	useEffect(() => {
		if (!message) return
		const t = setTimeout(onHide, duration)
		return () => clearTimeout(t)
		// `onHide` is a fresh closure every render on an unmemoized context, so
		// keying the timer on it would restart the window on every render.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [message, duration])

	if (!message) return null

	return (
		<View pointerEvents="none" style={styles.wrap}>
			<Animated.View
				entering={FadeInDown.duration(160)}
				exiting={FadeOut.duration(200)}
				style={styles.toast}
			>
				<Text style={styles.text}>{message}</Text>
			</Animated.View>
		</View>
	)
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		wrap: {
			...StyleSheet.absoluteFill,
			alignItems: 'center',
			justifyContent: 'flex-end',
			paddingBottom: spacing.xl,
		},
		toast: {
			paddingVertical: spacing.sm,
			paddingHorizontal: spacing.md,
			borderRadius: radius.md,
			backgroundColor: colors.text,
		},
		text: {
			fontSize: font.sm,
			fontWeight: '600',
			color: colors.background,
		},
	})
}
