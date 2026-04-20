import { Circle, G, Text as SvgText } from 'react-native-svg'
import type { HexNumber } from './board'
import { PIP_COUNT } from './layout'
import {
	HOT_NUMBERS,
	tokenFace,
	tokenRing,
	tokenTextCool,
	tokenTextHot,
} from './palette'

export function NumberToken({
	cx,
	cy,
	hexSize,
	number,
}: {
	cx: number
	cy: number
	hexSize: number
	number: HexNumber
}) {
	const r = hexSize * 0.42
	const hot = HOT_NUMBERS.has(number)
	const textColor = hot ? tokenTextHot : tokenTextCool
	const fontSize = r * 0.95
	const fontWeight = hot ? '800' : '700'
	const pips = PIP_COUNT[number]
	const pipRadius = r * 0.07
	const pipSpacing = pipRadius * 2.6
	const pipY = cy + r * 0.55
	const pipsStartX = cx - ((pips - 1) * pipSpacing) / 2

	return (
		<G>
			<Circle
				cx={cx}
				cy={cy}
				r={r}
				fill={tokenFace}
				stroke={tokenRing}
				strokeWidth={Math.max(1, hexSize * 0.03)}
			/>
			<SvgText
				x={cx}
				y={cy + fontSize * 0.1}
				fill={textColor}
				fontSize={fontSize}
				fontWeight={fontWeight}
				textAnchor="middle"
				alignmentBaseline="middle"
			>
				{number}
			</SvgText>
			{Array.from({ length: pips }).map((_, i) => (
				<Circle
					key={i}
					cx={pipsStartX + i * pipSpacing}
					cy={pipY}
					r={pipRadius}
					fill={textColor}
				/>
			))}
		</G>
	)
}
