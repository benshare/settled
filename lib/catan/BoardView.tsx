import { useState } from 'react'
import { type LayoutChangeEvent, View } from 'react-native'
import Svg, { G, Rect } from 'react-native-svg'
import { edgeEndpoints, type Edge, type Vertex } from './board'
import { EdgePiece } from './EdgePiece'
import { HexTile } from './HexTile'
import { computeBoardLayout, computeVertexPositions } from './layout'
import { waterColor } from './palette'
import { PlacementLayer, type PlacementSelection } from './PlacementLayer'
import type { GameState } from './types'
import { VertexPiece } from './VertexPiece'

// Interaction bundles everything the placement overlay needs. Omit to render
// a purely visual board (as during other phases or for spectators).
export type BoardInteraction = {
	meIdx: number
	selection: PlacementSelection | null
	onSelect: (s: PlacementSelection) => void
}

export function BoardView({
	state,
	interaction,
}: {
	state: GameState
	interaction?: BoardInteraction
}) {
	const [box, setBox] = useState<{ w: number; h: number } | null>(null)

	const onLayout = (e: LayoutChangeEvent) => {
		const { width, height } = e.nativeEvent.layout
		setBox({ w: width, h: height })
	}

	return (
		<View style={{ flex: 1, width: '100%' }} onLayout={onLayout}>
			{box && box.w > 0 && box.h > 0 && (
				<BoardSvg
					state={state}
					boxW={box.w}
					boxH={box.h}
					interaction={interaction}
				/>
			)}
		</View>
	)
}

function BoardSvg({
	state,
	boxW,
	boxH,
	interaction,
}: {
	state: GameState
	boxW: number
	boxH: number
	interaction?: BoardInteraction
}) {
	const layout = computeBoardLayout(boxW * 0.9, boxH * 0.9)
	const vertexPositions = computeVertexPositions(layout)
	const offsetX = (boxW - layout.width) / 2
	const offsetY = (boxH - layout.height) / 2

	return (
		<Svg width={boxW} height={boxH}>
			<Rect x={0} y={0} width={boxW} height={boxH} fill={waterColor} />
			<G x={offsetX} y={offsetY}>
				{layout.hexes.map((h) => (
					<HexTile
						key={h.id}
						layout={h}
						size={layout.s}
						data={state.hexes[h.id]}
					/>
				))}
				{Object.entries(state.edges).map(([eid, es]) => {
					if (!es || !es.occupied) return null
					const [va, vb] = edgeEndpoints(eid as Edge)
					const pa = vertexPositions[va]
					const pb = vertexPositions[vb]
					return (
						<EdgePiece
							key={eid}
							x1={pa.x}
							y1={pa.y}
							x2={pb.x}
							y2={pb.y}
							size={layout.s}
							player={es.player}
						/>
					)
				})}
				{Object.entries(state.vertices).map(([vid, vs]) => {
					if (!vs || !vs.occupied) return null
					const pos = vertexPositions[vid as Vertex]
					return (
						<VertexPiece
							key={vid}
							cx={pos.x}
							cy={pos.y}
							size={layout.s}
							building={vs.building}
							player={vs.player}
						/>
					)
				})}
				{interaction && (
					<PlacementLayer
						state={state}
						meIdx={interaction.meIdx}
						layoutS={layout.s}
						vertexPositions={vertexPositions}
						selection={interaction.selection}
						onSelect={interaction.onSelect}
					/>
				)}
			</G>
		</Svg>
	)
}
