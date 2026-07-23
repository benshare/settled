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

import { Children, useEffect, useRef, useState, type ReactNode } from 'react'
import {
	StyleSheet,
	View,
	type LayoutChangeEvent,
	type StyleProp,
	type ViewStyle,
} from 'react-native'
import Animated, {
	Easing,
	runOnJS,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from 'react-native-reanimated'

const DEFAULT_DURATION = 360
// A pronounced ease-in-out cubic-bezier — slow at both ends, quick through the
// middle.
const EASING = Easing.bezier(0.83, 0, 0.17, 1)

export function SlidingArea({
	index,
	duration = DEFAULT_DURATION,
	style,
	children,
}: {
	index: number
	duration?: number
	style?: StyleProp<ViewStyle>
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

	if (panes.length === 0) return null

	return (
		<View style={[styles.container, style]} onLayout={onLayout}>
			{panes.map((pane, i) => {
				if (i === active) {
					return (
						<Animated.View
							key={i}
							style={[styles.active, incomingStyle]}
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
						key={i}
						style={[styles.parked, parkedStyle]}
						pointerEvents="none"
					>
						{pane}
					</Animated.View>
				)
			})}
		</View>
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
	parked: {
		position: 'absolute',
		top: 0,
		left: 0,
		width: '100%',
	},
	// Mounted and measured (so a pane is ready the moment it's selected) but
	// invisible until it becomes the active or outgoing pane.
	hidden: {
		opacity: 0,
	},
})
