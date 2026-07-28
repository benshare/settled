// Shared types for the bonus / curse subsystem. Each player is dealt two
// bonus cards (draws with replacement from BONUS_POOL) and one curse card,
// then picks one bonus to keep.
//
// Card identity is the `id` string. UI reads `title` / `description` /
// `icon`; rule code will key off `id` when effects get wired in.
//
// A card's `description` here is its 3-4 player ('standard') text. Cards that
// read, behave, or deal differently at other table sizes declare that in
// `sizes.ts` — read descriptions through `bonusDescriptionFor(id, size)`
// rather than off the pool entry wherever a player count is known.

import type { Ionicons } from '@expo/vector-icons'
import type React from 'react'

export type IoniconName = React.ComponentProps<typeof Ionicons>['name']

export type BonusId =
	| 'specialist'
	| 'merchant'
	| 'gambler'
	| 'veteran'
	| 'scout'
	| 'plutocrat'
	| 'accountant'
	| 'hoarder'
	| 'explorer'
	| 'ritualist'
	| 'fencer'
	| 'underdog'
	| 'nomad'
	| 'populist'
	| 'fortune_teller'
	| 'shepherd'
	| 'smith'
	| 'carpenter'
	| 'metropolitan'
	| 'investor'
	| 'curio_collector'
	| 'thrill_seeker'
	| 'bricklayer'
	| 'aristocrat'
	| 'magician'
	| 'forger'
	| 'haunt'

export type CurseId =
	| 'age'
	| 'decadence'
	| 'ambition'
	| 'elitism'
	| 'asceticism'
	| 'nomadism'
	| 'avarice'
	| 'power'
	| 'compaction'
	| 'provinciality'
	| 'youth'

export type Bonus = {
	id: BonusId
	title: string
	description: string
	icon: IoniconName
	set: '1' | '2' | '3'
}

export type Curse = {
	id: CurseId
	title: string
	description: string
	icon: IoniconName
	set: 'base'
}

export { BONUS_POOL, bonusById } from './bonuses'
export { CURSE_POOL, curseById } from './curses'
export { BANNED_BONUSES_BY_CURSE, isBannedCombo } from './combos'
export {
	BONUS_SIZE_VARIANTS,
	CURSE_SIZE_VARIANTS,
	bonusVariantFor,
	curseVariantFor,
	bonusDescriptionFor,
	curseDescriptionFor,
	isBonusAvailableAt,
	isCurseAvailableAt,
	type BankAccess,
	type GamblerMode,
	type BonusSizeVariant,
	type CurseSizeVariant,
} from './sizes'
