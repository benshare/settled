import { Polygon } from 'react-native-svg'
import { pieceStroke } from './palette'
import type { VertexBuilding } from './board'

export function VertexPiece({
	cx,
	cy,
	size,
	building,
	color,
}: {
	cx: number
	cy: number
	size: number
	building: VertexBuilding
	color: string
}) {
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
	if (building === 'super_city') {
		return (
			<SuperCity
				cx={cx}
				cy={cy}
				size={size}
				color={color}
				stroke={stroke}
			/>
		)
	}
	if (building === 'ghost') {
		return (
			<Ghost cx={cx} cy={cy} size={size} color={color} stroke={stroke} />
		)
	}
	return <City cx={cx} cy={cy} size={size} color={color} stroke={stroke} />
}

// A haunt player's own secret spot, before anything has spawned there. Only
// ever rendered for the player who picked it (see `BoardView`'s `viewerIdx`).
// Deliberately fainter than the ghost it may become: an empty player-coloured
// outline rather than a filled, dark-outlined piece, so a reserved spot never
// reads as something already on the board.
export function HauntSpotMarker({
	cx,
	cy,
	size,
	color,
}: {
	cx: number
	cy: number
	size: number
	color: string
}) {
	return (
		<Polygon
			points={settlementPoints(cx, cy, size)}
			fill={color}
			fillOpacity={0.12}
			stroke={color}
			strokeOpacity={0.75}
			strokeWidth={Math.max(1, size * 0.03)}
			strokeDasharray={`${size * 0.05},${size * 0.045}`}
			strokeLinejoin="round"
		/>
	)
}

// A ghost (haunt bonus) reads as a spectral settlement: same silhouette as a
// settlement, drawn translucent with a dashed outline so it's clearly a
// non-scoring, non-solid piece.
function Ghost({
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
	return (
		<Polygon
			points={settlementPoints(cx, cy, size)}
			fill={color}
			fillOpacity={0.35}
			stroke={pieceStroke}
			strokeWidth={stroke}
			strokeDasharray={`${size * 0.06},${size * 0.05}`}
			strokeLinejoin="round"
		/>
	)
}

// The settlement silhouette — a house — shared by the settlement, the ghost,
// and the haunt-spot marker, which differ only in how they're painted.
function settlementPoints(cx: number, cy: number, size: number): string {
	const h = size * 0.42
	const w = size * 0.36
	const roof = h * 0.4
	const top = cy - h / 2
	const bot = cy + h / 2
	const eave = top + roof
	return [
		[cx, top],
		[cx + w / 2, eave],
		[cx + w / 2, bot],
		[cx - w / 2, bot],
		[cx - w / 2, eave],
	]
		.map((p) => p.join(','))
		.join(' ')
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
	return (
		<Polygon
			points={settlementPoints(cx, cy, size)}
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

// A taller, dual-peak silhouette with a battlement-style flat roof in the
// middle so super_city reads as the next step up from city. Uses the same
// player fill so colour identity stays consistent.
function SuperCity({
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
	const H = size * 0.6
	const W = size * 0.72
	const roof = H * 0.32
	const top = cy - H / 2
	const bot = cy + H / 2
	const eave = top + roof
	// Two peaks (left + right) with a flat centre crenellation.
	const peakInset = W * 0.18
	const points = [
		[cx - W / 2 + peakInset, top],
		[cx - peakInset, eave],
		[cx - peakInset, top + roof * 0.5],
		[cx + peakInset, top + roof * 0.5],
		[cx + peakInset, eave],
		[cx + W / 2 - peakInset, top],
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
