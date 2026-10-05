import type { Bonus } from './index'

export const BONUS_POOL: readonly Bonus[] = [
	{
		id: 'specialist',
		title: 'Specialist',
		description:
			'Start of game: declare a resource. Port trades with it as the input cost one fewer.',
		clarifications: [],
		icon: 'briefcase-outline',
		set: '1',
	},
	{
		id: 'merchant',
		title: 'Merchant',
		description:
			'When you use a port, you may pay N extra of the input resource to receive N extra resources of your choice.',
		clarifications: [],
		icon: 'cart-outline',
		set: '3',
	},
	{
		id: 'gambler',
		title: 'Gambler',
		description:
			'Any time you roll, you may reroll once. Only the second result counts.',
		clarifications: [],
		icon: 'dice-outline',
		set: '1',
	},
	{
		id: 'veteran',
		title: 'Veteran',
		description:
			'During your turn, discard a used Knight to gain two resources of your choice.',
		clarifications: ['Discarded Knights still count toward Largest Army.'],
		icon: 'shield-outline',
		set: '1',
	},
	{
		id: 'scout',
		title: 'Scout',
		description:
			'When buying a development card, draw two and keep one. The other goes to the bottom of the deck.',
		clarifications: [
			'You may pay a second copy of one required resource in place of another.',
		],
		icon: 'eye-outline',
		set: '2',
	},
	{
		id: 'plutocrat',
		title: 'Plutocrat',
		description:
			'When a roll gives you two or more of a resource, get 50% more of it.',
		clarifications: ['The bonus is rounded down.'],
		icon: 'cash-outline',
		set: '3',
	},
	{
		id: 'accountant',
		title: 'Accountant',
		description:
			'During your turn, you may liquidate your roads and buildings back into their resources.',
		clarifications: [
			"You can't liquidate something the same turn it was built.",
			"You can't liquidate a road if it would disconnect your pieces.",
		],
		icon: 'calculator-outline',
		set: '2',
	},
	{
		id: 'hoarder',
		title: 'Hoarder',
		description: 'You never lose cards when a 7 is rolled.',
		clarifications: [],
		icon: 'archive-outline',
		set: '1',
	},
	{
		id: 'explorer',
		title: 'Explorer',
		description: 'Start of game: place three roads for free.',
		clarifications: [],
		icon: 'map-outline',
		set: '2',
	},
	{
		id: 'ritualist',
		title: 'Ritualist',
		description:
			'Start of turn: discard two or three cards to choose your roll. No one else collects from it.',
		clarifications: ["Two cards before you've built a city, three after."],
		icon: 'flame-outline',
		set: '2',
	},
	{
		id: 'fencer',
		title: 'Fencer',
		description:
			'You can build fences (1 Wood), placed like roads. No one else can build on them.',
		clarifications: ['A fence can be upgraded into a road for 1 Brick.'],
		icon: 'lock-closed-outline',
		set: '3',
	},
	{
		id: 'underdog',
		title: 'Underdog',
		description: '1- and 2-pip hexes produce double the resources for you.',
		clarifications: [],
		icon: 'ribbon-outline',
		set: '1',
	},
	{
		id: 'nomad',
		title: 'Nomad',
		description:
			'For you, the desert produces a random resource whenever a 7 is rolled.',
		clarifications: [
			'Your settlements and cities on the desert collect from it like any other hex.',
		],
		icon: 'compass-outline',
		set: '1',
	},
	{
		id: 'populist',
		title: 'Populist',
		description:
			'Your settlements on fewer than five total pips are worth an extra point.',
		clarifications: [],
		icon: 'people-outline',
		set: '2',
	},
	{
		id: 'fortune_teller',
		title: 'Fortune Teller',
		description:
			'When you roll doubles or a 7, roll again. Only you collect from the extra roll.',
		clarifications: [],
		icon: 'sparkles-outline',
		set: '2',
	},
	{
		id: 'shepherd',
		title: 'Shepherd',
		description:
			'Start of turn: with four or more Sheep, discard one to choose two resources, received after rolling.',
		clarifications: ["Sheep don't count toward your 7-card hand limit."],
		icon: 'paw-outline',
		set: '2',
	},
	{
		id: 'smith',
		title: 'Smith',
		description:
			'You may substitute Brick for Ore and vice versa for buildings and ports.',
		clarifications: [],
		icon: 'hammer-outline',
		set: '3',
	},
	{
		id: 'carpenter',
		title: 'Carpenter',
		description:
			'Once per turn, you may spend four Wood to gain a victory point.',
		clarifications: [],
		icon: 'construct-outline',
		set: '1',
	},
	{
		id: 'metropolitan',
		title: 'Metropolitan',
		description:
			'You can upgrade cities into Super Cities, worth three points and collecting three from each adjacent hex.',
		clarifications: [
			'When buying a city or Super City, you may pay Ore in place of any of the Wheat.',
		],
		icon: 'business-outline',
		set: '2',
	},
	{
		id: 'investor',
		title: 'Investor',
		description:
			'During your turn, set aside three of one resource for an investment token. Each token pays one of that resource after you roll.',
		clarifications: ['Activates once you have 3 points.'],
		icon: 'trending-up-outline',
		set: '3',
	},
	{
		id: 'curio_collector',
		title: 'Curio Collector',
		description:
			'When you collect from a 2 or 12, gain three extra resources of your choice.',
		clarifications: [],
		icon: 'albums-outline',
		set: '2',
	},
	{
		id: 'thrill_seeker',
		title: 'Thrill Seeker',
		description: 'You need one fewer point to win.',
		clarifications: [],
		icon: 'rocket-outline',
		set: '1',
	},
	{
		id: 'bricklayer',
		title: 'Bricklayer',
		description: 'You may pay four Brick for any building.',
		clarifications: [],
		icon: 'cube-outline',
		set: '1',
	},
	{
		id: 'aristocrat',
		title: 'Aristocrat',
		description:
			'Receive starting resources from both starting settlements.',
		clarifications: [],
		icon: 'medal-outline',
		set: '1',
	},
	{
		id: 'magician',
		title: 'Magician',
		description:
			'After any roll, you may discard N + 1 cards to collect as if a number N away had been rolled.',
		clarifications: [],
		icon: 'color-wand-outline',
		set: '3',
	},
	{
		id: 'forger',
		title: 'Forger',
		description:
			'Each turn, move your forger token to an adjacent hex before rolling. When its hex is rolled, copy what another player collects there.',
		clarifications: [
			'The token starts on the desert.',
			'You still copy if the robber is blocking that hex.',
		],
		icon: 'copy-outline',
		set: '2',
	},
	{
		id: 'haunt',
		title: 'Haunt',
		description:
			'Start of game: secretly pick two buildable spots. If one becomes unbuildable, you get a ghost settlement there.',
		clarifications: [
			'Ghosts collect resources as normal but are worth no points.',
			"Ghosts don't stop anyone building on or next to them.",
		],
		icon: 'moon-outline',
		set: '3',
	},
]

export function bonusById(id: string): Bonus | undefined {
	return BONUS_POOL.find((b) => b.id === id)
}
