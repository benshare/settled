import { G, Polygon } from 'react-native-svg'
import type { HexLayout } from './layout'
import { hexCorners } from './layout'
import { NumberToken } from './NumberToken'
import { hexStroke, hexStrokeWidth, resourceColor } from './palette'
import type { HexData } from './types'

export function HexTile({
	layout,
	size,
	data,
}: {
	layout: HexLayout
	size: number
	data: HexData | undefined
}) {
	const { cx, cy } = layout
	const corners = hexCorners(cx, cy, size)
	const points = corners.map(([x, y]) => `${x},${y}`).join(' ')
	const fill = data?.resource
		? resourceColor[data.resource]
		: resourceColor.desert

	return (
		<G>
			<Polygon
				points={points}
				fill={fill}
				stroke={hexStroke}
				strokeWidth={hexStrokeWidth}
			/>
			{data && data.resource !== null && (
				<NumberToken
					cx={cx}
					cy={cy}
					hexSize={size}
					number={data.number}
				/>
			)}
		</G>
	)
}
