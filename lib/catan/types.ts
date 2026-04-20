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

export type DieFace = 1 | 2 | 3 | 4 | 5 | 6
export type DiceRoll = { a: DieFace; b: DieFace }

export type TradeOffer = {
	id: string
	from: number
	// Empty means "all other players". Never contains `from`.
	to: number[]
	give: ResourceHand
	receive: ResourceHand
	createdAt: string
}

export type Phase =
	| { kind: 'initial_placement'; round: 1 | 2; step: 'settlement' | 'road' }
	| { kind: 'roll' }
	| {
			kind: 'discard'
			roll: DiceRoll
			// Amount each player still owes. Entries are removed as players submit.
			pending: Partial<Record<number, number>>
	  }
	| { kind: 'move_robber'; roll: DiceRoll }
	| { kind: 'steal'; roll: DiceRoll; hex: Hex; candidates: number[] }
	// `trade` piggy-backs on the main phase so we don't need a separate
	// top-level field (and a DB column). It's always cleared when leaving main.
	| { kind: 'main'; roll: DiceRoll; trade: TradeOffer | null }
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
	robber: Hex
}

export const EMPTY_VERTEX: VertexState = { occupied: false }
export const EMPTY_EDGE: EdgeState = { occupied: false }

export function vertexStateOf(state: GameState, vertex: Vertex): VertexState {
	return state.vertices[vertex] ?? EMPTY_VERTEX
}

export function edgeStateOf(state: GameState, edge: Edge): EdgeState {
	return state.edges[edge] ?? EMPTY_EDGE
}
