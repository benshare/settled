import { Rect } from 'react-native-svg'
import { pieceStroke, playerColors } from './palette'

export function EdgePiece({
	x1,
	y1,
	x2,
	y2,
	size,
	player,
}: {
	x1: number
	y1: number
	x2: number
	y2: number
	size: number
	player: number
}) {
	const color = playerColors[player] ?? playerColors[0]
	const mx = (x1 + x2) / 2
	const my = (y1 + y2) / 2
	const angleDeg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI
	const length = size * 0.95
	const thickness = size * 0.18
	const stroke = Math.max(1, size * 0.04)
	return (
		<Rect
			x={mx - length / 2}
			y={my - thickness / 2}
			width={length}
			height={thickness}
			fill={color}
			stroke={pieceStroke}
			strokeWidth={stroke}
			strokeLinejoin="round"
			rx={thickness * 0.15}
			transform={`rotate(${angleDeg}, ${mx}, ${my})`}
		/>
	)
}
