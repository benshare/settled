import { Fragment } from 'react'
import { Circle, G } from 'react-native-svg'
import { edgeEndpoints, type Edge, type Vertex } from './board'
import { EdgePiece } from './EdgePiece'
import { playerColors } from './palette'
import { validRoadEdges, validSettlementVertices } from './placement'
import { PulsingDot } from './PulsingDot'
import type { GameState } from './types'
import { VertexPiece } from './VertexPiece'

export type PlacementSelection =
	| { kind: 'settlement'; vertex: Vertex }
	| { kind: 'road'; edge: Edge }

// Overlay inside BoardSvg's transformed group. Shows valid-spot dots + hit
// targets during the current user's initial-placement turn, plus a ghost
// preview of the current selection. Does nothing if the game isn't in the
// initial-placement phase.
export function PlacementLayer({
	state,
	meIdx,
	layoutS,
	vertexPositions,
	selection,
	onSelect,
}: {
	state: GameState
	meIdx: number
	layoutS: number
	vertexPositions: Record<Vertex, { x: number; y: number }>
	selection: PlacementSelection | null
	onSelect: (s: PlacementSelection) => void
}) {
	if (state.phase.kind !== 'initial_placement') return null
	const step = state.phase.step
	const color = playerColors[meIdx] ?? playerColors[0]

	if (step === 'settlement') {
		const valids = validSettlementVertices(state, meIdx)
		return (
			<G>
				{valids.map((v) => {
					const p = vertexPositions[v]
					const isSelected =
						selection?.kind === 'settlement' &&
						selection.vertex === v
					return (
						<Fragment key={v}>
							{!isSelected && (
								<PulsingDot
									cx={p.x}
									cy={p.y}
									r={layoutS * 0.22}
									color={color}
								/>
							)}
							<Circle
								cx={p.x}
								cy={p.y}
								r={layoutS * 0.45}
								fill="transparent"
								onPress={() =>
									onSelect({ kind: 'settlement', vertex: v })
								}
							/>
						</Fragment>
					)
				})}
				{selection?.kind === 'settlement' && (
					<G opacity={0.5}>
						<VertexPiece
							cx={vertexPositions[selection.vertex].x}
							cy={vertexPositions[selection.vertex].y}
							size={layoutS}
							building="settlement"
							player={meIdx}
						/>
					</G>
				)}
			</G>
		)
	}

	// step === 'road'
	const valids = validRoadEdges(state, meIdx)
	return (
		<G>
			{valids.map((e) => {
				const [va, vb] = edgeEndpoints(e)
				const pa = vertexPositions[va]
				const pb = vertexPositions[vb]
				const mx = (pa.x + pb.x) / 2
				const my = (pa.y + pb.y) / 2
				const isSelected =
					selection?.kind === 'road' && selection.edge === e
				return (
					<Fragment key={e}>
						{!isSelected && (
							<PulsingDot
								cx={mx}
								cy={my}
								r={layoutS * 0.2}
								color={color}
							/>
						)}
						<Circle
							cx={mx}
							cy={my}
							r={layoutS * 0.42}
							fill="transparent"
							onPress={() => onSelect({ kind: 'road', edge: e })}
						/>
					</Fragment>
				)
			})}
			{selection?.kind === 'road' &&
				(() => {
					const [va, vb] = edgeEndpoints(selection.edge)
					const pa = vertexPositions[va]
					const pb = vertexPositions[vb]
					return (
						<G opacity={0.5}>
							<EdgePiece
								x1={pa.x}
								y1={pa.y}
								x2={pb.x}
								y2={pb.y}
								size={layoutS}
								player={meIdx}
							/>
						</G>
					)
				})()}
		</G>
	)
}
