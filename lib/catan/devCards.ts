// Dev-card data. Cards are drawn from a finite 25-card deck (classic Catan
// composition): 14 knight, 5 victory_point, 2 each of road_building,
// year_of_plenty, monopoly. Deck is shuffled once at game creation and
// stored on `GameState.devDeck`. Card identity is the `id` string; rule
// code keys off `id` while UI reads `title` / `description` / `icon`.

import type { Ionicons } from '@expo/vector-icons'
import type React from 'react'

type IoniconName = React.ComponentProps<typeof Ionicons>['name']

export type DevCardId =
	| 'knight'
	| 'victory_point'
	| 'road_building'
	| 'year_of_plenty'
	| 'monopoly'

export type DevCard = {
	id: DevCardId
	title: string
	description: string
	icon: IoniconName
}

export const DEV_CARD_POOL: readonly DevCard[] = [
	{
		id: 'knight',
		title: 'Knight',
		description:
			'Move the robber and steal 1 card from an adjacent opponent.',
		icon: 'shield',
	},
	{
		id: 'victory_point',
		title: 'Victory Point',
		description:
			'Worth 1 victory point. Stays hidden in your hand until the game ends.',
		icon: 'trophy',
	},
	{
		id: 'road_building',
		title: 'Road Building',
		description: 'Place 2 free roads.',
		icon: 'git-branch',
	},
	{
		id: 'year_of_plenty',
		title: 'Year of Plenty',
		description:
			'Take any 2 resource cards from the bank (duplicates allowed).',
		icon: 'cafe',
	},
	{
		id: 'monopoly',
		title: 'Monopoly',
		description:
			'Name a resource. Every opponent gives you all of their cards of that type.',
		icon: 'flash',
	},
]

export const DEV_DECK_COMPOSITION: Record<DevCardId, number> = {
	knight: 14,
	victory_point: 5,
	road_building: 2,
	year_of_plenty: 2,
	monopoly: 2,
}

export function devCardById(id: string): DevCard | undefined {
	return DEV_CARD_POOL.find((c) => c.id === id)
}
