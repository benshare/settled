import { Circle, G } from 'react-native-svg'

// Dark filled disc anchored at a hex center. Sits above the number token
// (the BoardSvg renders hexes first, then this). Visual only — interaction
// lives in RobberLayer.
export function RobberPiece({
	cx,
	cy,
	size,
}: {
	cx: number
	cy: number
	size: number
}) {
	const r = size * 0.34
	return (
		<G>
			<Circle
				cx={cx}
				cy={cy}
				r={r}
				fill="#1A1A1A"
				stroke="#F4EAD0"
				strokeWidth={size * 0.06}
				opacity={0.9}
			/>
			<Circle
				cx={cx}
				cy={cy - r * 0.25}
				r={r * 0.38}
				fill="#1A1A1A"
				stroke="#F4EAD0"
				strokeWidth={size * 0.04}
			/>
		</G>
	)
}
