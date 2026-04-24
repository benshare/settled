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
import type { DevCardId } from './devCards'

export type Variant = 'standard'

// Top-level game config. Serialized to JSONB on game_requests and
// game_states. New options get added here (and wired through the
// propose_game RPC + handleRespond in the edge function).
export type GameConfig = {
	bonuses: boolean
	// Which bonus sets are in the draw pool when `bonuses` is on. Only '1' is
	// live today; '2' and '3' are defined in the data but disabled in the UI.
	bonusSets: string[]
	devCards: boolean
}

// System-shipped defaults for a standard game. Used as the reference when
// summarizing a game's options (e.g. "bonuses enabled" means this game
// differs from the global default). Mirrors the server-side default on
// `profiles.game_defaults`, kept in a flat GameConfig shape for consumers.
export const DEFAULT_CONFIG: GameConfig = {
	bonuses: false,
	bonusSets: ['1'],
	devCards: true,
}

// Defensive JSON reader. `raw` comes off `game_requests.config` /
// `game_states.config` as `Json`; any missing fields fall back to the
// global defaults so a partially-written row still renders sanely.
export function parseGameConfig(raw: unknown): GameConfig {
	if (!raw || typeof raw !== 'object') return DEFAULT_CONFIG
	const src = raw as Record<string, unknown>
	return {
		bonuses:
			typeof src.bonuses === 'boolean'
				? src.bonuses
				: DEFAULT_CONFIG.bonuses,
		bonusSets:
			Array.isArray(src.bonusSets) &&
			src.bonusSets.every((s) => typeof s === 'string')
				? (src.bonusSets as string[])
				: DEFAULT_CONFIG.bonusSets,
		devCards:
			typeof src.devCards === 'boolean'
				? src.devCards
				: DEFAULT_CONFIG.devCards,
	}
}

// Human-readable one-liner for a game's config relative to DEFAULT_CONFIG.
// Only non-default options get called out. Example outputs:
//   "3 player game"
//   "2 player game. Bonuses enabled"
//   "4 player game. Bonuses enabled (sets 1, 2). Dev cards disabled"
export function summarizeGameConfig(
	config: GameConfig,
	playerCount: number
): string {
	const parts: string[] = [`${playerCount} player game`]
	const nonDefaultSets =
		config.bonuses &&
		!sameStringSet(config.bonusSets, DEFAULT_CONFIG.bonusSets)
	if (config.bonuses !== DEFAULT_CONFIG.bonuses) {
		if (config.bonuses) {
			const suffix = nonDefaultSets
				? ` (sets ${[...config.bonusSets].sort().join(', ')})`
				: ''
			parts.push(`Bonuses enabled${suffix}`)
		} else {
			parts.push('Bonuses disabled')
		}
	} else if (nonDefaultSets) {
		parts.push(`Bonuses (sets ${[...config.bonusSets].sort().join(', ')})`)
	}
	if (config.devCards !== DEFAULT_CONFIG.devCards) {
		parts.push(config.devCards ? 'Dev cards enabled' : 'Dev cards disabled')
	}
	return parts.join('. ')
}

export function sameStringSet(
	a: readonly string[],
	b: readonly string[]
): boolean {
	if (a.length !== b.length) return false
	const as = new Set(a)
	for (const x of b) if (!as.has(x)) return false
	return true
}

export type HexData =
	| { resource: null }
	| { resource: Resource; number: HexNumber }

export type VertexState =
	| { occupied: false }
	| { occupied: true; player: number; building: VertexBuilding }

export type EdgeState = { occupied: false } | { occupied: true; player: number }

export type ResourceHand = Record<Resource, number>

export type DevCardEntry = {
	id: DevCardId
	// Value of `state.round` at time of purchase. Playable once `state.round`
	// has advanced past this value — enforces "can't play on turn bought".
	purchasedTurn: number
}

export type PlayerState = {
	resources: ResourceHand
	// Kept bonus + dealt curse. Populated when the select_bonus phase ends;
	// absent on standard (non-bonuses) games.
	bonus?: BonusId
	curse?: CurseId
	// Dev-card hand (unplayed cards + VP). VP cards never leave the hand.
	devCards: DevCardEntry[]
	// Count per id, for Largest Army + stats. Incremented on play.
	devCardsPlayed: Partial<Record<DevCardId, number>>
	// Reset on end_turn for the outgoing active player.
	playedDevThisTurn: boolean
	// Sum of resource cards spent this turn on a traditional build (road,
	// settlement, city, dev-card buy). Used by the `age` curse (cap 6). Reset
	// to 0 on end_turn for the outgoing active player. Sparse — only written
	// for players actually affected.
	cardsSpentThisTurn?: number
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
// resource-scoped '2:1-*' variants require the matching specific port; '5:1'
// is the only option available to players under the `provinciality` curse.
export type BankKind =
	| '5:1'
	| '4:1'
	| '3:1'
	| '2:1-brick'
	| '2:1-wood'
	| '2:1-sheep'
	| '2:1-wheat'
	| '2:1-ore'

// Phase to return to after a sub-phase (discard → move_robber → steal,
// road_building) completes. A knight played during `roll` (pre-roll) resumes
// to `roll`; anything triggered from main (or the 7-roll chain) resumes to
// `main` with its trade snapshot.
export type ResumePhase =
	| { kind: 'roll' }
	| { kind: 'main'; roll: DiceRoll; trade: TradeOffer | null }

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
			resume: ResumePhase
			// Amount each player still owes. Entries are removed as players submit.
			pending: Partial<Record<number, number>>
	  }
	| { kind: 'move_robber'; resume: ResumePhase }
	| {
			kind: 'steal'
			resume: ResumePhase
			hex: Hex
			candidates: number[]
	  }
	// Fires when a player pops `Play` on a Road Building card. Active player
	// places free roads one at a time; on completion we transition to
	// `resume`.
	| { kind: 'road_building'; resume: ResumePhase; remaining: 1 | 2 }
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
	config: GameConfig
	// Top = index 0. Edge function splices from the front on buy. `[]` when
	// config.devCards is off.
	devDeck: DevCardId[]
	// Player index holding Largest Army, or null. Recomputed after every
	// knight play; ties keep the existing holder.
	largestArmy: number | null
	// Player index holding Longest Road (≥ 5-edge trail, strict majority), or
	// null. Recomputed after every road build, Road Building card finalization,
	// and settlement build (an opponent's settlement can split a road). Ties
	// keep the existing holder; falling below threshold releases the bonus.
	longestRoad: number | null
	// Monotonic turn counter. Increments on each `end_turn`. Used to enforce
	// "can't play dev card on turn bought" (stamped on DevCardEntry.purchasedTurn).
	round: number
}

export const EMPTY_VERTEX: VertexState = { occupied: false }
export const EMPTY_EDGE: EdgeState = { occupied: false }

export function vertexStateOf(state: GameState, vertex: Vertex): VertexState {
	return state.vertices[vertex] ?? EMPTY_VERTEX
}

export function edgeStateOf(state: GameState, edge: Edge): EdgeState {
	return state.edges[edge] ?? EMPTY_EDGE
}
