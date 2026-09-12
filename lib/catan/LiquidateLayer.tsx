import { Fragment } from 'react'
import { Circle, G } from 'react-native-svg'
import { edgeEndpoints, type Vertex } from './board'
import { liquidatableTargets, type LiquidationTarget } from './bonus'
import { pieceStroke, pieceStrokeSoft } from './palette'
import { PulsingRing } from './PulsingDot'
import type { GameState } from './types'

// Overlay inside BoardSvg's transformed group. Active while the accountant has
// the liquidate tool up: every piece of theirs that may be cashed in pulses,
// and a tap raises the confirm bar. Rings rather than dots, because each spot
// already holds the piece being pointed at.
//
// The pieces are the player's own colour, so the ring is drawn in the shared
// piece stroke instead — a same-colour halo around a same-colour piece reads as
// a glow rather than a target. The tapped one darkens while it waits on the
// confirm bar; like the placement nomination rings, it keeps pulsing, since a
// frozen ring in a field of pulsing ones reads as disabled.
export function LiquidateLayer({
	state,
	meIdx,
	layoutS,
	vertexPositions,
	pending,
	onSelect,
}: {
	state: GameState
	meIdx: number
	layoutS: number
	vertexPositions: Record<Vertex, { x: number; y: number }>
	// The target awaiting confirmation, or null when nothing is tapped.
	pending: LiquidationTarget | null
	onSelect: (target: LiquidationTarget) => void
}) {
	if (meIdx < 0) return null
	const targets = liquidatableTargets(state, meIdx)
	return (
		<G>
			{targets.map((t) => {
				const isEdge = t.kind === 'road'
				const p = isEdge
					? edgeMidpoint(t.edge, vertexPositions)
					: vertexPositions[t.vertex]
				if (!p) return null
				const key = isEdge ? `road-${t.edge}` : `${t.kind}-${t.vertex}`
				const isPending = pending ? sameTarget(pending, t) : false
				return (
					<Fragment key={key}>
						<PulsingRing
							cx={p.x}
							cy={p.y}
							r={layoutS * RING_R[t.kind]}
							color={isPending ? pieceStroke : pieceStrokeSoft}
							width={layoutS * 0.07}
						/>
						<Circle
							cx={p.x}
							cy={p.y}
							r={layoutS * (isEdge ? 0.42 : 0.45)}
							fill="transparent"
							onPress={() => onSelect(t)}
						/>
					</Fragment>
				)
			})}
		</G>
	)
}

// Each ring clears the piece it surrounds — a super city is nearly twice the
// settlement's width — while staying inside half an edge length, so a ring can
// never reach its neighbours' spots.
const RING_R: Record<LiquidationTarget['kind'], number> = {
	road: 0.24,
	settlement: 0.32,
	city: 0.38,
	super_city: 0.44,
}

function sameTarget(a: LiquidationTarget, b: LiquidationTarget): boolean {
	if (a.kind !== b.kind) return false
	return a.kind === 'road' && b.kind === 'road'
		? a.edge === b.edge
		: 'vertex' in a && 'vertex' in b && a.vertex === b.vertex
}

function edgeMidpoint(
	edge: string,
	vertexPositions: Record<Vertex, { x: number; y: number }>
): { x: number; y: number } | null {
	const [va, vb] = edgeEndpoints(edge)
	const pa = vertexPositions[va]
	const pb = vertexPositions[vb]
	if (!pa || !pb) return null
	return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }
}
