import { Fragment } from 'react'
import { Circle, G } from 'react-native-svg'
import { adjacentVertices, type Hex, type Vertex } from './board'
import type { HexLayout } from './layout'
import { playerColors, tokenFace, tokenRing } from './palette'
import { PulsingDot } from './PulsingDot'
import { validRobberHexes } from './robber'
import type { GameState } from './types'
import { vertexStateOf } from './types'

// Overlay rendered inside BoardSvg's transformed group. Active during the
// robber chain (move_robber → steal). Renders nothing when it isn't the
// viewer's turn.
export function RobberLayer({
	state,
	meIdx,
	layoutS,
	hexLayouts,
	vertexPositions,
	onMoveRobber,
	onSteal,
}: {
	state: GameState
	meIdx: number
	layoutS: number
	hexLayouts: HexLayout[]
	vertexPositions: Record<Vertex, { x: number; y: number }>
	onMoveRobber: (hex: Hex) => void
	onSteal: (victim: number) => void
}) {
	const phase = state.phase
	if (phase.kind === 'move_robber') {
		const valids = new Set<Hex>(validRobberHexes(state))
		const color = playerColors[meIdx] ?? playerColors[0]
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
			</G>
		)
	}

	if (phase.kind === 'steal') {
		const color = playerColors[meIdx] ?? playerColors[0]
		const candidateSet = new Set(phase.candidates)
		return (
			<G>
				{adjacentVertices[phase.hex].map((v) => {
					const vs = vertexStateOf(state, v)
					if (!vs.occupied) return null
					if (!candidateSet.has(vs.player)) return null
					const p = vertexPositions[v]
					return (
						<Fragment key={v}>
							<PulsingDot
								cx={p.x}
								cy={p.y}
								r={layoutS * 0.24}
								color={color}
							/>
							<Circle
								cx={p.x}
								cy={p.y}
								r={layoutS * 0.45}
								fill="transparent"
								onPress={() => onSteal(vs.player)}
							/>
						</Fragment>
					)
				})}
			</G>
		)
	}

	return null
}
