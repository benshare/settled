import type {
	Edge,
	Hex,
	HexNumber,
	Resource,
	Vertex,
	VertexBuilding,
} from './board'

export type Variant = 'standard'

export type HexData =
	| { resource: null }
	| { resource: Resource; number: HexNumber }

export type VertexState =
	| { occupied: false }
	| { occupied: true; player: number; building: VertexBuilding }

export type EdgeState = { occupied: false } | { occupied: true; player: number }

export type ResourceHand = Record<Resource, number>

export type PlayerState = {
	resources: ResourceHand
}

export type Phase =
	| { kind: 'initial_placement'; round: 1 | 2; step: 'settlement' | 'road' }
	| { kind: 'roll' }
	| { kind: 'main' }
	| { kind: 'game_over' }

// vertices / edges are Partial — a missing key means the default
// `{ occupied: false }`. Keeps storage for a fresh game tiny and avoids
// needing to pre-populate 54 + 72 empty entries at insert time.
export type GameState = {
	variant: Variant
	hexes: Record<Hex, HexData>
	vertices: Partial<Record<Vertex, VertexState>>
	edges: Partial<Record<Edge, EdgeState>>
	players: PlayerState[]
	phase: Phase
}

export const EMPTY_VERTEX: VertexState = { occupied: false }
export const EMPTY_EDGE: EdgeState = { occupied: false }

export function vertexStateOf(state: GameState, vertex: Vertex): VertexState {
	return state.vertices[vertex] ?? EMPTY_VERTEX
}

export function edgeStateOf(state: GameState, edge: Edge): EdgeState {
	return state.edges[edge] ?? EMPTY_EDGE
}
