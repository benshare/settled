import type { Curse } from './index'

export const CURSE_POOL: readonly Curse[] = [
	{
		id: 'age',
		title: 'Curse of Age',
		description: 'You can spend a maximum of six cards per turn.',
		clarifications: [
			"Cards spent on bank, port, or player trades don't count.",
		],
		icon: 'hourglass-outline',
		set: 'base',
	},
	{
		id: 'decadence',
		title: 'Curse of Decadence',
		description: 'You may build a maximum of two cities.',
		clarifications: [],
		icon: 'wine-outline',
		set: 'base',
	},
	{
		id: 'ambition',
		title: 'Curse of Ambition',
		description: 'You need eleven points to win.',
		clarifications: [],
		icon: 'flag-outline',
		set: 'base',
	},
	{
		id: 'elitism',
		title: 'Curse of Elitism',
		description:
			"You can have at most three settlements on the board — two once you've built a city.",
		clarifications: [],
		icon: 'diamond-outline',
		set: 'base',
	},
	{
		id: 'asceticism',
		title: 'Curse of Asceticism',
		description:
			'For Longest Road your roads count as two fewer, and for Largest Army your army counts as one fewer.',
		clarifications: [],
		icon: 'leaf-outline',
		set: 'base',
	},
	{
		id: 'nomadism',
		title: 'Curse of Nomadism',
		description: 'You must build at least eleven roads to win.',
		clarifications: [],
		icon: 'footsteps-outline',
		set: 'base',
	},
	{
		id: 'avarice',
		title: 'Curse of Avarice',
		description:
			'If you have more than seven cards when a 7 is rolled, you lose all of them.',
		clarifications: ['You may discard two or more cards at any time.'],
		icon: 'wallet-outline',
		set: 'base',
	},
	{
		id: 'power',
		title: 'Curse of Power',
		description:
			'No hex can have more than three of your power, and at most two hexes can have three.',
		clarifications: [],
		icon: 'flash-outline',
		set: 'base',
	},
	{
		id: 'compaction',
		title: 'Curse of Compaction',
		description: 'You may build a maximum of seven roads.',
		clarifications: [],
		icon: 'contract-outline',
		set: 'base',
	},
	{
		id: 'provinciality',
		title: 'Curse of Provinciality',
		description: "You can't use ports, and bank trades cost 5:1.",
		clarifications: [],
		icon: 'home-outline',
		set: 'base',
	},
	{
		id: 'youth',
		title: 'Curse of Youth',
		description: 'You cannot build settlements on all five resource types.',
		clarifications: [],
		icon: 'happy-outline',
		set: 'base',
	},
]

export function curseById(id: string): Curse | undefined {
	return CURSE_POOL.find((c) => c.id === id)
}
