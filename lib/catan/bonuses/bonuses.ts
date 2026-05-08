import type { Bonus } from './index'

export const BONUS_POOL: readonly Bonus[] = [
	{
		id: 'specialist',
		title: 'Specialist',
		description:
			'Start of game: declare a resource type. Any time you use a port with that resource as the input, pay one fewer for the trade.',
		icon: 'briefcase-outline',
		set: '1',
	},
	{
		id: 'merchant',
		title: 'Merchant',
		description:
			"Any time you use a port, you may pay N additional of the 'in' resource to receive N additional resources of your choice.",
		icon: 'cart-outline',
		set: '3',
	},
	{
		id: 'gambler',
		title: 'Gambler',
		description:
			'Any time you roll, you may reroll once. If you do, only the second result counts.',
		icon: 'dice-outline',
		set: '1',
	},
	{
		id: 'veteran',
		title: 'Veteran',
		description:
			'At any time during your turn, you can discard a used Knight to gain two resource cards of your choice. Knights discarded this way still count towards Largest Army.',
		icon: 'shield-outline',
		set: '1',
	},
	{
		id: 'scout',
		title: 'Scout',
		description:
			'When buying a development card, you may replace one of the required resources with a second copy of one of the others. Then, instead of taking the top card, draw the top three. Choose one and place the other two on the bottom of the deck.',
		icon: 'eye-outline',
		set: '2',
	},
	{
		id: 'plutocrat',
		title: 'Plutocrat',
		description:
			'Every time you get two or more of a resource from a roll, get 50% more of that resource (rounded down).',
		icon: 'cash-outline',
		set: '3',
	},
	{
		id: 'accountant',
		title: 'Accountant',
		description:
			'At any time during your turn, you may "liquidate" buildings or unused development cards of yours into their corresponding resources. You may not liquidate something the same turn it is bought, and you may not liquidate a road if doing so creates a disconnection between your pieces.',
		icon: 'calculator-outline',
		set: '2',
	},
	{
		id: 'hoarder',
		title: 'Hoarder',
		description:
			"You don't lose cards when a 7 is rolled, even if you have more than seven in your hand.",
		icon: 'archive-outline',
		set: '1',
	},
	{
		id: 'explorer',
		title: 'Explorer',
		description: 'Start of game: place three roads for free.',
		icon: 'map-outline',
		set: '2',
	},
	{
		id: 'ritualist',
		title: 'Ritualist',
		description:
			'Start of turn: you may choose to discard two/three resource cards of your choice to choose your die roll. No other players receive resources from your roll if you do. Cost is two cards if you have not built a city, three cards if you have.',
		icon: 'flame-outline',
		set: '2',
	},
	{
		id: 'fencer',
		title: 'Fencer',
		description:
			'Start of game: place tokens on two road locations (hex edges). No other players can build roads there. Building a road on those spots requires only one of Wood and Brick for you.',
		icon: 'lock-closed-outline',
		set: '3',
	},
	{
		id: 'underdog',
		title: 'Underdog',
		description: '1- and 2-pip hexes produce double the resources for you.',
		icon: 'ribbon-outline',
		set: '1',
	},
	{
		id: 'nomad',
		title: 'Nomad',
		description:
			'For you, the desert is a random resource activated by 7. Settlements/cities on the desert produce that resource (1/2/3 each) like a normal hex.',
		icon: 'compass-outline',
		set: '1',
	},
	{
		id: 'populist',
		title: 'Populist',
		description:
			'Your settlements with total probability less than five pips are worth one extra point.',
		icon: 'people-outline',
		set: '2',
	},
	{
		id: 'fortune_teller',
		title: 'Fortune Teller',
		description:
			'Every time you roll doubles or 7, make an extra roll. Only you get resources from it.',
		icon: 'sparkles-outline',
		set: '2',
	},
	{
		id: 'shepherd',
		title: 'Shepherd',
		description:
			'If you begin your turn with four Sheep in your hand, you may discard two Sheep to receive two resource cards of your choice. Sheep do not count towards your 7 card hand limit.',
		icon: 'paw-outline',
		set: '2',
	},
	{
		id: 'smith',
		title: 'Smith',
		description:
			'You may substitute Brick for Ore and vice versa for buildings and ports.',
		icon: 'hammer-outline',
		set: '3',
	},
	{
		id: 'carpenter',
		title: 'Carpenter',
		description:
			'Once per turn, you may spend four Wood to gain a victory point.',
		icon: 'construct-outline',
		set: '1',
	},
	{
		id: 'metropolitan',
		title: 'Metropolitan',
		description:
			'You can upgrade a city one additional time to a "Super City"; Super Cities are worth three points and receive three resources from adjacent hexes. When buying a city or a Super City, you can replace any number of Wheat with the same number of Ore.',
		icon: 'business-outline',
		set: '2',
	},
	{
		id: 'investor',
		title: 'Investor',
		description:
			'At any time during your turn you may set aside three of the same resource card to receive an "investment token" for that resource. At the start of every turn, you receive one resource card from every investment token you have. Activates once you reach 3 points. Cards in investment cannot be stolen. Max 18 cards (6 trios) invested at once.',
		icon: 'trending-up-outline',
		set: '3',
	},
	{
		id: 'curio_collector',
		title: 'Curio Collector',
		description:
			'Whenever you gain cards from a 2 or 12 being rolled, receive three additional resource cards of your choice.',
		icon: 'albums-outline',
		set: '2',
	},
	{
		id: 'thrill_seeker',
		title: 'Thrill Seeker',
		description: 'You need one fewer point to win.',
		icon: 'rocket-outline',
		set: '1',
	},
	{
		id: 'bricklayer',
		title: 'Bricklayer',
		description: 'You may pay four Brick for any building.',
		icon: 'cube-outline',
		set: '1',
	},
	{
		id: 'aristocrat',
		title: 'Aristocrat',
		description:
			'Receive starting resources from both starting settlements.',
		icon: 'medal-outline',
		set: '1',
	},
	{
		id: 'magician',
		title: 'Magician',
		description:
			'After any roll, you may discard N + 1 cards to receive resources as if a number N away from the actual result had been rolled.',
		icon: 'color-wand-outline',
		set: '3',
	},
	{
		id: 'forger',
		title: 'Forger',
		description:
			'You receive a "forger token" which becomes active once a 7 is rolled. Whenever the robber moves due to a 7, the forger token moves to the same hex. Before your roll you may move the token to any adjacent hex. Whenever the token\'s hex produces resources, you copy the resources of another player.',
		icon: 'copy-outline',
		set: '2',
	},
	{
		id: 'haunt',
		title: 'Haunt',
		description:
			'Start of game: secretly pick two buildable locations. Whenever those locations become unbuildable, you receive a "ghost" settlement on that spot. It collects resources as normal but is worth no points. Ghost settlements do not prevent other players from building within one hex.',
		icon: 'moon-outline',
		set: '3',
	},
]

export function bonusById(id: string): Bonus | undefined {
	return BONUS_POOL.find((b) => b.id === id)
}
