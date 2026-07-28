// The one location for per-player-count deviations. A bonus or curse whose
// wording, numbers, or availability differs at 2 players (`small`) or 5-6
// players (`expanded`) gets an entry here; `BONUS_POOL` / `CURSE_POOL` stay
// the `standard` (3-4 player) baseline and the fallback for every size with
// no entry.
//
// Adding a variant to a card is two edits, and only two:
//
//   1. its entry in the table below — the per-size description, any numeric
//      params, and `available: false` if it shouldn't be dealt at that size;
//   2. a `switch (size)` (or a `bonusVariantFor(...)?.param` read) in that
//      card's rule helper in `../bonus.ts` / `../curses.ts`.
//
// Params are typed per card via BONUS_SIZE_PARAMS / CURSE_SIZE_PARAMS, so a
// param declared on the wrong card fails to compile rather than reading back
// as undefined at runtime.

import { type GameSize } from '../types'
import { bonusById } from './bonuses'
import { curseById } from './curses'
import type { BonusId, CurseId } from './index'

// What the provinciality curse leaves a player: 'surcharge' keeps ports but
// makes every ratio cost one more; 'flat_5' blocks ports and forces the 5:1
// bank; 'none' removes bank trading entirely (player trades only).
export type BankAccess = 'surcharge' | 'flat_5' | 'none'

// How the gambler's reroll works: 'reroll' throws the first result away for a
// second one (you keep whatever comes back); 'choose_two' rolls both up front
// and lets the player keep either.
export type GamblerMode = 'reroll' | 'choose_two'

// Per-card params. Declare a card's shape here when its rule helper needs to
// read a value rather than switch on the size directly — a param declared on
// the wrong card, or read off one, fails to compile.
type BonusSizeParams = {
	gambler: { mode: GamblerMode }
	// Flat cost per ritual. Absent (3-4 players) means the city-dependent
	// baseline: 2 cards before your first city, 3 after.
	ritualist: { cardCost: number }
	// Multiplier on what the fortune teller collects from each bonus roll.
	fortune_teller: { gainMultiplier: number }
	// VP the investor needs before the bonus does anything at all.
	investor: { activateVP: number }
	// `discardPlus` is added to the distance when pricing a cast (baseline 1,
	// i.e. N + 1); `cooldown` forbids casting on consecutive own turns.
	magician: { discardPlus: number; cooldown: boolean }
}
type CurseSizeParams = {
	age: { cardLimit: number }
	provinciality: { bankAccess: BankAccess }
}

// Every variant may override the description and withhold the card from the
// deal; params are flat alongside those, so a card's number and the sentence
// describing it sit on the same object and can't drift.
type SizeVariant<P> = {
	description?: string
	available?: boolean
} & Partial<P>

export type BonusSizeVariant<K extends BonusId> = SizeVariant<
	K extends keyof BonusSizeParams ? BonusSizeParams[K] : object
>

export type CurseSizeVariant<K extends CurseId> = SizeVariant<
	K extends keyof CurseSizeParams ? CurseSizeParams[K] : object
>

export const BONUS_SIZE_VARIANTS: {
	[K in BonusId]?: Partial<Record<GameSize, BonusSizeVariant<K>>>
} = {
	// A blind reroll is a gamble on the table average; at a 5-6 player table
	// the gambler instead sees both results and keeps the better one.
	gambler: {
		expanded: {
			description:
				'Any time you roll, roll twice and choose which of the two results counts.',
			mode: 'choose_two',
		},
	},
	// Your turn — and so the extra roll — comes around least often at a 5-6
	// player table, so the extra roll pays double there.
	fortune_teller: {
		expanded: {
			description:
				'Every time you roll doubles or 7, make an extra roll. Only you get resources from it, and you receive double from it.',
			gainMultiplier: 2,
		},
	},
	// Heads-up a cast every turn warps a two-player game, so it needs a turn
	// off between casts; at a 5-6 player table it gets a discount instead,
	// since the window comes around least often.
	magician: {
		small: {
			description:
				'After any roll, you may discard N + 1 cards to receive resources as if a number N away from the actual result had been rolled. You may not use this on two of your turns in a row.',
			cooldown: true,
		},
		expanded: {
			description:
				'After any roll, you may discard N cards to receive resources as if a number N away from the actual result had been rolled.',
			discardPlus: 0,
		},
	},
	// Heads-up there is no field to out-scale, so the card is withheld
	// entirely; at a 5-6 player table the slow start is the problem instead, so
	// it comes online from the first turn.
	investor: {
		small: { available: false },
		expanded: {
			description:
				'At any time during your turn you may set aside three of the same resource card to receive an "investment token" for that resource. Once your roll resolves, you receive one resource card from every investment token you have — so the payout never counts towards the seven-card limit on a 7. Active from the start of the game. Cards in investment cannot be stolen. Max 18 cards (6 trios) invested at once.',
			activateVP: 0,
		},
	},
	// The cost stops tracking cities and goes flat: pricier heads-up, cheaper
	// at a 5-6 player table where your turn comes around least often.
	ritualist: {
		small: {
			description:
				'Start of turn: you may choose to discard three resource cards of your choice to choose your die roll. No other players receive resources from your roll if you do.',
			cardCost: 3,
		},
		expanded: {
			description:
				'Start of turn: you may choose to discard two resource cards of your choice to choose your die roll. No other players receive resources from your roll if you do.',
			cardCost: 2,
		},
	},
}

export const CURSE_SIZE_VARIANTS: {
	[K in CurseId]?: Partial<Record<GameSize, CurseSizeVariant<K>>>
} = {
	// The cap is per turn, so its bite scales with how often your turn comes
	// around: tighter heads-up (where you act twice as often), looser at a
	// 5-6 player table (where you act least).
	age: {
		small: {
			description:
				"You can spend a maximum of five cards per turn. This doesn't include cards used for ports or trading.",
			cardLimit: 5,
		},
		expanded: {
			description:
				"You can spend a maximum of seven cards per turn. This doesn't include cards used for ports or trading.",
			cardLimit: 7,
		},
	},
	// Losing the bank costs you more the fewer people there are to trade with,
	// so heads-up it's only a surcharge, while at a 5-6 player table — where
	// there are plenty of trading partners — the bank closes entirely.
	provinciality: {
		small: {
			description:
				'Every port and bank trade costs one more of the input resource: 2:1 ports become 3:1, 3:1 ports become 4:1, and the default bank rate becomes 5:1.',
			bankAccess: 'surcharge',
		},
		expanded: {
			description:
				'You may not use the ports on the board, and you may not trade with the bank at any rate. You can still trade with other players.',
			bankAccess: 'none',
		},
	},
}

// Generic in the card id so a param read is checked against that card's own
// shape. Rule helpers call this for their numbers; UI calls the description /
// availability helpers below.
export function bonusVariantFor<K extends BonusId>(
	id: K,
	size: GameSize
): BonusSizeVariant<K> | undefined {
	return BONUS_SIZE_VARIANTS[id]?.[size]
}

export function curseVariantFor<K extends CurseId>(
	id: K,
	size: GameSize
): CurseSizeVariant<K> | undefined {
	return CURSE_SIZE_VARIANTS[id]?.[size]
}

export function bonusDescriptionFor(id: BonusId, size: GameSize): string {
	return (
		bonusVariantFor(id, size)?.description ??
		bonusById(id)?.description ??
		''
	)
}

export function curseDescriptionFor(id: CurseId, size: GameSize): string {
	return (
		curseVariantFor(id, size)?.description ??
		curseById(id)?.description ??
		''
	)
}

// Availability gates the DEAL only (see dealBonusHands). A card someone
// already holds still resolves a description at every size, so a game in
// flight can never render a blank card.
export function isBonusAvailableAt(id: BonusId, size: GameSize): boolean {
	return bonusVariantFor(id, size)?.available !== false
}

export function isCurseAvailableAt(id: CurseId, size: GameSize): boolean {
	return curseVariantFor(id, size)?.available !== false
}
