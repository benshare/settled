// A sheet that minimizes into a small + bubble. The − toggle in its top-right
// corner glides into the bubble's center and spins into a + while the surface
// shrinks around it, so what the sheet covers (the game board) comes back into
// view with the prompt still one tap away.
//
// Two callers, two sizing modes: `MinimizableModal` puts this inside a `Modal`
// as a content-sized sheet; `BonusSelection` renders it in-tree over the board
// as a `fill` pane. Either way the surface is absolutely positioned and its
// rect interpolates between the rest frame and the bubble on one `progress`
// value, while the content stays laid out at the rest size — anchored to the
// surface's top-right corner and clipped by it — so the morph never reflows it.

import { Ionicons } from '@expo/vector-icons'
import {
	ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, {
	Extrapolation,
	interpolate,
	runOnJS,
	SharedValue,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from 'react-native-reanimated'
import { ColorScheme, font, radius, shadow, spacing } from '../theme'
import { useTheme } from '../ThemeContext'

export const BUBBLE_SIZE = 32
export const MORPH_DURATION = 280

// The surface's border, which eats into the room its content gets.
const BORDER = 1
const TOGGLE_SIZE = BUBBLE_SIZE - BORDER * 2

export type BubblePoint = { x: number; y: number }

export function MinimizableSheet({
	title,
	minimized,
	onToggleMinimized,
	fill = false,
	top = 0,
	maxWidth,
	bubble,
	progress: externalProgress,
	onMorphEnd,
	children,
}: {
	title: string
	minimized: boolean
	onToggleMinimized: () => void
	// Fill the whole parent (which must be bounded) rather than sizing to the
	// content, centered under `top`.
	fill?: boolean
	top?: number
	maxWidth?: number
	// The bubble's top-left in this sheet's parent coordinates. Defaults to
	// the parent's top-right corner.
	bubble?: BubblePoint
	// Drive from a caller-owned value (1 = expanded) when the caller animates
	// something else in step, like a backdrop.
	progress?: SharedValue<number>
	onMorphEnd?: (minimized: boolean) => void
	children: ReactNode
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])

	const ownProgress = useSharedValue(minimized ? 0 : 1)
	const progress = externalProgress ?? ownProgress

	const [root, setRoot] = useState<{ width: number; height: number }>()
	const restH = useSharedValue(0)

	const onMorphEndRef = useRef(onMorphEnd)
	useEffect(() => {
		onMorphEndRef.current = onMorphEnd
	})
	const morphEnded = useCallback(
		(m: boolean) => onMorphEndRef.current?.(m),
		[]
	)

	useEffect(() => {
		progress.value = withTiming(
			minimized ? 0 : 1,
			{ duration: MORPH_DURATION },
			(finished) => {
				if (finished) runOnJS(morphEnded)(minimized)
			}
		)
	}, [minimized, progress, morphEnded])

	const width = root
		? fill
			? root.width
			: Math.min(root.width - spacing.lg * 2, maxWidth ?? Infinity)
		: 0
	const frameX = root && !fill ? (root.width - width) / 2 : 0
	const frameY = fill ? 0 : top
	const bubbleX = bubble?.x ?? (root ? root.width - BUBBLE_SIZE : 0)
	const bubbleY = bubble?.y ?? 0

	useEffect(() => {
		if (fill && root) restH.value = root.height
	}, [fill, root, restH])

	// Content height changes ease rather than jump; the first one lands
	// directly, since there's nothing on screen yet to ease from.
	const onContentLayout = (h: number) => {
		const next = h + BORDER * 2
		restH.set(
			restH.get() === 0
				? next
				: withTiming(next, { duration: MORPH_DURATION })
		)
	}

	const measured = root !== undefined
	const surfaceStyle = useAnimatedStyle(() => {
		const p = progress.value
		return {
			opacity: measured && restH.value > 0 ? 1 : 0,
			left: interpolate(p, [0, 1], [bubbleX, frameX]),
			top: interpolate(p, [0, 1], [bubbleY, frameY]),
			width: interpolate(p, [0, 1], [BUBBLE_SIZE, width]),
			height: interpolate(p, [0, 1], [BUBBLE_SIZE, restH.value]),
			borderRadius: interpolate(p, [0, 1], [BUBBLE_SIZE / 2, radius.md]),
		}
	})

	// Gone well before the surface is small enough to crush it.
	const contentStyle = useAnimatedStyle(() => ({
		opacity: interpolate(
			progress.value,
			[0.45, 1],
			[0, 1],
			Extrapolation.CLAMP
		),
	}))

	const togglePad = fill ? TOGGLE_FILL_PAD : TOGGLE_SHEET_PAD
	const toggleStyle = useAnimatedStyle(() => ({
		top: interpolate(progress.value, [0, 1], [0, togglePad.top]),
		right: interpolate(progress.value, [0, 1], [0, togglePad.right]),
	}))

	const innerW = width - BORDER * 2

	return (
		<View
			style={StyleSheet.absoluteFill}
			pointerEvents="box-none"
			onLayout={(e) => {
				const { width: w, height: h } = e.nativeEvent.layout
				setRoot({ width: w, height: h })
			}}
		>
			<Animated.View
				style={[
					styles.surface,
					fill ? styles.paneShadow : styles.sheetShadow,
					surfaceStyle,
				]}
			>
				<Animated.View
					style={[styles.content, contentStyle]}
					pointerEvents={minimized ? 'none' : 'auto'}
				>
					{fill ? (
						<View
							style={{
								width: innerW,
								height: root ? root.height - BORDER * 2 : 0,
							}}
						>
							<View style={styles.paneHeader}>
								<Text style={styles.title}>{title}</Text>
							</View>
							<View style={styles.paneBody}>{children}</View>
						</View>
					) : (
						<View
							style={[styles.sheet, { width: innerW }]}
							onLayout={(e) =>
								onContentLayout(e.nativeEvent.layout.height)
							}
						>
							<View style={styles.sheetHeader}>
								<Text style={styles.title}>{title}</Text>
							</View>
							{children}
						</View>
					)}
				</Animated.View>
				<Animated.View style={[styles.toggle, toggleStyle]}>
					<Pressable
						onPress={onToggleMinimized}
						style={({ pressed }) => [
							styles.toggleHit,
							pressed && styles.pressed,
						]}
						hitSlop={6}
						accessibilityLabel={
							minimized ? `Restore ${title}` : `Minimize ${title}`
						}
					>
						<ToggleGlyph progress={progress} />
					</Pressable>
				</Animated.View>
			</Animated.View>
		</View>
	)
}

// The standalone bubble, for a caller that has to hand off from the sheet to
// an in-tree copy (`MinimizableModal`, whose modal closes once minimized).
// Matches the sheet's surface at progress 0 exactly.
export function MinimizedBubble({
	onPress,
	accessibilityLabel,
}: {
	onPress: () => void
	accessibilityLabel: string
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<Pressable
			onPress={onPress}
			style={({ pressed }) => [
				styles.surface,
				styles.sheetShadow,
				styles.bubble,
				pressed && styles.pressed,
			]}
			hitSlop={6}
			accessibilityLabel={accessibilityLabel}
		>
			<Ionicons name="add" size={GLYPH_SIZE} color={colors.text} />
		</Pressable>
	)
}

// − at progress 1, + at 0. The pair turns a quarter as it crossfades, so the
// minus reads as spinning into the plus's vertical stroke.
function ToggleGlyph({ progress }: { progress: SharedValue<number> }) {
	const { colors } = useTheme()
	const spin = useAnimatedStyle(() => ({
		transform: [{ rotate: `${90 * (1 - progress.value)}deg` }],
	}))
	const minus = useAnimatedStyle(() => ({ opacity: progress.value }))
	const plus = useAnimatedStyle(() => ({ opacity: 1 - progress.value }))
	return (
		<Animated.View style={[glyphStyles.wrap, spin]}>
			<Animated.View style={[glyphStyles.layer, minus]}>
				<Ionicons
					name="remove"
					size={GLYPH_SIZE}
					color={colors.textSecondary}
				/>
			</Animated.View>
			<Animated.View style={[glyphStyles.layer, plus]}>
				<Ionicons name="add" size={GLYPH_SIZE} color={colors.text} />
			</Animated.View>
		</Animated.View>
	)
}

const GLYPH_SIZE = 22

// Where the toggle sits in the expanded sheet, inside the border. The sheet
// lines it up with the title row in its padding; the pane, with its band.
const TOGGLE_SHEET_PAD = {
	top: spacing.lg - BORDER,
	right: spacing.lg - BORDER - spacing.xs,
}
const TOGGLE_FILL_PAD = { top: spacing.xs, right: spacing.sm }

const glyphStyles = StyleSheet.create({
	wrap: {
		width: GLYPH_SIZE,
		height: GLYPH_SIZE,
	},
	layer: {
		...StyleSheet.absoluteFill,
		alignItems: 'center',
		justifyContent: 'center',
	},
})

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		surface: {
			position: 'absolute',
			backgroundColor: colors.card,
			borderWidth: BORDER,
			borderColor: colors.border,
			overflow: 'hidden',
		},
		sheetShadow: {
			boxShadow: shadow.card,
		},
		paneShadow: {
			boxShadow: shadow.overlay,
		},
		bubble: {
			position: 'relative',
			width: BUBBLE_SIZE,
			height: BUBBLE_SIZE,
			borderRadius: BUBBLE_SIZE / 2,
			alignItems: 'center',
			justifyContent: 'center',
		},
		content: {
			position: 'absolute',
			top: 0,
			right: 0,
		},
		sheet: {
			padding: spacing.lg - BORDER,
			gap: spacing.md,
		},
		sheetHeader: {
			minHeight: TOGGLE_SIZE,
			justifyContent: 'center',
			paddingRight: TOGGLE_SIZE,
		},
		// A full-height pane has no sheet padding of its own to sit in, and is
		// wide enough that the bar reads better as a distinct band.
		paneHeader: {
			minHeight: TOGGLE_SIZE + spacing.xs * 2,
			justifyContent: 'center',
			paddingLeft: spacing.md,
			paddingRight: TOGGLE_SIZE + spacing.sm * 2,
			backgroundColor: colors.cardAlt,
			borderBottomWidth: 1,
			borderBottomColor: colors.border,
		},
		paneBody: {
			flex: 1,
		},
		title: {
			fontSize: font.lg,
			fontWeight: '700',
			color: colors.text,
		},
		toggle: {
			position: 'absolute',
		},
		toggleHit: {
			width: TOGGLE_SIZE,
			height: TOGGLE_SIZE,
			alignItems: 'center',
			justifyContent: 'center',
		},
		pressed: {
			opacity: 0.8,
		},
	})
}
