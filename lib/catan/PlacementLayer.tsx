import { Fragment } from 'react'
import { Circle, G } from 'react-native-svg'
import { edgeEndpoints, type Edge, type Vertex } from './board'
import { EdgePiece } from './EdgePiece'
import { pieceStroke, playerColors } from './palette'
import {
	applyPlacementDraft,
	ownSettlementVertices,
	validRoadEdges,
	validSettlementVertices,
	type PlacementDraftEntry,
} from './placement'
import { PulsingDot, PulsingRing } from './PulsingDot'
import type { GameState } from './types'
import { VertexPiece } from './VertexPiece'

// The single-piece selection of the two steps that still take one: `pick_last`,
// and the legacy `road` step a game can be left on by an older client or by the
// timeout sweep.
export type PlacementSelection =
	{ kind: 'settlement'; vertex: Vertex } | { kind: 'road'; edge: Edge }

// Overlay inside BoardSvg's transformed group. Shows valid-spot dots + hit
// targets during the current user's initial-placement turn, plus ghost previews
// of everything chosen so far — or, on the `pick_last` step, rings around the
// two settlements being chosen between. Does nothing if the game isn't in the
// initial-placement phase.
//
// The ordinary `settlement` step is a whole turn: the draft accumulates a
// settlement, its road, and — for the seat that places both back-to-back — a
// second pair, with nothing sent until the player confirms. Each piece's valid
// spots are computed against the draft applied, so the second settlement
// respects the first's distance footprint and its road attaches to it rather
// than to the first.
export function PlacementLayer({
	state,
	meIdx,
	layoutS,
	vertexPositions,
	draft,
	pairsExpected,
	selection,
	onSelect,
}: {
	state: GameState
	meIdx: number
	layoutS: number
	vertexPositions: Record<Vertex, { x: number; y: number }>
	draft: readonly PlacementDraftEntry[]
	pairsExpected: 1 | 2
	selection: PlacementSelection | null
	onSelect: (s: PlacementSelection) => void
}) {
	if (state.phase.kind !== 'initial_placement') return null
	const step = state.phase.step
	const color = playerColors[meIdx] ?? playerColors[0]

	// The back-to-back seat nominating which settlement it placed last. Both of
	// its settlements are already on the board, so the affordance rings the
	// pieces rather than marking empty spots. Self-gating: nobody else has two
	// settlements to choose between, and a spectator (meIdx -1) owns none.
	if (step === 'pick_last') {
		const mine = ownSettlementVertices(state, meIdx)
		return (
			<G>
				{mine.map((v) => {
					const p = vertexPositions[v]
					const isSelected =
						selection?.kind === 'settlement' &&
						selection.vertex === v
					return (
						<Fragment key={v}>
							{isSelected ? (
								<Circle
									cx={p.x}
									cy={p.y}
									r={layoutS * 0.5}
									fill="none"
									stroke={pieceStroke}
									strokeWidth={layoutS * 0.12}
								/>
							) : (
								<PulsingRing
									cx={p.x}
									cy={p.y}
									r={layoutS * 0.5}
									color={pieceStroke}
									width={layoutS * 0.08}
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
			</G>
		)
	}

	// A turn left mid-way by an older client or by the timeout sweep: one edge,
	// one confirm, exactly as before.
	if (step === 'road') {
		const selected = selection?.kind === 'road' ? selection.edge : null
		return (
			<G>
				<RoadSpots
					edges={validRoadEdges(state, meIdx)}
					selected={selected}
					layoutS={layoutS}
					color={color}
					vertexPositions={vertexPositions}
					onSelect={onSelect}
				/>
				{selected && (
					<RoadGhost
						edge={selected}
						layoutS={layoutS}
						meIdx={meIdx}
						vertexPositions={vertexPositions}
					/>
				)}
			</G>
		)
	}

	// step === 'settlement' — the whole turn, drafted locally.
	const drafted = applyPlacementDraft(state, meIdx, draft)
	const open = draft[draft.length - 1]
	const stage: 'settlement' | 'road' | 'ready' =
		open && open.edge === undefined
			? 'road'
			: draft.length < pairsExpected
				? 'settlement'
				: 'ready'

	return (
		<G>
			{draft.map((entry) => (
				<Fragment key={entry.vertex}>
					<G opacity={0.5}>
						<VertexPiece
							cx={vertexPositions[entry.vertex].x}
							cy={vertexPositions[entry.vertex].y}
							size={layoutS}
							building="settlement"
							player={meIdx}
						/>
					</G>
					{entry.edge !== undefined && (
						<RoadGhost
							edge={entry.edge}
							layoutS={layoutS}
							meIdx={meIdx}
							vertexPositions={vertexPositions}
						/>
					)}
				</Fragment>
			))}

			{stage === 'settlement' &&
				validSettlementVertices(drafted, meIdx).map((v) => {
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
								onPress={() =>
									onSelect({ kind: 'settlement', vertex: v })
								}
							/>
						</Fragment>
					)
				})}

			{stage === 'road' && (
				<RoadSpots
					edges={validRoadEdges(drafted, meIdx)}
					selected={null}
					layoutS={layoutS}
					color={color}
					vertexPositions={vertexPositions}
					onSelect={onSelect}
				/>
			)}
		</G>
	)
}

function RoadSpots({
	edges,
	selected,
	layoutS,
	color,
	vertexPositions,
	onSelect,
}: {
	edges: Edge[]
	selected: Edge | null
	layoutS: number
	color: string
	vertexPositions: Record<Vertex, { x: number; y: number }>
	onSelect: (s: PlacementSelection) => void
}) {
	return (
		<>
			{edges.map((e) => {
				const [va, vb] = edgeEndpoints(e)
				const pa = vertexPositions[va]
				const pb = vertexPositions[vb]
				const mx = (pa.x + pb.x) / 2
				const my = (pa.y + pb.y) / 2
				return (
					<Fragment key={e}>
						{selected !== e && (
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
		</>
	)
}

function RoadGhost({
	edge,
	layoutS,
	meIdx,
	vertexPositions,
}: {
	edge: Edge
	layoutS: number
	meIdx: number
	vertexPositions: Record<Vertex, { x: number; y: number }>
}) {
	const [va, vb] = edgeEndpoints(edge)
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
}
