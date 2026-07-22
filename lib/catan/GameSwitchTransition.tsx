// Slides the game body horizontally when the header's tab strip switches
// games, so the motion matches the direction the tapped tab sits in — tapping
// a tab to the right brings the new game in from the right.
//
// Only the incoming game animates. Switching reuses the same route, so there
// is no second copy of the body to slide out: `GameProvider` swaps its state
// under one mounted tree, and any outgoing copy we kept would immediately
// re-render as the *new* game. The slide-in doubles as cover for the beat
// where the new game's `game_states` row is still loading.

import { useEffect, useRef, type ReactNode } from 'react'
import { StyleSheet, useWindowDimensions } from 'react-native'
import Animated, {
	Easing,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from 'react-native-reanimated'
import { useSwitchableGames } from './switchableGames'

const DURATION = 260

export function GameSwitchTransition({
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

	const style = useAnimatedStyle(() => ({
		transform: [{ translateX: translateX.value }],
		opacity: opacity.value,
	}))

	return (
		<Animated.View style={[styles.root, style]}>{children}</Animated.View>
	)
}

const styles = StyleSheet.create({
	root: {
		flex: 1,
	},
})
