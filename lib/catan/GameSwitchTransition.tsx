// The horizontal slide that plays when the header's tab strip switches games,
// so the motion matches the direction the tapped tab sits in — tapping a tab to
// the right brings the new game in from the right.
//
// The slide is split from what it slides: `GameSwitchProvider` owns one pair of
// shared values, and every `GameSlide` in the tree reads them, so the game
// screen's three movable zones (the strip/bars under the header, the board and
// its floating buttons, the bottom bars) travel in lockstep while the frames
// they sit in — the header, the board's water background, the bottom bar's
// background — hold still. Translating the whole screen instead, as this used
// to, drags those backgrounds off with the content and the page reads as
// scrolling sideways.
//
// Only the incoming game animates. Switching reuses the same route, so there is
// no second copy of the body to slide out: `GameProvider` swaps its state under
// one mounted tree, and any outgoing copy we kept would immediately re-render as
// the *new* game. The slide-in doubles as cover for the beat where the new
// game's `game_states` row is still loading.

import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useRef,
	type ReactNode,
} from 'react'
import {
	useWindowDimensions,
	type StyleProp,
	type ViewStyle,
} from 'react-native'
import Animated, {
	Easing,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
	type SharedValue,
} from 'react-native-reanimated'
import { useSwitchableGames } from './switchableGames'

const DURATION = 260

type Slide = {
	translateX: SharedValue<number>
	opacity: SharedValue<number>
}

const SlideContext = createContext<Slide | null>(null)

export function GameSwitchProvider({
	gameId,
	children,
}: {
	gameId: string
	children: ReactNode
}) {
	const games = useSwitchableGames()
	const { width } = useWindowDimensions()
	const translateX = useSharedValue(0)
	const opacity = useSharedValue(1)
	// Last game we rendered plus its tab index — the index is what gives the
	// slide its direction, so it's captured before the switch, not after.
	const prev = useRef<{ id: string; idx: number } | null>(null)

	useEffect(() => {
		const idx = games.findIndex((g) => g.id === gameId)
		const last = prev.current
		// Same game, list churned underneath us (realtime): keep the index
		// fresh but don't animate.
		if (last?.id === gameId) {
			if (idx >= 0) prev.current = { id: gameId, idx }
			return
		}
		prev.current = { id: gameId, idx }
		// A direction only exists between two known tabs. First landing, or a
		// game with no tab at all (opened from History), just appears.
		if (!last || last.idx < 0 || idx < 0) return

		translateX.value = (idx > last.idx ? 1 : -1) * width
		opacity.value = 0
		translateX.value = withTiming(0, {
			duration: DURATION,
			easing: Easing.out(Easing.cubic),
		})
		opacity.value = withTiming(1, { duration: DURATION })
	}, [gameId, games, width, translateX, opacity])

	const value = useMemo(
		() => ({ translateX, opacity }),
		[translateX, opacity]
	)

	return (
		<SlideContext.Provider value={value}>{children}</SlideContext.Provider>
	)
}

// One movable zone. Each zone spans the full screen width, so the screen's own
// edges do the clipping and no ancestor needs `overflow: 'hidden'` — which
// matters, since the build bar's tooltips and badges render outside their bar.
export function GameSlide({
	style,
	layout,
	children,
}: {
	style?: StyleProp<ViewStyle>
	// Reanimated layout transition, for a zone that also resizes (the board).
	layout?: React.ComponentProps<typeof Animated.View>['layout']
	children: ReactNode
}) {
	const slide = useContext(SlideContext)
	const animated = useAnimatedStyle(() => {
		if (!slide) return {}
		return {
			transform: [{ translateX: slide.translateX.value }],
			opacity: slide.opacity.value,
		}
	})

	return (
		<Animated.View style={[style, animated]} layout={layout}>
			{children}
		</Animated.View>
	)
}
