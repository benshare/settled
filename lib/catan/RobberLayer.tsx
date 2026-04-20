import { Fragment } from 'react'
import { Circle, G } from 'react-native-svg'
import { adjacentVertices, type Hex, type Vertex } from './board'
import type { HexLayout } from './layout'
import { playerColors } from './palette'
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
		return (
			<G>
				{hexLayouts
					.filter((h) => valids.has(h.id))
					.map((h) => (
						<Fragment key={h.id}>
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
					))}
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
