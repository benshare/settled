// A horizontal slide between a fixed set of children, selected by `index`.
// Displays the child at `index`; whenever `index` changes — consecutively or
// by a jump — the previous child slides out and the new one slides in, with the
// direction taken from the sign of the delta (a higher index enters from the
// right). Non-consecutive jumps slide the two panes directly past each other
// rather than scrolling through the ones in between.
//
// Keep-alive: every pane stays mounted for the lifetime of the area, so each
// child keeps its own state across switches. The active pane is laid out in
// flow so it drives the container's height; every other pane is absolutely
// positioned and hidden (still mounted + measured, just invisible), and the one
// currently sliding out gets the outgoing transform on top of that. `overflow:
// 'hidden'` clips the travelling panes to the area's own edges.

import {
	Children,
	isValidElement,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from 'react'
import {
	StyleSheet,
	View,
	type LayoutChangeEvent,
	type StyleProp,
	type ViewStyle,
} from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
	Easing,
	runOnJS,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from 'react-native-reanimated'

// A horizontal swipe past these thresholds pages to the adjacent child (only
// when `scrollable`).
const SWIPE_DX = 50
const SWIPE_VX = 400

const DEFAULT_DURATION = 360
// A pronounced ease-in-out cubic-bezier — slow at both ends, quick through the
// middle.
const EASING = Easing.bezier(0.83, 0, 0.17, 1)

export function SlidingArea({
	index,
	duration = DEFAULT_DURATION,
	scrollable = false,
	onIndexChange,
	style,
	paneStyle,
	children,
}: {
	index: number
	duration?: number
	// When true, a one-finger horizontal swipe pages to the adjacent child by
	// calling `onIndexChange` with the neighbouring index. The area stays
	// controlled — the parent decides what to do with the request (e.g. navigate)
	// and feeds the new `index` back in.
	scrollable?: boolean
	onIndexChange?: (index: number) => void
	style?: StyleProp<ViewStyle>
	// Applied to every pane wrapper. Panes are content-height by default (the
	// active one drives the container); pass `flex: 1` for an area that instead
	// has to fill a fixed-height container.
	paneStyle?: StyleProp<ViewStyle>
	children: ReactNode
}) {
	const panes = Children.toArray(children)
	const active = Math.max(0, Math.min(index, panes.length - 1))

	// Width is measured, not derived from the window — the area may sit in a
	// padded or narrower container. Kept in both React state (to gate the first
	// animation until geometry is known) and a shared value (for the worklet).
	const [width, setWidth] = useState(0)
	const [outgoing, setOutgoing] = useState<number | null>(null)

	const progress = useSharedValue(1)
	const widthSV = useSharedValue(0)
	const dirSV = useSharedValue(0)
	const prevIndex = useRef(active)

	useEffect(() => {
		const from = prevIndex.current
		if (from === active) return
		prevIndex.current = active
		// Without a measured width there's nothing to translate against — snap
		// to the new pane rather than animate from zero.
		if (width === 0) return
		dirSV.value = active > from ? 1 : -1
		setOutgoing(from)
		progress.value = 0
		progress.value = withTiming(
			1,
			{ duration, easing: EASING },
			(finished) => {
				if (finished) runOnJS(setOutgoing)(null)
			}
		)
	}, [active, width, duration, progress, dirSV])

	const onLayout = (e: LayoutChangeEvent) => {
		const w = e.nativeEvent.layout.width
		setWidth(w)
		widthSV.value = w
	}

	// progress 0 → 1: incoming travels from `dir * width` to 0, outgoing from 0
	// to `-dir * width`, so they cross in opposite directions.
	const incomingStyle = useAnimatedStyle(() => ({
		transform: [
			{ translateX: dirSV.value * widthSV.value * (1 - progress.value) },
		],
	}))
	const outgoingStyle = useAnimatedStyle(() => ({
		transform: [
			{ translateX: -dirSV.value * widthSV.value * progress.value },
		],
	}))

	// A one-finger horizontal swipe pages to the adjacent child. `activeOffsetX`
	// keeps taps and vertical scrolls (chat / log lists) from triggering it — the
	// pan only claims the gesture once the finger has clearly moved sideways.
	const paneCount = panes.length
	const pan = useMemo(
		() =>
			Gesture.Pan()
				.enabled(scrollable && !!onIndexChange)
				.activeOffsetX([-20, 20])
				.failOffsetY([-15, 15])
				.onEnd((e) => {
					'worklet'
					if (!onIndexChange) return
					let target = active
					if (e.translationX < -SWIPE_DX || e.velocityX < -SWIPE_VX)
						target = Math.min(active + 1, paneCount - 1)
					else if (
						e.translationX > SWIPE_DX ||
						e.velocityX > SWIPE_VX
					)
						target = Math.max(active - 1, 0)
					if (target !== active) runOnJS(onIndexChange)(target)
				}),
		[scrollable, onIndexChange, active, paneCount]
	)

	if (panes.length === 0) return null

	const content = (
		<View style={[styles.container, style]} onLayout={onLayout}>
			{panes.map((pane, i) => {
				// Keyed by the child's own key where it has one, so a caller
				// whose panes move between positions (rather than staying put
				// and changing selection) keeps them mounted. Falls back to the
				// position for the ordinary fixed-tabs case.
				const key =
					isValidElement(pane) && pane.key != null ? pane.key : i
				if (i === active) {
					return (
						<Animated.View
							key={key}
							style={[styles.active, paneStyle, incomingStyle]}
						>
							{pane}
						</Animated.View>
					)
				}
				// The one pane sliding out gets the outgoing transform; all other
				// mounted-but-inactive panes are parked hidden.
				const parkedStyle =
					i === outgoing ? outgoingStyle : styles.hidden
				return (
					<Animated.View
						key={key}
						style={[styles.parked, paneStyle, parkedStyle]}
						pointerEvents="none"
					>
						{pane}
					</Animated.View>
				)
			})}
		</View>
	)

	// Only wrap in a GestureDetector when swiping is enabled — otherwise a
	// non-scrollable area (classic zones, Stats tabs) would demand a
	// GestureHandlerRootView ancestor it doesn't have.
	return scrollable && onIndexChange ? (
		<GestureDetector gesture={pan}>{content}</GestureDetector>
	) : (
		content
	)
}

const styles = StyleSheet.create({
	container: {
		overflow: 'hidden',
	},
	// The active pane is in flow (it drives the container height) and sits above
	// the parked/outgoing panes so the incoming pane wins the crossing.
	active: {
		zIndex: 1,
	},
	// `bottom: 0` as well as `top: 0` so a parked pane keeps the full height of
	// the area (matching the in-flow active pane) instead of collapsing to its
	// content — otherwise a pane's bottom-anchored UI (e.g. the HUD's utility
	// rail and dock) jumps to the top the moment it stops being active.
	parked: {
		position: 'absolute',
		top: 0,
		bottom: 0,
		left: 0,
		width: '100%',
	},
	// Mounted and measured (so a pane is ready the moment it's selected) but
	// invisible until it becomes the active or outgoing pane.
	hidden: {
		opacity: 0,
	},
})
