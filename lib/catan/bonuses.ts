// Bonus / curse card data. Today's pool is deliberately tiny — a single
// placeholder bonus and a single placeholder curse — so selection plumbing
// can ship before individual effects land. Each player is dealt two bonus
// cards (draws with replacement from BONUS_POOL) and one curse card, then
// picks one bonus to keep.
//
// Card identity is the `id` string. UI reads `title` / `description` /
// `icon`; rule code will key off `id` when effects get wired in.

import type { Ionicons } from '@expo/vector-icons'
import type React from 'react'

type IoniconName = React.ComponentProps<typeof Ionicons>['name']

export type BonusId = 'placeholder'
export type CurseId = 'placeholder'

export type Bonus = {
	id: BonusId
	title: string
	description: string
	icon: IoniconName
}

export type Curse = {
	id: CurseId
	title: string
	description: string
	icon: IoniconName
}

export const BONUS_POOL: readonly Bonus[] = [
	{
		id: 'placeholder',
		title: 'Lucky Charm',
		description:
			'A stand-in bonus card. Keeping this does nothing yet — real effects arrive in a later pass.',
		icon: 'sparkles',
	},
]

export const CURSE_POOL: readonly Curse[] = [
	{
		id: 'placeholder',
		title: 'Ill Omen',
		description:
			'A stand-in curse card. You keep it for the rest of the game, but it has no effect yet.',
		icon: 'skull',
	},
]

export function bonusById(id: string): Bonus | undefined {
	return BONUS_POOL.find((b) => b.id === id)
}

export function curseById(id: string): Curse | undefined {
	return CURSE_POOL.find((c) => c.id === id)
}
