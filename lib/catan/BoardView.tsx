import { useState } from 'react'
import { type LayoutChangeEvent, View } from 'react-native'
import Svg, { G } from 'react-native-svg'
import { edgeEndpoints, type Edge, type Hex, type Vertex } from './board'
import { BuildLayer, type BoardTool, type BuildSelection } from './BuildLayer'
import { EdgePiece } from './EdgePiece'
import { HexTile } from './HexTile'
import {
	computeBoardLayout,
	computePortLayout,
	computeVertexPositions,
} from './layout'
import { PlacementLayer, type PlacementSelection } from './PlacementLayer'
import { PortBadge } from './PortBadge'
import { RobberLayer } from './RobberLayer'
import { RobberPiece } from './RobberPiece'
import type { GameState } from './types'
import { VertexPiece } from './VertexPiece'

// Interaction bundles everything the placement overlay needs. Omit to render
// a purely visual board (as during other phases or for spectators).
export type BoardInteraction = {
	meIdx: number
	selection: PlacementSelection | null
	onSelect: (s: PlacementSelection) => void
}

export type BuildInteraction = {
	meIdx: number
	tool: BoardTool | null
	onSelect: (selection: BuildSelection) => void
}

export type RobberInteraction = {
	meIdx: number
	onMoveRobber: (hex: Hex) => void
	onSteal: (victim: number) => void
}

export function BoardView({
	state,
	interaction,
	build,
	robber,
}: {
	state: GameState
	interaction?: BoardInteraction
	build?: BuildInteraction
	robber?: RobberInteraction
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
					build={build}
					robber={robber}
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
	build,
	robber,
}: {
	state: GameState
	boxW: number
	boxH: number
	interaction?: BoardInteraction
	build?: BuildInteraction
	robber?: RobberInteraction
}) {
	const PAD = 16
	const innerW = Math.max(0, boxW - PAD * 2)
	const innerH = Math.max(0, boxH - PAD * 2)
	const layout = computeBoardLayout(innerW, innerH)
	const vertexPositions = computeVertexPositions(layout)
	const portVisuals = computePortLayout(layout, state.ports ?? [])
	const offsetX = (boxW - layout.width) / 2
	const offsetY = (boxH - layout.height) / 2

	return (
		<Svg width={boxW} height={boxH}>
			<G x={offsetX} y={offsetY}>
				{layout.hexes.map((h) => (
					<HexTile
						key={h.id}
						layout={h}
						size={layout.s}
						data={state.hexes[h.id]}
					/>
				))}
				{portVisuals.map((pv) => (
					<PortBadge key={pv.port.edge} visual={pv} size={layout.s} />
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
				{(() => {
					const robberHex = layout.hexes.find(
						(h) => h.id === state.robber
					)
					if (!robberHex) return null
					return (
						<RobberPiece
							cx={robberHex.cx}
							cy={robberHex.cy}
							size={layout.s}
						/>
					)
				})()}
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
				{build && (
					<BuildLayer
						state={state}
						meIdx={build.meIdx}
						layoutS={layout.s}
						vertexPositions={vertexPositions}
						tool={build.tool}
						onSelect={build.onSelect}
					/>
				)}
				{robber && (
					<RobberLayer
						state={state}
						meIdx={robber.meIdx}
						layoutS={layout.s}
						hexLayouts={layout.hexes}
						vertexPositions={vertexPositions}
						onMoveRobber={robber.onMoveRobber}
						onSteal={robber.onSteal}
					/>
				)}
			</G>
		</Svg>
	)
}
