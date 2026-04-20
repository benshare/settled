import { Polygon } from 'react-native-svg'
import { pieceStroke, playerColors } from './palette'
import type { VertexBuilding } from './board'

export function VertexPiece({
	cx,
	cy,
	size,
	building,
	player,
}: {
	cx: number
	cy: number
	size: number
	building: VertexBuilding
	player: number
}) {
	const color = playerColors[player] ?? playerColors[0]
	const stroke = Math.max(1, size * 0.04)
	if (building === 'settlement') {
		return (
			<Settlement
				cx={cx}
				cy={cy}
				size={size}
				color={color}
				stroke={stroke}
			/>
		)
	}
	return <City cx={cx} cy={cy} size={size} color={color} stroke={stroke} />
}

function Settlement({
	cx,
	cy,
	size,
	color,
	stroke,
}: {
	cx: number
	cy: number
	size: number
	color: string
	stroke: number
}) {
	const h = size * 0.42
	const w = size * 0.36
	const roof = h * 0.4
	const top = cy - h / 2
	const bot = cy + h / 2
	const eave = top + roof
	const points = [
		[cx, top],
		[cx + w / 2, eave],
		[cx + w / 2, bot],
		[cx - w / 2, bot],
		[cx - w / 2, eave],
	]
	return (
		<Polygon
			points={points.map((p) => p.join(',')).join(' ')}
			fill={color}
			stroke={pieceStroke}
			strokeWidth={stroke}
			strokeLinejoin="round"
		/>
	)
}

function City({
	cx,
	cy,
	size,
	color,
	stroke,
}: {
	cx: number
	cy: number
	size: number
	color: string
	stroke: number
}) {
	const H = size * 0.5
	const W = size * 0.62
	const roof = H * 0.4
	const top = cy - H / 2
	const bot = cy + H / 2
	const eave = top + roof
	// Silhouette: peaked left half + flat-topped right half.
	const points = [
		[cx - W / 4, top],
		[cx, eave],
		[cx + W / 2, eave],
		[cx + W / 2, bot],
		[cx - W / 2, bot],
		[cx - W / 2, eave],
	]
	return (
		<Polygon
			points={points.map((p) => p.join(',')).join(' ')}
			fill={color}
			stroke={pieceStroke}
			strokeWidth={stroke}
			strokeLinejoin="round"
		/>
	)
}
