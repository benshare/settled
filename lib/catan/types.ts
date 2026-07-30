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
import { isTimeoutOption, timeoutLabel, type TimeoutOption } from './timeout'

// `placedTurn` is the value of `GameState.round` at the moment a piece was
// placed. Initial-placement pieces are stamped with 0; main-phase builds are
// stamped with the current round. Used by the accountant bonus to gate
// liquidation ("not the same turn the piece was bought").

// 'standard' = 19-hex board (2-4 players); 'expanded' = 30-hex 5-6 player
// extension board. Chosen automatically from player count, not user config.
export type Variant = 'standard' | 'expanded'

// The expanded board is used for 5-6 player games; 2-4 players use standard.
export function variantForPlayerCount(playerCount: number): Variant {
	return playerCount >= 5 ? 'expanded' : 'standard'
}

// How big the table is, for bonus / curse tuning. Deliberately separate from
// `Variant`: a card may want to read or behave differently at 2 players, where
// the board does not change. Derived from player count, never persisted — see
// `bonuses/sizes.ts` for the per-card overrides keyed by this.
export const GAME_SIZES = ['small', 'standard', 'expanded'] as const
export type GameSize = (typeof GAME_SIZES)[number]

// 'standard' (3-4) is the baseline every card's pool description is written
// against; 'small' is heads-up, 'expanded' is the 5-6 player table.
export function gameSizeFor(playerCount: number): GameSize {
	if (playerCount <= 2) return 'small'
	return playerCount >= 5 ? 'expanded' : 'standard'
}

// Max players supported (expanded board tops out at 6).
export const MAX_PLAYERS = 6

// How number tokens are placed on the board. 'spiral' lays the fixed high/low
// token sequence along a spiral path (like classic Catan, so 6s/8s spread out);
// 'random' shuffles the token bag onto the hexes with no spacing guarantees.
// Resource/desert placement is always random regardless.
export const NUMBER_LAYOUTS = ['spiral', 'random'] as const
export type NumberLayout = (typeof NUMBER_LAYOUTS)[number]

// Special build phase for 5-6 player games (standard Catan expansion rule):
// between one player's turn and the next, other players get a chance to
// build/buy (no rolling, no trading). Configured by `GameConfig.extraBuild`.
// Only meaningful for games with >4 players — ignored on 2-4 player games.
//
// `buildPhases` = when the phase fires: 'every' turn (the expansion default),
// or only 'across' — after the turn of the player seated across from you
// (fewer, faster phases).
export const BUILD_PHASE_FREQUENCIES = ['every', 'across'] as const
export type BuildPhaseFrequency = (typeof BUILD_PHASE_FREQUENCIES)[number]

// How player-to-player trade offers resolve. 'automatic' (today's behaviour,
// the backfill default): an addressee's Accept executes the swap immediately.
// 'confirm': Accept only registers an acceptance; the proposer then confirms
// one of the acceptances to execute the swap.
export const TRADE_MODES = ['automatic', 'confirm'] as const
export type TradeMode = (typeof TRADE_MODES)[number]

// `enabled` is the top-level on/off. When enabled, `buildPhases` sets the
// cadence and `moreThanSeven` gates who may build: false = anyone in the phase
// may build; true = only players holding more than 7 cards (the discard
// threshold) — a "spend down before a 7" house rule.
export type ExtraBuildConfig = {
	enabled: boolean
	buildPhases: BuildPhaseFrequency
	moreThanSeven: boolean
}

// Bounds on `GameConfig.bonusCount` / `curseCount`.
export const MIN_CARD_COUNT = 1
export const MAX_CARD_COUNT = 3

// Config arrives as unvalidated JSON on both the client and the edge function,
// so every read of a card count goes through this.
export function clampCardCount(raw: unknown, fallback: number): number {
	if (typeof raw !== 'number' || !Number.isInteger(raw)) return fallback
	return Math.max(MIN_CARD_COUNT, Math.min(MAX_CARD_COUNT, raw))
}

// Top-level game config. Serialized to JSONB on game_requests and
// game_states. New options get added here (and wired through the
// propose_game RPC + handleRespond in the edge function).
export type GameConfig = {
	bonuses: boolean
	// Which bonus sets are in the draw pool when `bonuses` is on. Only '1' is
	// live today; '2' and '3' are defined in the data but disabled in the UI.
	bonusSets: string[]
	// When true (the default), a player is never offered a bonus their curse
	// bans — see BANNED_BONUSES_BY_CURSE in lib/catan/bonuses/combos.ts. Only
	// meaningful while `bonuses` is on.
	bannedCombos: boolean
	// How many bonus / curse cards each player is dealt to choose between in
	// the select_bonus phase, 1..3. A count of 1 is no choice at all — that
	// card is simply assigned. When both are 1 the phase is skipped entirely
	// (see handleRespond in the edge function).
	bonusCount: number
	curseCount: number
	devCards: boolean
	numberLayout: NumberLayout
	// Whether the Honk nudge (ping a stalled player after the idle threshold)
	// is available in this game. See lib/catan/honk.ts.
	honk: boolean
	// When true, a roll of 7 during the first full go-around (every player's
	// opening turn, `round < playerCount`) does not activate the robber — no
	// discards, no move, no steal. The 7 is still rolled and nomads still
	// collect their desert d5; only the robber is held back.
	friendlyRobber: boolean
	// When true, Monopoly takes at most `monopolyCap(playerCount)` of the named
	// resource from any single opponent (the aggregate haul is uncapped).
	limitMonopoly: boolean
	// How player-to-player trades resolve. See TradeMode.
	tradeMode: TradeMode
	// Whether friends of any player may watch this game. The spectator RLS
	// policies read this field straight off `games.config`, so it is the
	// authority for access — see .claude/specs/spectating.md.
	spectators: boolean
	// See ExtraBuildConfig. Only affects games with >4 players; ignored
	// otherwise.
	extraBuild: ExtraBuildConfig
	// How long the game may sit idle before whoever is holding it up is skipped
	// (at 2 players, loses). `null` — the default — is no clock at all. See
	// lib/catan/timeout.ts.
	timeout: TimeoutOption | null
}

// System-shipped defaults for a standard game. Used as the reference when
// summarizing a game's options (e.g. "bonuses enabled" means this game
// differs from the global default). Mirrors the server-side default on
// `profiles.game_defaults`, kept in a flat GameConfig shape for consumers.
export const DEFAULT_CONFIG: GameConfig = {
	bonuses: false,
	bonusSets: ['1'],
	bannedCombos: true,
	bonusCount: 2,
	curseCount: 1,
	devCards: true,
	numberLayout: 'spiral',
	honk: true,
	friendlyRobber: false,
	limitMonopoly: false,
	tradeMode: 'automatic',
	spectators: true,
	extraBuild: { enabled: true, buildPhases: 'every', moreThanSeven: false },
	timeout: null,
}

// Whether a game needs the simultaneous `select_bonus` phase at all. With one
// card of each kind nobody has a decision to make, so the cards are assigned at
// creation and the game opens on initial placement instead.
export function needsBonusSelection(config: GameConfig): boolean {
	if (!config.bonuses) return false
	return config.bonusCount > 1 || config.curseCount > 1
}

// Defensive JSON reader. `raw` comes off `game_requests.config` /
// `games.config` as `Json`; any missing fields fall back to the
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
		bannedCombos:
			typeof src.bannedCombos === 'boolean'
				? src.bannedCombos
				: DEFAULT_CONFIG.bannedCombos,
		bonusCount: clampCardCount(src.bonusCount, DEFAULT_CONFIG.bonusCount),
		curseCount: clampCardCount(src.curseCount, DEFAULT_CONFIG.curseCount),
		devCards:
			typeof src.devCards === 'boolean'
				? src.devCards
				: DEFAULT_CONFIG.devCards,
		honk: typeof src.honk === 'boolean' ? src.honk : DEFAULT_CONFIG.honk,
		friendlyRobber:
			typeof src.friendlyRobber === 'boolean'
				? src.friendlyRobber
				: DEFAULT_CONFIG.friendlyRobber,
		limitMonopoly:
			typeof src.limitMonopoly === 'boolean'
				? src.limitMonopoly
				: DEFAULT_CONFIG.limitMonopoly,
		tradeMode:
			src.tradeMode === 'confirm' || src.tradeMode === 'automatic'
				? src.tradeMode
				: DEFAULT_CONFIG.tradeMode,
		// Every stored row carries the key — the migration that moved config
		// onto `games` pinned any that didn't to false, and the policies read
		// it as a plain boolean. This default is for configs built in memory
		// (a new game's form state), where watchable is the product default.
		spectators:
			typeof src.spectators === 'boolean'
				? src.spectators
				: DEFAULT_CONFIG.spectators,
		numberLayout:
			src.numberLayout === 'spiral' || src.numberLayout === 'random'
				? src.numberLayout
				: DEFAULT_CONFIG.numberLayout,
		extraBuild: parseExtraBuild(src.extraBuild, DEFAULT_CONFIG.extraBuild),
		// Anything unrecognized — including the missing key every game created
		// before timeouts shipped carries — parses to no clock, so an in-flight
		// game can never acquire one.
		timeout: isTimeoutOption(src.timeout) ? src.timeout : null,
	}
}

// Defensive reader for the nested extraBuild block. Missing/invalid fields fall
// back to `fallback` (the caller's default), so a partial row still parses.
export function parseExtraBuild(
	raw: unknown,
	fallback: ExtraBuildConfig
): ExtraBuildConfig {
	if (!raw || typeof raw !== 'object') return fallback
	const src = raw as Record<string, unknown>
	return {
		enabled:
			typeof src.enabled === 'boolean' ? src.enabled : fallback.enabled,
		buildPhases: BUILD_PHASE_FREQUENCIES.includes(
			src.buildPhases as BuildPhaseFrequency
		)
			? (src.buildPhases as BuildPhaseFrequency)
			: fallback.buildPhases,
		moreThanSeven:
			typeof src.moreThanSeven === 'boolean'
				? src.moreThanSeven
				: fallback.moreThanSeven,
	}
}

// Per-opponent ceiling on a Monopoly haul when `config.limitMonopoly` is on.
// Tighter at a bigger table, where more opponents already mean a bigger total.
export function monopolyCap(playerCount: number): number {
	return playerCount > 4 ? 2 : 3
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
	if (config.bonuses && !config.bannedCombos) {
		parts.push('Curse pairings unrestricted')
	}
	if (config.bonuses && config.bonusCount !== DEFAULT_CONFIG.bonusCount) {
		parts.push(
			config.bonusCount === 1
				? 'One bonus card'
				: `${config.bonusCount} bonus cards`
		)
	}
	if (config.bonuses && config.curseCount !== DEFAULT_CONFIG.curseCount) {
		parts.push(`${config.curseCount} curse cards`)
	}
	if (config.devCards !== DEFAULT_CONFIG.devCards) {
		parts.push(config.devCards ? 'Dev cards enabled' : 'Dev cards disabled')
	}
	if (config.numberLayout !== DEFAULT_CONFIG.numberLayout) {
		parts.push(
			config.numberLayout === 'random'
				? 'Random numbers'
				: 'Spiral numbers'
		)
	}
	if (config.honk !== DEFAULT_CONFIG.honk) {
		parts.push(config.honk ? 'Honking enabled' : 'Honking disabled')
	}
	if (config.friendlyRobber !== DEFAULT_CONFIG.friendlyRobber) {
		parts.push(
			config.friendlyRobber ? 'Friendly robber' : 'Standard robber'
		)
	}
	if (config.limitMonopoly !== DEFAULT_CONFIG.limitMonopoly) {
		parts.push(
			config.limitMonopoly
				? `Monopoly capped (${monopolyCap(playerCount)} per player)`
				: 'Uncapped monopoly'
		)
	}
	if (config.tradeMode !== DEFAULT_CONFIG.tradeMode) {
		parts.push('Confirm trades')
	}
	if (config.spectators !== DEFAULT_CONFIG.spectators) {
		parts.push('Spectators disabled')
	}
	if (config.timeout !== null) {
		parts.push(`${timeoutLabel(config.timeout)} move timeout`)
	}
	// Extra build phases only apply to >4 player games, so only surface a
	// non-default value there.
	if (playerCount > 4) {
		const eb = config.extraBuild
		const def = DEFAULT_CONFIG.extraBuild
		if (!eb.enabled && def.enabled) {
			parts.push('Extra build phases off')
		} else if (eb.enabled) {
			const quals: string[] = []
			if (
				eb.buildPhases !== def.buildPhases &&
				eb.buildPhases === 'across'
			)
				quals.push('across')
			if (eb.moreThanSeven) quals.push('over 7 cards')
			if (quals.length) parts.push(`Extra build (${quals.join(', ')})`)
		}
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
	{ resource: null } | { resource: Resource; number: HexNumber }

export type VertexState =
	| { occupied: false }
	| {
			occupied: true
			player: number
			building: VertexBuilding
			placedTurn: number
	  }

export type EdgeState =
	{ occupied: false } | { occupied: true; player: number; placedTurn: number }

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
	// --- Bonus-specific fields (sparse; only set when the owning bonus is
	// present on this player).
	//
	// `specialist`: the resource the player declared during post_placement.
	// Port bank trades with this resource on the give side get a −1 ratio
	// (floor of 2:1).
	specialistResource?: Resource
	// `gambler`: set to true once the player has used their one per-turn
	// reroll. Reset on end_turn.
	rerolledThisTurn?: boolean
	// Round in which the magician last cast. Only used where the bonus has a
	// cooldown (2 players): a player's turns are exactly `playerCount` rounds
	// apart, so their next turn is blocked and the one after is not.
	lastMagicRound?: number
	// `carpenter`: set to true when the player has already bought a Wood→VP
	// this turn. Reset on end_turn. Paired counter `carpenterVP` cumulative.
	boughtCarpenterVPThisTurn?: boolean
	carpenterVP?: number
	// `veteran`: number of played knights this player has already "tapped"
	// for the +2 resource effect. The knight stays counted in
	// devCardsPlayed.knight for Largest Army purposes.
	tappedKnights?: number
	// `ritualist`: set to true once the player has used their per-turn
	// `ritual_roll` choose-your-roll action. Reset on end_turn.
	ritualWasUsedThisTurn?: boolean
	// `shepherd`: set to true once the player has used their per-turn
	// shepherd swap (4-sheep start-of-turn). Reset on end_turn.
	shepherdUsedThisTurn?: boolean
	// `forger`: hex where the forger token currently sits. Seeded to the
	// robber's starting hex (the desert) when bonuses lock in, and moved by
	// the forger alone — nothing else on the board relocates it. Undefined
	// only in games dealt before the seeding existed, where readers fall
	// back to the robber's hex (`forgerTokenHex`).
	forgerToken?: Hex
	// `forger`: set to true once the player has moved the token this turn.
	// The move is compulsory — a forger cannot roll until it is true. Reset
	// on end_turn.
	forgerMovedThisTurn?: boolean
	// `investor`: set-aside investment tokens keyed by resource. Each token
	// cost 3 of that resource and pays 1 back at the start of the player's
	// turn. Capped at 6 tokens total (18 cards). Set-aside cards live here,
	// NOT in `resources`, so they're immune to steal and don't count toward
	// the 7-discard hand limit. Sparse — only written for investor players.
	investments?: Partial<Record<Resource, number>>
	// Admin testing flag, set by hand in the `game_states.players` row — never
	// written by the app. A dev player may name their own dice total on the
	// roll bar (see `DevRollPicker`); the edge function's `handleRoll` honours
	// a `total` override only for a seat carrying this.
	dev?: boolean
	// `haunt`: two vertices the player secretly picked at post_placement.
	// Soft-hidden — stored in shared state but never rendered for other
	// players (same model as opponents' hidden VP dev cards). Entries are
	// consumed as they resolve (a ghost spawns, or the spot is built on).
	hauntSpots?: Vertex[]
}

// Per-player card hand during the select_bonus phase. `offered` and `curses`
// are the cards dealt to the player — `config.bonusCount` / `config.curseCount`
// of each, distinct within a hand. `chosen` and `chosenCurse` flip from null on
// commit, always together. A single-card kind is decided at deal time, so its
// `chosen*` may stay null (read through the helpers below).
export type SelectBonusHand = {
	offered: BonusId[]
	curses: CurseId[]
	chosen: BonusId | null
	chosenCurse: CurseId | null
	// Hands dealt before curse counts existed carried one `curse` and no
	// `curses` / `chosenCurse`. Never read directly — use `handCurses` /
	// `handChosenCurse`, which cover both shapes.
	curse?: CurseId
}

export function handCurses(hand: SelectBonusHand): CurseId[] {
	if (hand.curses?.length) return hand.curses
	return hand.curse ? [hand.curse] : []
}

// The curse this hand ends up carrying, or null while it's still an open
// choice. A one-card deal needs no pick, so it resolves immediately.
export function handChosenCurse(hand: SelectBonusHand): CurseId | null {
	if (hand.chosenCurse) return hand.chosenCurse
	const curses = handCurses(hand)
	return curses.length === 1 ? curses[0] : null
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
	// Indexes of addressed players who have rejected. Never contains `from`.
	// Older offers written before reject existed may omit this; readers should
	// default a missing array to `[]`.
	rejectedBy?: number[]
	// Indexes of addressed players who have accepted and are awaiting the
	// proposer's confirmation (confirm mode only — unused in automatic mode,
	// where Accept executes immediately). Never contains `from`; a player is in
	// at most one of acceptedBy / rejectedBy. Readers default a missing array
	// to `[]`.
	acceptedBy?: number[]
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
	// `pick_last` is only ever reached with round 2 by the one seat that places
	// both settlements back-to-back (see placement.ts `isDoublePlacementSeat`):
	// they nominate which settlement they placed last, and that one pays the
	// starting resources. Skipped for an aristocrat, who collects on both.
	| {
			kind: 'initial_placement'
			round: 1 | 2
			step: 'settlement' | 'road' | 'pick_last'
	  }
	// Start-of-game bonus resolutions (specialist declaration, explorer free
	// roads, etc). Inserted between the final initial_placement road and
	// the first roll when any player has a bonus that requires an up-front
	// decision. `pending.specialist` lists indices owing a specialist
	// declaration; `pending.explorer` maps explorer player indices to the
	// number of free roads they still owe (3 → 0). Picks are parallel —
	// not turn-serialized. Phase advances to `roll` when every entry is
	// drained. Skipped entirely when no such bonus is in play.
	| {
			kind: 'post_placement'
			pending: {
				specialist: number[]
				explorer?: Partial<Record<number, number>>
				// `fencer` maps fencer player indices to the number of edge
				// tokens they still owe (2 → 0). `haunt` lists haunt player
				// indices owing their two-spot pick. Both drain in parallel
				// with specialist/explorer.
				fencer?: Partial<Record<number, number>>
				haunt?: number[]
			}
	  }
	// `roll` is the default pre-roll state. For gambler players, after the
	// initial roll the dice sit in `pending` while the player decides
	// between `confirm_roll` (apply distribution / 7-chain) and
	// `reroll_dice` (once per turn). Non-gambler players skip this
	// intermediate: their `roll` action distributes / enters 7-chain
	// atomically.
	// `altDice` is the gambler's second option at a 5-6 player table (see
	// `gamblerModeFor`): both rolls are thrown up front and `confirm_roll`
	// names which one counts. Absent everywhere else, where the gambler
	// instead rerolls the single pending pair.
	| { kind: 'roll'; pending?: { dice: DiceRoll; altDice?: DiceRoll } }
	| {
			kind: 'discard'
			resume: ResumePhase
			// Amount each player still owes. Entries are removed as players submit.
			pending: Partial<Record<number, number>>
			// True iff the chain was triggered by a 7-roll (vs a knight).
			// Used to trigger fortune_teller bonus rolls on resume.
			from7?: boolean
	  }
	| { kind: 'move_robber'; resume: ResumePhase; from7?: boolean }
	| {
			kind: 'steal'
			resume: ResumePhase
			hex: Hex
			candidates: number[]
			from7?: boolean
	  }
	// Fires when a player pops `Play` on a Road Building card. Active player
	// places free roads one at a time; on completion we transition to
	// `resume`.
	| { kind: 'road_building'; resume: ResumePhase; remaining: 1 | 2 }
	// `trade` piggy-backs on the main phase so we don't need a separate
	// top-level field (and a DB column). It's always cleared when leaving main.
	| { kind: 'main'; roll: DiceRoll; trade: TradeOffer | null }
	// Scout dev-card peek. After the buy commits, the buyer sees the top
	// up-to-2 cards and picks one. The other returns to the bottom of
	// the deck in their drawn order. `cards` is the drawn slice (top-most
	// first); `owner` is the buying player. `resume` also accepts a
	// `special_build` snapshot, since a scout may buy in their special-build
	// slot and must land back on the queue they came from.
	| {
			kind: 'scout_pick'
			resume: ResumePhase | { kind: 'special_build'; queue: number[] }
			owner: number
			cards: DevCardId[]
	  }
	// Curio collector trigger after a 2 or 12 original roll. Each
	// curio_collector who gained ≥1 card from the roll is queued here and
	// must claim their +3 resources via `claim_curio`. Picks are parallel
	// (each pending entry resolves independently). Phase advances to
	// `resume` when `pending` is empty.
	//
	// `resume` accepts any Phase (recursive) so a roll that triggers both
	// curio AND forger can chain: forger_pick(resume = curio_pick(resume =
	// main)).
	| {
			kind: 'curio_pick'
			resume: Phase
			pending: number[]
	  }
	// Forger token-hex production. Each forger whose token's hex rolled AND
	// for whom two or more other players would gain from that hex is queued
	// here — a single eligible player is copied automatically, no prompt.
	// "Would gain" is robber-blind (`gainsFromHex`): the forger copies even
	// when the robber stops the hex paying out.
	// Each entry resolves serially (head of queue acts first). The acting
	// forger picks one candidate, gains a copy of that candidate's hex
	// gain, queue pops, and `resume` fires once empty.
	| {
			kind: 'forger_pick'
			resume: Phase
			queue: ForgerPickEntry[]
	  }
	// Magician post-roll window. Opens after the roller's own roll fully
	// resolves (distribution + any 7-chain) when the roller is a magician.
	// Fires before any curio/forger reactions (the magician is the active
	// player and its phantom production doesn't affect their inputs). The
	// magician either `cast_magic` (discard N+1 to also produce as if a
	// number N away from `roll` was rolled) or `skip_magic`, then `resume`.
	| {
			kind: 'magician_pick'
			resume: Phase
			roller: number
			roll: DiceRoll
	  }
	// Special build phase (5-6 player games, `config.extraBuild`). Sits between
	// a player's `end_turn` and the next player's `roll`. `queue[0]` is the
	// acting builder (may build/buy/bank-trade only — no roll/robber/trade/dev
	// play); the rest are pending, in acting order. `end_special_build` pops the
	// head; when the queue empties the phase advances to `roll` for the
	// already-advanced `current_turn`. See lib/catan/CLAUDE.md.
	| { kind: 'special_build'; queue: number[] }
	| { kind: 'game_over' }

export type ForgerPickEntry = {
	idx: number
	hex: Hex
	// `gainsByCandidate` maps candidate player index → resources THAT
	// candidate received (or would have, had the robber not been sitting
	// there) from `hex` on the original roll. The forger picks one
	// candidate and copies that hand into their own.
	gainsByCandidate: Record<number, ResourceHand>
}

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
	// `fencer` bonus: edges reserved by a fence token, keyed by edge → owning
	// player index. No other player may build a road on a reserved edge; the
	// owner builds there for 1 card (Wood or Brick). The token is deleted when
	// the owner finally builds the road. Sparse — absent when no fencer plays.
	fenceTokens?: Partial<Record<Edge, number>>
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
	// The one-step undo snapshot, or null when the last action wasn't undoable.
	// Read-only to the client — it exists so the back arrow's availability comes
	// off the same row everything else does. See `UndoSnapshot`.
	undo?: UndoSnapshot | null
}

// Actions a player may take back. The rule: solo and information-free. Rolling,
// buying or playing a dev card, and anything involving another player are all
// excluded — taking them reveals something, so unwinding them would leak it.
// Mirrored in the edge function, which is the authority. See
// `.claude/specs/undo.md`.
export const UNDOABLE_ACTIONS = [
	'build_road',
	'build_settlement',
	'build_city',
	'build_super_city',
	'bank_trade',
	'liquidate',
	'invest',
	'buy_carpenter_vp',
	'tap_knight',
	'place_fence_token',
	'place_explorer_road',
] as const

export type UndoableAction = (typeof UNDOABLE_ACTIONS)[number]

// A snapshot of the `game_states` row as it was immediately before an undoable
// action, written by the game-service dispatcher. Undo restores the row rather
// than computing an inverse: a single road build can move Longest Road, consume
// a fence token, and apply a smith/bricklayer cost substitution, and an inverse
// would have to keep up with every bonus we add.
export type UndoSnapshot = {
	action: UndoableAction
	// Seat that acted. Only they may undo — `post_placement` is a parallel
	// phase, so the one snapshot slot can belong to any seat.
	player: number
	at: string
	// `games.events` length BEFORE the action. Undo truncates back to it, which
	// is what makes the undone action vanish from the log.
	eventsLen: number
	// The mutable `game_states` columns, under their column names. `hexes` and
	// `variant` are omitted (nothing mutates them); `games.current_turn` is
	// omitted because no undoable action writes it.
	state: Record<string, unknown>
}

export const EMPTY_VERTEX: VertexState = { occupied: false }
export const EMPTY_EDGE: EdgeState = { occupied: false }

export function vertexStateOf(state: GameState, vertex: Vertex): VertexState {
	return state.vertices[vertex] ?? EMPTY_VERTEX
}

export function edgeStateOf(state: GameState, edge: Edge): EdgeState {
	return state.edges[edge] ?? EMPTY_EDGE
}
