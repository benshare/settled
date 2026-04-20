import { Circle, Ellipse, G, Path } from 'react-native-svg'

// 2D side-view pawn silhouette anchored at a hex center. All offsets are
// multiples of `size` (hex circumradius) so the piece scales with the board.
// Rendered inside BoardSvg above tiles/number tokens so it reads as placed
// on top of the hex.
export function RobberPiece({
	cx,
	cy,
	size,
}: {
	cx: number
	cy: number
	size: number
}) {
	const fill = '#1A1A1A'
	const stroke = '#F4EAD0'
	const sw = Math.max(1, size * 0.04)
	const s = size

	// Body silhouette: narrow at the neck, flaring out to the base skirt.
	const body = [
		`M ${-0.08 * s},${-0.08 * s}`,
		`C ${-0.1 * s},${0.08 * s} ${-0.22 * s},${0.18 * s} ${-0.22 * s},${0.3 * s}`,
		`L ${0.22 * s},${0.3 * s}`,
		`C ${0.22 * s},${0.18 * s} ${0.1 * s},${0.08 * s} ${0.08 * s},${-0.08 * s}`,
		'Z',
	].join(' ')

	return (
		<G x={cx} y={cy}>
			{/* base plate */}
			<Ellipse
				cx={0}
				cy={0.35 * s}
				rx={0.3 * s}
				ry={0.08 * s}
				fill={fill}
				stroke={stroke}
				strokeWidth={sw}
			/>
			{/* body */}
			<Path
				d={body}
				fill={fill}
				stroke={stroke}
				strokeWidth={sw}
				strokeLinejoin="round"
			/>
			{/* collar */}
			<Ellipse
				cx={0}
				cy={-0.09 * s}
				rx={0.11 * s}
				ry={0.03 * s}
				fill={fill}
				stroke={stroke}
				strokeWidth={sw}
			/>
			{/* head */}
			<Circle
				cx={0}
				cy={-0.24 * s}
				r={0.13 * s}
				fill={fill}
				stroke={stroke}
				strokeWidth={sw}
			/>
		</G>
	)
}
