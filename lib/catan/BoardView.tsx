import { useState } from 'react'
import { type LayoutChangeEvent, View } from 'react-native'
import {
	Gesture,
	GestureDetector,
	GestureHandlerRootView,
} from 'react-native-gesture-handler'
import Animated, {
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from 'react-native-reanimated'
import Svg, { G } from 'react-native-svg'
import {
	boardFor,
	edgeEndpoints,
	type Edge,
	type Hex,
	type Vertex,
} from './board'
import { forgerTokenHex } from './bonus'
import { BuildLayer, type BoardTool, type BuildSelection } from './BuildLayer'
import { EdgePiece } from './EdgePiece'
import { FenceTokenPiece } from './FenceTokenPiece'
import { ForgerMoveLayer } from './ForgerMoveLayer'
import { ForgerTokenPiece } from './ForgerTokenPiece'
import { HexTile } from './HexTile'
import {
	computeBoardLayout,
	computePortLayout,
	computeVertexPositions,
} from './layout'
import { playerColors } from './palette'
import { PlacementLayer, type PlacementSelection } from './PlacementLayer'
import { PortBadge } from './PortBadge'
import { RobberLayer } from './RobberLayer'
import { RobberPiece } from './RobberPiece'
import { edgeStateOf, vertexStateOf, type GameState } from './types'
import { HauntSpotMarker, VertexPiece } from './VertexPiece'

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
	// The spot awaiting confirmation, previewed as a solid piece on the board.
	pending?: BuildSelection | null
	// Multi-select highlight for the haunt_spot tool (vertices tapped so far).
	selected?: Vertex[]
}

export type RobberInteraction = {
	meIdx: number
	onMoveRobber: (hex: Hex) => void
	onSteal: (victim: number) => void
}

// The forger's compulsory start-of-turn token move. `from` is where the token
// stands now; the layer pulses its neighbours. Mutually exclusive with
// `robber` by phase (`roll` vs `move_robber`).
export type ForgerMoveInteraction = {
	meIdx: number
	from: Hex
	onMove: (hex: Hex) => void
}

const MIN_SCALE = 1
const MAX_SCALE = 4

export function BoardView({
	state,
	viewerIdx,
	interaction,
	build,
	robber,
	forgerMove,
	robberDormant,
}: {
	state: GameState
	// The seat watching the board (-1 for a spectator). Purely for information
	// only that seat may see — today, a haunt player's own secret spots.
	viewerIdx?: number
	interaction?: BoardInteraction
	build?: BuildInteraction
	robber?: RobberInteraction
	forgerMove?: ForgerMoveInteraction
	robberDormant?: boolean
}) {
	const [box, setBox] = useState<{ w: number; h: number } | null>(null)

	const scale = useSharedValue(1)
	const savedScale = useSharedValue(1)
	const translateX = useSharedValue(0)
	const translateY = useSharedValue(0)
	const savedTranslateX = useSharedValue(0)
	const savedTranslateY = useSharedValue(0)

	const onLayout = (e: LayoutChangeEvent) => {
		const { width, height } = e.nativeEvent.layout
		setBox({ w: width, h: height })
	}

	// Zoom is anchored at the board's centre; a two-finger pan repositions it,
	// clamped so the scaled board can't be dragged past the container edges.
	// Pinch and pan both require two pointers, leaving single-finger taps to
	// flow through to the placement / build / robber interaction layers.
	const pinch = Gesture.Pinch()
		.onUpdate((e) => {
			scale.value = Math.min(
				Math.max(savedScale.value * e.scale, MIN_SCALE),
				MAX_SCALE
			)
		})
		.onEnd(() => {
			savedScale.value = scale.value
			if (scale.value <= MIN_SCALE) {
				translateX.value = withTiming(0)
				translateY.value = withTiming(0)
				savedTranslateX.value = 0
				savedTranslateY.value = 0
			}
		})

	const pan = Gesture.Pan()
		.minPointers(2)
		.onUpdate((e) => {
			const maxX = ((box?.w ?? 0) * (scale.value - 1)) / 2
			const maxY = ((box?.h ?? 0) * (scale.value - 1)) / 2
			translateX.value = Math.min(
				Math.max(savedTranslateX.value + e.translationX, -maxX),
				maxX
			)
			translateY.value = Math.min(
				Math.max(savedTranslateY.value + e.translationY, -maxY),
				maxY
			)
		})
		.onEnd(() => {
			savedTranslateX.value = translateX.value
			savedTranslateY.value = translateY.value
		})

	const gesture = Gesture.Simultaneous(pinch, pan)

	const animatedStyle = useAnimatedStyle(() => ({
		transform: [
			{ translateX: translateX.value },
			{ translateY: translateY.value },
			{ scale: scale.value },
		],
	}))

	return (
		<GestureHandlerRootView style={{ flex: 1, width: '100%' }}>
			<View style={{ flex: 1, overflow: 'hidden' }} onLayout={onLayout}>
				{box && box.w > 0 && box.h > 0 && (
					<GestureDetector gesture={gesture}>
						<Animated.View style={[{ flex: 1 }, animatedStyle]}>
							<BoardSvg
								state={state}
								viewerIdx={viewerIdx}
								boxW={box.w}
								boxH={box.h}
								interaction={interaction}
								build={build}
								robber={robber}
								forgerMove={forgerMove}
								robberDormant={robberDormant}
							/>
						</Animated.View>
					</GestureDetector>
				)}
			</View>
		</GestureHandlerRootView>
	)
}

function BoardSvg({
	state,
	viewerIdx,
	boxW,
	boxH,
	interaction,
	build,
	robber,
	forgerMove,
	robberDormant,
}: {
	state: GameState
	viewerIdx?: number
	boxW: number
	boxH: number
	interaction?: BoardInteraction
	build?: BuildInteraction
	robber?: RobberInteraction
	forgerMove?: ForgerMoveInteraction
	robberDormant?: boolean
}) {
	// Ports sit ~1s outside the hex grid on each edge, so the true bounding
	// box is (naturalW + 2)s × (naturalH + 2)s rather than the bare grid.
	// Budget that extension so port badges don't clip at the Svg viewport
	// edges. Natural dims are variant-specific (standard 5√3 × 8, expanded
	// 6√3 × 11).
	const board = boardFor(state.variant)
	const PAD = 8
	const availW = Math.max(0, boxW - PAD * 2)
	const availH = Math.max(0, boxH - PAD * 2)
	const s = Math.min(
		availW / (board.naturalWidthUnits + 2),
		availH / (board.naturalHeightUnits + 2)
	)
	const layout = computeBoardLayout(
		state.variant,
		board.naturalWidthUnits * s,
		board.naturalHeightUnits * s
	)
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
				{Object.entries(state.fenceTokens ?? {}).map(
					([eid, player]) => {
						if (player === undefined) return null
						if (edgeStateOf(state, eid as Edge).occupied)
							return null
						const [va, vb] = edgeEndpoints(eid as Edge)
						const pa = vertexPositions[va]
						const pb = vertexPositions[vb]
						return (
							<FenceTokenPiece
								key={`fence-${eid}`}
								x1={pa.x}
								y1={pa.y}
								x2={pb.x}
								y2={pb.y}
								size={layout.s}
								player={player}
							/>
						)
					}
				)}
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
				{viewerIdx !== undefined &&
					viewerIdx >= 0 &&
					(state.players[viewerIdx]?.hauntSpots ?? []).map((v) => {
						if (vertexStateOf(state, v).occupied) return null
						const pos = vertexPositions[v]
						if (!pos) return null
						return (
							<HauntSpotMarker
								key={`haunt-${v}`}
								cx={pos.x}
								cy={pos.y}
								size={layout.s}
								player={viewerIdx}
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
							dormant={robberDormant}
						/>
					)
				})()}
				{state.players.map((p, i) => {
					if (p.bonus !== 'forger') return null
					const tokenHex = forgerTokenHex(p, state.robber)
					const hex = layout.hexes.find((h) => h.id === tokenHex)
					if (!hex) return null
					return (
						<ForgerTokenPiece
							key={`forger-${i}`}
							cx={hex.cx}
							cy={hex.cy}
							size={layout.s}
							color={playerColors[i] ?? playerColors[0]}
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
				{build && (
					<BuildLayer
						state={state}
						meIdx={build.meIdx}
						layoutS={layout.s}
						vertexPositions={vertexPositions}
						tool={build.tool}
						onSelect={build.onSelect}
						pending={build.pending}
						selected={build.selected}
					/>
				)}
				{forgerMove && (
					<ForgerMoveLayer
						state={state}
						meIdx={forgerMove.meIdx}
						from={forgerMove.from}
						layoutS={layout.s}
						hexLayouts={layout.hexes}
						onMove={forgerMove.onMove}
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
