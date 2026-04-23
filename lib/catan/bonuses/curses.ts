import type { Curse } from './index'

export const CURSE_POOL: readonly Curse[] = [
	{
		id: 'age',
		title: 'Curse of Age',
		description:
			"You can spend a maximum of six cards per turn. This doesn't include cards used for ports or trading.",
		icon: 'hourglass-outline',
		set: 'base',
	},
	{
		id: 'decadence',
		title: 'Curse of Decadence',
		description: 'You may build a maximum of two cities.',
		icon: 'wine-outline',
		set: 'base',
	},
	{
		id: 'ambition',
		title: 'Curse of Ambition',
		description: 'You need eleven points to win.',
		icon: 'flag-outline',
		set: 'base',
	},
	{
		id: 'elitism',
		title: 'Curse of Elitism',
		description:
			"You cannot have more than three/two settlements on the board at a time. Limit is three before you've built your first city, two after.",
		icon: 'diamond-outline',
		set: 'base',
	},
	{
		id: 'asceticism',
		title: 'Curse of Asceticism',
		description:
			'For the purposes of Longest Road, your road count is two less. For the purposes of Largest Army, your army size is one less.',
		icon: 'leaf-outline',
		set: 'base',
	},
	{
		id: 'nomadism',
		title: 'Curse of Nomadism',
		description: 'You must build at least eleven roads to win.',
		icon: 'footsteps-outline',
		set: 'base',
	},
	{
		id: 'avarice',
		title: 'Curse of Avarice',
		description:
			'You lose all your cards when a 7 is rolled and you have more than seven cards in your hand (instead of losing half).',
		icon: 'wallet-outline',
		set: 'base',
	},
	{
		id: 'power',
		title: 'Curse of Power',
		description:
			'You may not build more than three power on a single hex. You may not build three power on more than two hexes.',
		icon: 'flash-outline',
		set: 'base',
	},
	{
		id: 'compaction',
		title: 'Curse of Compaction',
		description: 'You may build a maximum of seven roads.',
		icon: 'contract-outline',
		set: 'base',
	},
	{
		id: 'provinciality',
		title: 'Curse of Provinciality',
		description:
			'You may not use the ports on the board. You may trade with the bank at a 5:1 rate (instead of 4:1).',
		icon: 'home-outline',
		set: 'base',
	},
	{
		id: 'youth',
		title: 'Curse of Youth',
		description: 'You cannot build settlements on all five resource types.',
		icon: 'happy-outline',
		set: 'base',
	},
]

export function curseById(id: string): Curse | undefined {
	return CURSE_POOL.find((c) => c.id === id)
}
