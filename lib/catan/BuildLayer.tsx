import { Fragment } from 'react'
import { Circle, G } from 'react-native-svg'
import { edgeEndpoints, type Edge, type Vertex } from './board'
import {
	validBuildCityVertices,
	validBuildRoadEdges,
	validBuildSettlementVertices,
	type BuildKind,
} from './build'
import { playerColors } from './palette'
import { PulsingDot } from './PulsingDot'
import type { GameState } from './types'

export type BuildSelection =
	| { kind: 'road'; edge: Edge }
	| { kind: 'settlement'; vertex: Vertex }
	| { kind: 'city'; vertex: Vertex }

// Overlay inside BoardSvg's transformed group. When a build tool is active,
// pulses all valid spots for the current player and surfaces invisible hit
// targets that bubble up a BuildSelection. Renders nothing when tool is null
// or when the game isn't in main phase.
export function BuildLayer({
	state,
	meIdx,
	tool,
	layoutS,
	vertexPositions,
	onSelect,
}: {
	state: GameState
	meIdx: number
	tool: BuildKind | null
	layoutS: number
	vertexPositions: Record<Vertex, { x: number; y: number }>
	onSelect: (selection: BuildSelection) => void
}) {
	if (!tool) return null
	if (state.phase.kind !== 'main') return null
	const color = playerColors[meIdx] ?? playerColors[0]

	if (tool === 'road') {
		const valids = validBuildRoadEdges(state, meIdx)
		return (
			<G>
				{valids.map((e) => {
					const [va, vb] = edgeEndpoints(e)
					const pa = vertexPositions[va]
					const pb = vertexPositions[vb]
					const mx = (pa.x + pb.x) / 2
					const my = (pa.y + pb.y) / 2
					return (
						<Fragment key={e}>
							<PulsingDot
								cx={mx}
								cy={my}
								r={layoutS * 0.2}
								color={color}
							/>
							<Circle
								cx={mx}
								cy={my}
								r={layoutS * 0.42}
								fill="transparent"
								onPress={() =>
									onSelect({ kind: 'road', edge: e })
								}
							/>
						</Fragment>
					)
				})}
			</G>
		)
	}

	const valids =
		tool === 'settlement'
			? validBuildSettlementVertices(state, meIdx)
			: validBuildCityVertices(state, meIdx)

	return (
		<G>
			{valids.map((v) => {
				const p = vertexPositions[v]
				return (
					<Fragment key={v}>
						<PulsingDot
							cx={p.x}
							cy={p.y}
							r={layoutS * 0.22}
							color={color}
						/>
						<Circle
							cx={p.x}
							cy={p.y}
							r={layoutS * 0.45}
							fill="transparent"
							onPress={() => onSelect({ kind: tool, vertex: v })}
						/>
					</Fragment>
				)
			})}
		</G>
	)
}
