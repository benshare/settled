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

// Per-card numeric (or otherwise structured) params. Declare a card's shape
// here when its rule helper needs to read a value rather than switch on the
// size directly. Empty until the first card is retuned — e.g.
//
//   type BonusSizeParams = { thrill_seeker: { vpDelta: number } }
//
// which makes `bonusVariantFor('thrill_seeker', size)?.vpDelta` a typed read
// and the same read on any other bonus a compile error.
type BonusSizeParams = Record<never, never>
type CurseSizeParams = Record<never, never>

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
} = {}

export const CURSE_SIZE_VARIANTS: {
	[K in CurseId]?: Partial<Record<GameSize, CurseSizeVariant<K>>>
} = {}

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
