import { Fragment } from 'react'
import { Circle, G } from 'react-native-svg'
import { boardFor, edgeEndpoints, type Edge, type Vertex } from './board'
import { fenceOwner } from './bonus'
import {
	validBuildCityVertices,
	validBuildRoadEdges,
	validBuildSettlementVertices,
	validBuildSuperCityVertices,
	type BuildKind,
} from './build'
import { EdgePiece } from './EdgePiece'
import { validSettlementVertices } from './placement'
import { playerColors } from './palette'
import { PulsingDot } from './PulsingDot'
import { edgeStateOf, type GameState } from './types'
import { VertexPiece } from './VertexPiece'

// `super_city` is the metropolitan upgrade (cities → super_city). It uses
// the build-bar pulse layer the same way as the standard kinds, but is gated
// on the metropolitan bonus. `explorer_road` is the post_placement free-road
// pulse for the explorer bonus — same edge validity as a paid road, just
// gated on a different phase.
export type BoardTool =
	| BuildKind
	| 'super_city'
	| 'explorer_road'
	| 'fence_token'
	| 'haunt_spot'

export type BuildSelection =
	| { kind: 'road'; edge: Edge }
	| { kind: 'settlement'; vertex: Vertex }
	| { kind: 'city'; vertex: Vertex }
	| { kind: 'super_city'; vertex: Vertex }
	| { kind: 'explorer_road'; edge: Edge }
	| { kind: 'fence_token'; edge: Edge }
	| { kind: 'haunt_spot'; vertex: Vertex }

// Empty, unfenced edges — where a fencer may drop a reserve token during
// post_placement (any edge, no connectivity required).
function fenceableEdges(state: GameState): Edge[] {
	return boardFor(state.variant).edges.filter(
		(e) => !edgeStateOf(state, e).occupied && fenceOwner(state, e) === null
	)
}

// Overlay inside BoardSvg's transformed group. When a build tool is active,
// pulses all valid spots for the current player and surfaces invisible hit
// targets that bubble up a BuildSelection. Renders nothing when tool is null
// or when the game isn't in a phase that allows the requested tool.
export function BuildLayer({
	state,
	meIdx,
	tool,
	layoutS,
	vertexPositions,
	onSelect,
	pending,
	selected,
}: {
	state: GameState
	meIdx: number
	tool: BoardTool | null
	layoutS: number
	vertexPositions: Record<Vertex, { x: number; y: number }>
	onSelect: (selection: BuildSelection) => void
	// The spot the player has tapped and is being asked to confirm. Rendered
	// as a solid preview piece so the choice is visible while the confirm bar
	// is up, instead of blending into the pulsing valid-spot dots.
	pending?: BuildSelection | null
	// Multi-select highlight (haunt_spot): vertices already tapped this pick.
	selected?: Vertex[]
}) {
	if (!tool) return null
	const inMain = state.phase.kind === 'main'
	const inPostPlacement = state.phase.kind === 'post_placement'
	const inRoadBuilding = state.phase.kind === 'road_building'
	if (
		tool === 'explorer_road' ||
		tool === 'fence_token' ||
		tool === 'haunt_spot'
	) {
		if (!inPostPlacement) return null
	} else if (tool === 'road') {
		// Road Building dev card places free roads outside the main phase.
		if (!inMain && !inRoadBuilding) return null
	} else {
		if (!inMain) return null
	}
	const color = playerColors[meIdx] ?? playerColors[0]

	if (tool === 'fence_token') {
		const valids = fenceableEdges(state)
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
								r={layoutS * 0.16}
								color={color}
							/>
							<Circle
								cx={mx}
								cy={my}
								r={layoutS * 0.42}
								fill="transparent"
								onPress={() =>
									onSelect({ kind: 'fence_token', edge: e })
								}
							/>
						</Fragment>
					)
				})}
			</G>
		)
	}

	if (tool === 'haunt_spot') {
		const valids = validSettlementVertices(state)
		const picked = new Set(selected ?? [])
		return (
			<G>
				{valids.map((v) => {
					const p = vertexPositions[v]
					const isPicked = picked.has(v)
					return (
						<Fragment key={v}>
							{isPicked ? (
								<VertexPiece
									cx={p.x}
									cy={p.y}
									size={layoutS}
									building="ghost"
									player={meIdx}
								/>
							) : (
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
									onSelect({ kind: 'haunt_spot', vertex: v })
								}
							/>
						</Fragment>
					)
				})}
			</G>
		)
	}

	if (tool === 'road' || tool === 'explorer_road') {
		const valids = validBuildRoadEdges(state, meIdx)
		const pickKind = tool
		const pendingEdge = pending?.kind === 'road' ? pending.edge : null
		return (
			<G>
				{valids.map((e) => {
					const [va, vb] = edgeEndpoints(e)
					const pa = vertexPositions[va]
					const pb = vertexPositions[vb]
					const mx = (pa.x + pb.x) / 2
					const my = (pa.y + pb.y) / 2
					const isPending = e === pendingEdge
					return (
						<Fragment key={e}>
							{isPending ? (
								<EdgePiece
									x1={pa.x}
									y1={pa.y}
									x2={pb.x}
									y2={pb.y}
									size={layoutS}
									player={meIdx}
								/>
							) : (
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
								onPress={() =>
									onSelect({ kind: pickKind, edge: e })
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
			: tool === 'city'
				? validBuildCityVertices(state, meIdx)
				: validBuildSuperCityVertices(state, meIdx)

	const pendingVertex =
		pending && pending.kind === tool && 'vertex' in pending
			? pending.vertex
			: null

	return (
		<G>
			{valids.map((v) => {
				const p = vertexPositions[v]
				const isPending = v === pendingVertex
				return (
					<Fragment key={v}>
						{isPending ? (
							<VertexPiece
								cx={p.x}
								cy={p.y}
								size={layoutS}
								building={tool}
								player={meIdx}
							/>
						) : (
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
							onPress={() => onSelect({ kind: tool, vertex: v })}
						/>
					</Fragment>
				)
			})}
		</G>
	)
}
