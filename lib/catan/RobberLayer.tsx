import { Fragment } from 'react'
import { Circle, G } from 'react-native-svg'
import { boardFor, type Hex, type Vertex } from './board'
import type { HexLayout } from './layout'
import { seatColor, tokenFace, tokenRing } from './palette'
import { PulsingDot } from './PulsingDot'
import { stealCandidates, validRobberHexes } from './robber'
import type { GameState } from './types'
import { producersAt, vertexStateOf } from './types'
import { sharedCornerXs } from './VertexPiece'

// Overlay rendered inside BoardSvg's transformed group. Active during the
// robber chain (move_robber → steal). Renders nothing when it isn't the
// viewer's turn. A `draftHex` (a move_robber hex with 2+ victims, not yet
// sent) shows that hex's victims alongside the other hex targets, so the
// player picks the victim before anything goes up — or re-picks the hex.
export function RobberLayer({
	state,
	meIdx,
	layoutS,
	hexLayouts,
	vertexPositions,
	draftHex,
	onMoveRobber,
	onSteal,
}: {
	state: GameState
	meIdx: number
	layoutS: number
	hexLayouts: HexLayout[]
	vertexPositions: Record<Vertex, { x: number; y: number }>
	draftHex?: Hex | null
	onMoveRobber: (hex: Hex) => void
	onSteal: (victim: number) => void
}) {
	const phase = state.phase
	if (phase.kind === 'move_robber') {
		const valids = new Set<Hex>(validRobberHexes(state))
		if (draftHex) valids.delete(draftHex)
		const color = seatColor(state, meIdx)
		// The desert has no NumberToken, so a pulse rendered there would read
		// as a solid blob rather than a halo-around-an-anchor like every other
		// valid hex. Render a blank token-shaped backdrop first so the pulse
		// lands on the same cream disc the other hexes provide for free.
		const tokenR = layoutS * 0.42
		const tokenSw = Math.max(1, layoutS * 0.03)
		return (
			<G>
				{hexLayouts
					.filter((h) => valids.has(h.id))
					.map((h) => {
						const isDesert = state.hexes[h.id]?.resource == null
						return (
							<Fragment key={h.id}>
								{isDesert && (
									<Circle
										cx={h.cx}
										cy={h.cy}
										r={tokenR}
										fill={tokenFace}
										stroke={tokenRing}
										strokeWidth={tokenSw}
									/>
								)}
								<PulsingDot
									cx={h.cx}
									cy={h.cy}
									r={layoutS * 0.34}
									color={color}
								/>
								<Circle
									cx={h.cx}
									cy={h.cy}
									r={layoutS * 0.55}
									fill="#000"
									fillOpacity={0.001}
									onPress={() => onMoveRobber(h.id)}
								/>
							</Fragment>
						)
					})}
				{draftHex && (
					<StealTargets
						state={state}
						meIdx={meIdx}
						hex={draftHex}
						candidates={stealCandidates(state, draftHex, meIdx)}
						layoutS={layoutS}
						vertexPositions={vertexPositions}
						onSteal={onSteal}
					/>
				)}
			</G>
		)
	}

	if (phase.kind === 'steal') {
		return (
			<StealTargets
				state={state}
				meIdx={meIdx}
				hex={phase.hex}
				candidates={phase.candidates}
				layoutS={layoutS}
				vertexPositions={vertexPositions}
				onSteal={onSteal}
			/>
		)
	}

	return null
}

// A pulse on every candidate's piece touching `hex`.
function StealTargets({
	state,
	meIdx,
	hex,
	candidates,
	layoutS,
	vertexPositions,
	onSteal,
}: {
	state: GameState
	meIdx: number
	hex: Hex
	candidates: number[]
	layoutS: number
	vertexPositions: Record<Vertex, { x: number; y: number }>
	onSteal: (victim: number) => void
}) {
	const color = seatColor(state, meIdx)
	const candidateSet = new Set(candidates)
	const adjacentVertices = boardFor(state.variant).adjacentVertices
	return (
		<G>
			{adjacentVertices[hex].flatMap((v) => {
				const vs = vertexStateOf(state, v)
				const pos = vertexPositions[v]
				const producers = producersAt(state, v)
				// A ghost sharing a corner with a building sits beside it,
				// so each piece gets its own, smaller target.
				const shared = vs.occupied && producers.length > 1
				const xs = shared
					? sharedCornerXs(pos.x, layoutS, vs.building)
					: null
				return producers.map((pr, i) => {
					if (!candidateSet.has(pr.player)) return null
					const x = !xs ? pos.x : i === 0 ? xs.buildingX : xs.ghostX
					return (
						<Fragment key={`${v}-${i}`}>
							<PulsingDot
								cx={x}
								cy={pos.y}
								r={layoutS * 0.24}
								color={color}
							/>
							<Circle
								cx={x}
								cy={pos.y}
								r={layoutS * (shared ? 0.3 : 0.45)}
								fill="transparent"
								onPress={() => onSteal(pr.player)}
							/>
						</Fragment>
					)
				})
			})}
		</G>
	)
}
