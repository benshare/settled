import { useEffect } from 'react'
import Animated, {
	makeMutable,
	useAnimatedProps,
	withRepeat,
	withTiming,
} from 'react-native-reanimated'
import { Circle } from 'react-native-svg'

const AnimatedCircle = Animated.createAnimatedComponent(Circle)

// Single shared clock drives every PulsingDot so they breathe in sync.
// Kicked off lazily on the first dot to mount (module-load initialization
// would fire before React Native's RAF polyfill is installed).
const PULSE_T = makeMutable(0)
let pulseStarted = false

function ensurePulseStarted() {
	if (pulseStarted) return
	pulseStarted = true
	PULSE_T.value = withRepeat(withTiming(1, { duration: 900 }), -1, true)
}

// Circle whose radius and opacity oscillate to draw attention. Used as the
// valid-placement affordance on the board.
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
	useEffect(() => {
		ensurePulseStarted()
	}, [])

	const animatedProps = useAnimatedProps(() => ({
		r: r * (1 + 0.3 * PULSE_T.value),
		opacity: 0.75 - 0.45 * PULSE_T.value,
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
