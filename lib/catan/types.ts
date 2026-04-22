import type {
	Edge,
	Hex,
	HexNumber,
	PortKind,
	Resource,
	Vertex,
	VertexBuilding,
} from './board'
import type { BonusId, CurseId } from './bonuses'

export type Variant = 'standard'

// Top-level game config. Serialized to JSONB on game_requests and game_states.
// Today: only a single bonuses toggle. New options get added here (and wired
// through the propose_game RPC + handleRespond in the edge function).
export type GameConfig = {
	bonuses: boolean
}

export const DEFAULT_CONFIG: GameConfig = { bonuses: false }

export function normalizeConfig(raw: unknown): GameConfig {
	if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG }
	const obj = raw as Record<string, unknown>
	return {
		bonuses: obj.bonuses === true,
	}
}

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
	// Kept bonus + dealt curse. Populated when the select_bonus phase ends;
	// absent on standard (non-bonuses) games.
	bonus?: BonusId
	curse?: CurseId
}

// Per-player card hand during the select_bonus phase. `offered` is the two
// bonus cards dealt to the player (duplicates allowed; the pool today has
// size 1). `chosen` flips from null to one of `offered` on commit.
export type SelectBonusHand = {
	offered: [BonusId, BonusId]
	curse: CurseId
	chosen: BonusId | null
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

export type Port = { edge: Edge; kind: PortKind }

// Ratio + resource scoping chosen by the player for a single bank trade.
// '4:1' is the always-available default; '3:1' requires a generic port; the
// resource-scoped '2:1-*' variants require the matching specific port.
export type BankKind =
	| '4:1'
	| '3:1'
	| '2:1-brick'
	| '2:1-wood'
	| '2:1-sheep'
	| '2:1-wheat'
	| '2:1-ore'

export type Phase =
	// Bonus-game-only pre-placement phase. Each player is dealt two bonus
	// cards + one curse, picks one bonus to keep. Picks happen in parallel;
	// once every `hands[i].chosen` is non-null, the phase advances to
	// initial_placement and the kept bonus/curse snapshots onto PlayerState.
	| { kind: 'select_bonus'; hands: Record<number, SelectBonusHand> }
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
	// Optional so games created before ports existed still parse. New games
	// always seed 9 ports; readers should default a missing array to empty.
	ports?: Port[]
	// Optional so games created before this feature still parse. New games
	// always carry the config that was on the game_request.
	config?: GameConfig
}

export const EMPTY_VERTEX: VertexState = { occupied: false }
export const EMPTY_EDGE: EdgeState = { occupied: false }

export function vertexStateOf(state: GameState, vertex: Vertex): VertexState {
	return state.vertices[vertex] ?? EMPTY_VERTEX
}

export function edgeStateOf(state: GameState, edge: Edge): EdgeState {
	return state.edges[edge] ?? EMPTY_EDGE
}
