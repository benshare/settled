import { Fragment } from 'react'
import { Circle, G, Text as SvgText } from 'react-native-svg'
import { edgeEndpoints, type Edge, type Vertex } from './board'
import { EdgePiece } from './EdgePiece'
import {
	pieceStroke,
	pieceStrokeSoft,
	seatColor,
	tokenFace,
	tokenTextCool,
} from './palette'
import {
	applyPlacementDraft,
	validRoadEdges,
	validSettlementVertices,
	type PlacementDraftEntry,
} from './placement'
import { PulsingDot, PulsingRing } from './PulsingDot'
import type { GameState } from './types'
import { VertexPiece } from './VertexPiece'

// One board tap: a settlement spot, a road edge, or — once a two-pair draft is
// complete — one of the tapper's own two drafted settlements, nominating it as
// the one placed second.
export type PlacementSelection =
	{ kind: 'settlement'; vertex: Vertex } | { kind: 'road'; edge: Edge }

// Overlay inside BoardSvg's transformed group. Shows valid-spot dots + hit
// targets during the current user's initial-placement turn, plus ghost previews
// of everything chosen so far. Does nothing if the game isn't in the
// initial-placement phase.
//
// A placement turn is a whole turn: the draft accumulates a settlement, its
// road, and — for the seat that places both back-to-back — a second pair, with
// nothing sent until the player confirms. Each piece's valid spots are computed
// against the draft applied, so the second settlement respects the first's
// distance footprint and its road attaches to it rather than to the first.
//
// With both pairs down, that seat must still nominate which settlement counts as
// its second (the one that pays starting resources) by tapping its ring. Nothing
// is pre-chosen and Confirm is disabled until it is, so the choice can't be
// carried past — see `.claude/specs/inline-last-settlement.md`.
export function PlacementLayer({
	state,
	meIdx,
	layoutS,
	vertexPositions,
	draft,
	pairsExpected,
	canNominate,
	nominated,
	onSelect,
}: {
	state: GameState
	meIdx: number
	layoutS: number
	vertexPositions: Record<Vertex, { x: number; y: number }>
	draft: readonly PlacementDraftEntry[]
	pairsExpected: 1 | 2
	// Whether this seat chooses which of its two settlements counts as the
	// second — false for everyone but the back-to-back seat, and for an
	// aristocrat in it (which collects on both, so there is nothing to pick).
	canNominate: boolean
	// The settlement nominated as the second-placed one, or null until the seat
	// says — deliberately unseeded, so the choice has to be made.
	nominated: Vertex | null
	onSelect: (s: PlacementSelection) => void
}) {
	if (state.phase.kind !== 'initial_placement') return null
	const color = seatColor(state, meIdx)

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
							color={color}
						/>
					</G>
					{entry.edge !== undefined && (
						<RoadGhost
							edge={entry.edge}
							layoutS={layoutS}
							color={color}
							vertexPositions={vertexPositions}
						/>
					)}
				</Fragment>
			))}

			{stage === 'ready' &&
				canNominate &&
				draft.map((entry, i) => (
					<NominationTarget
						key={`pick-${entry.vertex}`}
						cx={vertexPositions[entry.vertex].x}
						cy={vertexPositions[entry.vertex].y}
						layoutS={layoutS}
						ordinal={i + 1}
						// Before a choice, both read as equally live; after
						// one, the other dims but keeps pulsing, since it is
						// still tappable to switch.
						state={
							nominated === null
								? 'open'
								: nominated === entry.vertex
									? 'chosen'
									: 'other'
						}
						onPress={() =>
							onSelect({
								kind: 'settlement',
								vertex: entry.vertex,
							})
						}
					/>
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

			{stage === 'road' &&
				validRoadEdges(drafted, meIdx).map((e) => {
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

// One of the two drafted settlements, offered as the seat's nomination for the
// settlement it placed second. The ordinal badge is what makes the question
// answerable — by 'ready' both settlements are down and the draft order is the
// only thing distinguishing them, which the board otherwise doesn't show.
function NominationTarget({
	cx,
	cy,
	layoutS,
	ordinal,
	state,
	onPress,
}: {
	cx: number
	cy: number
	layoutS: number
	ordinal: number
	state: 'open' | 'chosen' | 'other'
	onPress: () => void
}) {
	// Deliberately monochrome rather than seat-colored: the chosen one reads as
	// the darker of the two at any seat color, white included.
	const stroke = state === 'other' ? pieceStrokeSoft : pieceStroke
	const badgeR = layoutS * 0.26
	const badgeX = cx + layoutS * 0.36
	const badgeY = cy - layoutS * 0.36
	const chosen = state === 'chosen'
	return (
		<>
			<PulsingRing
				cx={cx}
				cy={cy}
				r={layoutS * 0.32}
				color={stroke}
				width={layoutS * (chosen ? 0.1 : 0.07)}
			/>
			<Circle
				cx={badgeX}
				cy={badgeY}
				r={badgeR}
				fill={chosen ? pieceStroke : tokenFace}
				stroke={stroke}
				strokeWidth={Math.max(1, layoutS * 0.035)}
			/>
			<SvgText
				x={badgeX}
				y={badgeY + badgeR * 0.1}
				fill={
					chosen
						? tokenFace
						: state === 'other'
							? pieceStrokeSoft
							: tokenTextCool
				}
				fontSize={badgeR * 1.1}
				fontWeight="800"
				textAnchor="middle"
				alignmentBaseline="middle"
			>
				{ordinal}
			</SvgText>
			{/* Piece and badge are separate targets so neither is a dead spot. */}
			<Circle
				cx={cx}
				cy={cy}
				r={layoutS * 0.45}
				fill="transparent"
				onPress={onPress}
			/>
			<Circle
				cx={badgeX}
				cy={badgeY}
				r={badgeR * 1.2}
				fill="transparent"
				onPress={onPress}
			/>
		</>
	)
}

function RoadGhost({
	edge,
	layoutS,
	color,
	vertexPositions,
}: {
	edge: Edge
	layoutS: number
	color: string
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
				color={color}
			/>
		</G>
	)
}
