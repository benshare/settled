import { useEffect } from 'react'
import Animated, {
	useAnimatedProps,
	useSharedValue,
	withRepeat,
	withTiming,
} from 'react-native-reanimated'
import { Circle } from 'react-native-svg'

const AnimatedCircle = Animated.createAnimatedComponent(Circle)

// Circle whose radius and opacity oscillate to draw attention. Used as the
// valid-placement affordance on the board. Independent shared value per dot
// so unmounting individual dots doesn't leak timers.
export function PulsingDot({
	cx,
	cy,
	r,
	color,
}: {
	cx: number
	cy: number
	r: number
	color: string
}) {
	const t = useSharedValue(0)
	useEffect(() => {
		t.value = withRepeat(withTiming(1, { duration: 900 }), -1, true)
	}, [t])

	const animatedProps = useAnimatedProps(() => ({
		r: r * (1 + 0.3 * t.value),
		opacity: 0.75 - 0.45 * t.value,
	}))

	return (
		<AnimatedCircle
			cx={cx}
			cy={cy}
			fill={color}
			animatedProps={animatedProps}
		/>
	)
}
