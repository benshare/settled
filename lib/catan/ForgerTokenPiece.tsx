import { Circle, G, Text as SvgText } from 'react-native-svg'
import { tokenRing } from './palette'

// Medallion marking the hex where a forger's token currently sits. Filled in
// the owning player's colour with a cream ring (matching the number-token
// aesthetic) and a bold "F" glyph so it's unambiguous. Rendered in the upper
// part of the hex so it stays clear of the centred number token and robber
// pawn — the token and robber often share a hex right after a 7.
export function ForgerTokenPiece({
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
	const s = size
	const r = 0.2 * s
	const dy = -0.48 * s
	const sw = Math.max(1, s * 0.03)
	const fontSize = r * 1.05

	return (
		<G x={cx} y={cy + dy}>
			<Circle r={r} fill={color} stroke={tokenRing} strokeWidth={sw} />
			<SvgText
				x={0}
				y={fontSize * 0.1}
				fill={tokenRing}
				fontSize={fontSize}
				fontWeight="800"
				textAnchor="middle"
				alignmentBaseline="middle"
			>
				F
			</SvgText>
		</G>
	)
}
