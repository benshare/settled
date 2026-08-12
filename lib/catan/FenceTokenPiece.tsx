// A fence (fencer bonus): a dashed segment in the owner's colour with a small
// centre node. Deliberately unlike a solid road (EdgePiece) — a fence claims
// the edge against everyone else but is not a road, so it must not read as one.

import { Circle, Line } from 'react-native-svg'

export function FenceTokenPiece({
	x1,
	y1,
	x2,
	y2,
	size,
	color,
}: {
	x1: number
	y1: number
	x2: number
	y2: number
	size: number
	color: string
}) {
	const mx = (x1 + x2) / 2
	const my = (y1 + y2) / 2
	return (
		<>
			<Line
				x1={x1}
				y1={y1}
				x2={x2}
				y2={y2}
				stroke={color}
				strokeOpacity={0.7}
				strokeWidth={size * 0.12}
				strokeLinecap="round"
				strokeDasharray={`${size * 0.14},${size * 0.12}`}
			/>
			<Circle
				cx={mx}
				cy={my}
				r={size * 0.12}
				fill={color}
				stroke="#1A1A1A"
				strokeWidth={size * 0.03}
			/>
		</>
	)
}
