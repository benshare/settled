// A title bar with a body that collapses into it. The bar holds its position
// and the body shrinks upward — so collapsing reveals whatever the sheet covers
// (the game board) while the prompt itself stays put and reachable. Use it for
// any overlay whose answer depends on what's behind it.
//
// Two callers, two sizing modes: `MinimizableModal` puts this inside a `Modal`
// as a content-sized sheet; `BonusSelection` renders it in-tree over the board
// as a `fill` pane. The collapse mechanism differs between them because they
// have different heights to animate toward — a content-sized sheet has none
// until its body lays out, so the body unmounts and the parent's layout
// transition carries the height; a `fill` sheet is sized by its container, so
// it animates the body between zero and the room left over once the bar has
// taken its share.
//
// In `fill` mode the animated element is the body, never the sheet: sizing the
// sheet instead makes the bar the thing being squeezed (`height` is border-box,
// so a sheet exactly as tall as its bar has no room for it) and feeds the bar's
// own `onLayout` back into the value that sizes it.

import { Ionicons } from '@expo/vector-icons'
import { ReactNode, useEffect, useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, {
	FadeIn,
	FadeOut,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from 'react-native-reanimated'
import { ColorScheme, font, radius, shadow, spacing } from '../theme'
import { useTheme } from '../ThemeContext'

export const COLLAPSE_DURATION = 220

// `fillSheet`'s border, which eats into the height available to its children.
const FILL_BORDER = 1

export function CollapsibleSheet({
	title,
	collapsed,
	onToggleCollapsed,
	fill = false,
	children,
}: {
	title: string
	collapsed: boolean
	onToggleCollapsed: () => void
	// Fill the parent's height (which must be bounded) and own the card
	// surface, rather than sizing to the content inside a caller's own sheet.
	fill?: boolean
	children: ReactNode
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])

	const progress = useSharedValue(collapsed ? 0 : 1)
	const headerHeight = useSharedValue(0)
	const availableHeight = useSharedValue(0)

	useEffect(() => {
		progress.value = withTiming(collapsed ? 0 : 1, {
			duration: COLLAPSE_DURATION,
		})
	}, [collapsed, progress])

	// Single chevron that flips by mirroring on the Y axis (scaleY 1 → -1);
	// animating through 0 reads as a vertical flip rather than a swap.
	const chevronStyle = useAnimatedStyle(() => ({
		transform: [{ scaleY: progress.value * 2 - 1 }],
	}))

	const fillBodyStyle = useAnimatedStyle(() => {
		if (headerHeight.value === 0 || availableHeight.value === 0) return {}
		const max = Math.max(
			availableHeight.value - headerHeight.value - FILL_BORDER * 2,
			0
		)
		return { height: max * progress.value, opacity: progress.value }
	})

	const header = (
		<Pressable
			onPress={onToggleCollapsed}
			onLayout={(e) => {
				headerHeight.value = e.nativeEvent.layout.height
			}}
			style={({ pressed }) => [
				styles.header,
				fill && styles.fillHeader,
				pressed && styles.pressed,
			]}
		>
			<Text style={styles.title}>{title}</Text>
			<Animated.View style={chevronStyle}>
				<Ionicons
					name="chevron-down"
					size={22}
					color={colors.textSecondary}
				/>
			</Animated.View>
		</Pressable>
	)

	if (!fill)
		return (
			<>
				{header}
				{!collapsed && (
					<Animated.View
						entering={FadeIn.duration(180)}
						exiting={FadeOut.duration(160)}
						style={styles.body}
					>
						{children}
					</Animated.View>
				)}
			</>
		)

	return (
		<View
			style={styles.fillRoot}
			onLayout={(e) => {
				availableHeight.value = e.nativeEvent.layout.height
			}}
		>
			<View style={styles.fillSheet}>
				{header}
				<Animated.View
					style={[styles.fillBody, fillBodyStyle]}
					pointerEvents={collapsed ? 'none' : 'auto'}
				>
					{children}
				</Animated.View>
			</View>
		</View>
	)
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		header: {
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'space-between',
			gap: spacing.sm,
		},
		// A full-height pane has no sheet padding of its own to sit in, and is
		// wide enough that the bar reads better as a distinct band.
		fillHeader: {
			flexShrink: 0,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.sm,
			backgroundColor: colors.cardAlt,
			borderBottomWidth: 1,
			borderBottomColor: colors.border,
		},
		title: {
			flex: 1,
			fontSize: font.lg,
			fontWeight: '700',
			color: colors.text,
		},
		body: {
			gap: spacing.md,
		},
		// Anchors the sheet to the top of the space it's given, which is what
		// keeps the bar in place as the body collapses into it.
		fillRoot: {
			flex: 1,
			justifyContent: 'flex-start',
		},
		fillSheet: {
			// Height comes from the bar plus whatever the body is animated to,
			// so the bar always gets the room it asked for.
			backgroundColor: colors.card,
			borderWidth: FILL_BORDER,
			borderColor: colors.border,
			borderRadius: radius.md,
			overflow: 'hidden',
			boxShadow: shadow.overlay,
		},
		fillBody: {
			overflow: 'hidden',
		},
		pressed: {
			opacity: 0.8,
		},
	})
}
