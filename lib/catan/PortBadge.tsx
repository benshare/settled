import { Circle, G, Line, Rect, Text as SvgText } from 'react-native-svg'
import type { PortVisual } from './layout'
import { hexStroke, resourceColor } from './palette'

export function PortBadge({
	visual,
	size,
}: {
	visual: PortVisual
	size: number
}) {
	const { port, badge, docks } = visual
	const w = size * 0.9
	const h = size * 0.42
	const rx = h * 0.35
	const isGeneric = port.kind === '3:1'
	const accent = isGeneric
		? '#FFFFFF'
		: resourceColor[port.kind as Exclude<typeof port.kind, '3:1'>]

	return (
		<G>
			<Line
				x1={docks[0].x}
				y1={docks[0].y}
				x2={badge.x}
				y2={badge.y}
				stroke="#FFFFFF"
				strokeWidth={1}
				strokeOpacity={0.8}
				strokeDasharray="2 3"
			/>
			<Line
				x1={docks[1].x}
				y1={docks[1].y}
				x2={badge.x}
				y2={badge.y}
				stroke="#FFFFFF"
				strokeWidth={1}
				strokeOpacity={0.8}
				strokeDasharray="2 3"
			/>
			<Rect
				x={badge.x - w / 2}
				y={badge.y - h / 2}
				width={w}
				height={h}
				rx={rx}
				ry={rx}
				fill="#F4EAD0"
				stroke={hexStroke}
				strokeWidth={1.25}
			/>
			{!isGeneric && (
				<Circle
					cx={badge.x - w / 2 + h * 0.5}
					cy={badge.y}
					r={h * 0.28}
					fill={accent}
					stroke={hexStroke}
					strokeWidth={1}
				/>
			)}
			<SvgText
				x={badge.x + (isGeneric ? 0 : h * 0.4)}
				y={badge.y}
				textAnchor="middle"
				alignmentBaseline="central"
				fontSize={h * 0.62}
				fontWeight="700"
				fill="#1A1A1A"
			>
				{isGeneric ? '3:1' : '2:1'}
			</SvgText>
		</G>
	)
}
