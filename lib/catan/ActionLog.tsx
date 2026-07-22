// Floating top-right log button, mounted below the BoardLegend info floater.
// Collapsed = a list icon; expanded = a scrollable, newest-first history of
// game actions derived from `games.events`. Read-only — it just formats the
// event log that the edge function already writes.

import { Ionicons } from '@expo/vector-icons'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import type { GameEvent } from '../stores/useGamesStore'
import type { Profile } from '../stores/useProfileStore'
import { colors, font, radius, spacing } from '../theme'
import { RESOURCES, type Resource } from './board'
import { bonusById, curseById } from './bonuses'
import { devCardById } from './devCards'
import { playerColors } from './palette'

const RESOURCE_LABELS: Record<Resource, string> = {
	wood: 'wood',
	wheat: 'wheat',
	sheep: 'sheep',
	brick: 'brick',
	ore: 'ore',
}

type LogContext = {
	playerOrder: string[]
	profilesById: Record<string, Profile>
	meIdx: number
}

// Filter categories. Kinds may belong to more than one bucket — a ritual roll
// is both a roll and a bonus — so these are membership lists, not a partition.
// `satisfies` keeps them honest against the event union: a renamed or dropped
// kind fails to compile here rather than silently filtering to nothing.
const CATEGORIES = {
	rolls: ['rolled', 'reroll', 'ritual_roll', 'fortune_teller_roll'],
	builds: [
		'settlement_placed',
		'road_placed',
		'road_built',
		'settlement_built',
		'city_built',
		'build_super_city',
		'explorer_road',
		'ghost_spawned',
		'liquidate',
		'dev_bought',
		'scout_buy',
		'dev_played',
		'largest_army_changed',
		'longest_road_changed',
	],
	trades: ['trade_accepted', 'bank_trade', 'shepherd_swap'],
	robber: ['discarded', 'robber_moved', 'stolen', 'hoarder_kept'],
	bonuses: [
		'bonus_chosen',
		'specialist_set',
		'hoarder_kept',
		'carpenter_vp',
		'knight_tapped',
		'reroll',
		'nomad_produce',
		'fortune_teller_roll',
		'explorer_road',
		'shepherd_swap',
		'ritual_roll',
		'curio_collected',
		'forger_token_set',
		'forger_token_move',
		'forger_copy',
		'scout_buy',
		'liquidate',
		'build_super_city',
		'fence_token',
		'invest',
		'investor_payout',
		'magic_cast',
		'haunt_spots_set',
		'ghost_spawned',
	],
} satisfies Record<string, GameEvent['kind'][]>

type Category = keyof typeof CATEGORIES
type Filter = 'all' | Category

const FILTERS: { key: Filter; label: string }[] = [
	{ key: 'all', label: 'All' },
	{ key: 'rolls', label: 'Rolls' },
	{ key: 'builds', label: 'Builds' },
	{ key: 'trades', label: 'Trades' },
	{ key: 'robber', label: 'Robber' },
	{ key: 'bonuses', label: 'Bonuses' },
]

const KINDS_BY_FILTER: Record<Category, ReadonlySet<GameEvent['kind']>> = {
	rolls: new Set(CATEGORIES.rolls),
	builds: new Set(CATEGORIES.builds),
	trades: new Set(CATEGORIES.trades),
	robber: new Set(CATEGORIES.robber),
	bonuses: new Set(CATEGORIES.bonuses),
}

// A single rendered log line: the message plus the player index it belongs to
// (for the colored dot). `player: null` renders a neutral marker.
type LogLine = { text: string; player: number | null }

export function ActionLog({
	events,
	playerOrder,
	profilesById,
	meIdx,
}: {
	events: GameEvent[]
	playerOrder: string[]
	profilesById: Record<string, Profile>
	meIdx: number
}) {
	const [open, setOpen] = useState(false)
	const [filter, setFilter] = useState<Filter>('all')

	// Newest-first: the freshest action sits at the top so recent activity is
	// visible without scrolling.
	const lines = useMemo(() => {
		const ctx: LogContext = { playerOrder, profilesById, meIdx }
		const out: { key: string; line: LogLine }[] = []
		for (let i = events.length - 1; i >= 0; i--) {
			const e = events[i]
			if (filter !== 'all' && !KINDS_BY_FILTER[filter].has(e.kind))
				continue
			const line = describeEvent(e, ctx)
			if (line) out.push({ key: `${e.at}-${i}`, line })
		}
		return out
	}, [events, filter, playerOrder, profilesById, meIdx])

	if (!open) {
		return (
			<Pressable
				onPress={() => setOpen(true)}
				style={({ pressed }) => [
					styles.collapsed,
					pressed && styles.pressed,
				]}
				hitSlop={6}
				accessibilityLabel="Open action log"
			>
				<Ionicons name="list" size={22} color={colors.text} />
			</Pressable>
		)
	}

	return (
		<Animated.View
			entering={FadeIn.duration(150)}
			exiting={FadeOut.duration(120)}
			style={styles.panel}
		>
			<View style={styles.header}>
				<Text style={styles.title}>Log</Text>
				<Pressable
					onPress={() => setOpen(false)}
					style={({ pressed }) => [
						styles.closeBtn,
						pressed && styles.pressed,
					]}
					accessibilityLabel="Close action log"
					hitSlop={6}
				>
					<Ionicons
						name="close"
						size={18}
						color={colors.textSecondary}
					/>
				</Pressable>
			</View>
			<ScrollView
				horizontal
				style={styles.filterScroll}
				contentContainerStyle={styles.filterRow}
				showsHorizontalScrollIndicator={false}
			>
				{FILTERS.map((f) => {
					const active = f.key === filter
					return (
						<Pressable
							key={f.key}
							onPress={() => setFilter(f.key)}
							style={({ pressed }) => [
								styles.chip,
								active && styles.chipActive,
								pressed && styles.pressed,
							]}
							accessibilityRole="button"
							accessibilityState={{ selected: active }}
						>
							<Text
								style={[
									styles.chipText,
									active && styles.chipTextActive,
								]}
							>
								{f.label}
							</Text>
						</Pressable>
					)
				})}
			</ScrollView>
			{lines.length === 0 ? (
				<Text style={styles.empty}>
					{filter === 'all' ? 'No actions yet.' : 'Nothing here yet.'}
				</Text>
			) : (
				<ScrollView
					style={styles.scroll}
					contentContainerStyle={styles.scrollBody}
					showsVerticalScrollIndicator={false}
				>
					{lines.map(({ key, line }) => (
						<View key={key} style={styles.row}>
							<View
								style={[
									styles.dot,
									{
										backgroundColor:
											line.player === null
												? colors.textMuted
												: (playerColors[line.player] ??
													playerColors[0]),
									},
								]}
							/>
							<Text style={styles.rowText}>{line.text}</Text>
						</View>
					))}
				</ScrollView>
			)}
		</Animated.View>
	)
}

function describeEvent(e: GameEvent, ctx: LogContext): LogLine | null {
	const who = (idx: number) => nameFor(idx, ctx)

	switch (e.kind) {
		case 'settlement_placed':
			return {
				text: `${who(e.player)} placed a settlement`,
				player: e.player,
			}
		case 'road_placed':
			return { text: `${who(e.player)} placed a road`, player: e.player }
		case 'placement_complete':
			return { text: 'Setup complete', player: null }
		case 'rolled':
			return {
				text: `${who(e.player)} rolled ${e.total}`,
				player: e.player,
			}
		case 'road_built':
			return { text: `${who(e.player)} built a road`, player: e.player }
		case 'settlement_built':
			return {
				text: `${who(e.player)} built a settlement`,
				player: e.player,
			}
		case 'city_built':
			return { text: `${who(e.player)} built a city`, player: e.player }
		case 'discarded':
			return {
				text: `${who(e.player)} discarded ${e.count} ${
					e.count === 1 ? 'card' : 'cards'
				}`,
				player: e.player,
			}
		case 'robber_moved':
			return {
				text: `${who(e.player)} moved the robber`,
				player: e.player,
			}
		case 'stolen':
			return {
				text: `${who(e.thief)} stole from ${who(e.victim)}`,
				player: e.thief,
			}
		case 'trade_accepted':
			return {
				text: `${who(e.from)} traded with ${who(e.to)}`,
				player: e.from,
			}
		case 'bank_trade':
			return {
				text: e.merchant
					? `${who(e.player)} traded with the bank and converted ${e.merchant.count} ${RESOURCE_LABELS[e.merchant.resource]} (merchant)`
					: `${who(e.player)} traded with the bank`,
				player: e.player,
			}
		case 'dev_bought':
			return {
				text: `${who(e.player)} bought a development card`,
				player: e.player,
			}
		case 'dev_played':
			return {
				text: `${who(e.player)} played ${devCardById(e.id)?.title ?? 'a card'}`,
				player: e.player,
			}
		case 'largest_army_changed':
			return {
				text: `${who(e.player)} took Largest Army`,
				player: e.player,
			}
		case 'longest_road_changed':
			return e.player === null
				? { text: 'Longest Road is now unclaimed', player: null }
				: {
						text: `${who(e.player)} took Longest Road`,
						player: e.player,
					}
		case 'nomad_produce':
			return {
				text: `${who(e.player)} gained ${e.count} ${RESOURCE_LABELS[e.resource]} (nomad)`,
				player: e.player,
			}
		case 'fortune_teller_roll': {
			const parts = RESOURCES.filter((r) => e.gain[r] > 0).map(
				(r) => `${e.gain[r]} ${RESOURCE_LABELS[r]}`
			)
			const gained = parts.length > 0 ? parts.join(', ') : 'nothing'
			return {
				text: `${who(e.player)} rolled ${e.total} (fortune teller), gained ${gained}`,
				player: e.player,
			}
		}
		// Spelled out for self because `nameFor` returns 'You', and
		// "You has been Honked" is broken grammar.
		case 'honked':
			return {
				text:
					e.player === ctx.meIdx
						? 'You have been Honked'
						: `${who(e.player)} has been Honked`,
				player: e.player,
			}
		case 'bonus_chosen': {
			const bonus = bonusById(e.bonus)?.title ?? 'a bonus'
			const curse = e.curse ? curseById(e.curse)?.title : null
			return {
				text: curse
					? `${who(e.player)}: ${bonus} — ${curse}`
					: `${who(e.player)}: ${bonus}`,
				player: e.player,
			}
		}
		case 'hoarder_kept':
			return {
				text: `${who(e.player)} kept all ${e.count} cards (hoarder)`,
				player: e.player,
			}
		case 'specialist_set':
			return {
				text: `${who(e.player)} specialized in ${RESOURCE_LABELS[e.resource]}`,
				player: e.player,
			}
		case 'carpenter_vp':
			return {
				text: `${who(e.player)} bought a victory point (carpenter)`,
				player: e.player,
			}
		case 'knight_tapped':
			return {
				text: `${who(e.player)} tapped a knight for ${RESOURCE_LABELS[e.resources[0]]} and ${RESOURCE_LABELS[e.resources[1]]}`,
				player: e.player,
			}
		case 'reroll':
			return {
				text: `${who(e.player)} rerolled the dice (gambler)`,
				player: e.player,
			}
		case 'explorer_road':
			return {
				text: `${who(e.player)} placed a free road (explorer)`,
				player: e.player,
			}
		case 'shepherd_swap':
			return {
				text: `${who(e.player)} swapped sheep for ${RESOURCE_LABELS[e.take[0]]} and ${RESOURCE_LABELS[e.take[1]]} (shepherd)`,
				player: e.player,
			}
		case 'ritual_roll':
			return {
				text: `${who(e.player)} performed a ritual and rolled ${e.total}`,
				player: e.player,
			}
		case 'curio_collected':
			return {
				text: `${who(e.player)} collected ${describeHand(e.take)} (curio collector)`,
				player: e.player,
			}
		case 'forger_token_set':
			return {
				text: `${cap(possessive(e.player, ctx))} forger token activated`,
				player: e.player,
			}
		case 'forger_token_move':
			return {
				text: `${who(e.player)} moved their forger token`,
				player: e.player,
			}
		case 'forger_copy':
			return {
				text: `${who(e.player)} copied ${possessive(e.target, ctx)} production (forger)`,
				player: e.player,
			}
		// The card itself is acquired at `confirm_scout_card`, which logs the
		// usual `dev_bought` — this is the peek that precedes it.
		case 'scout_buy':
			return {
				text: e.swap
					? `${who(e.player)} peeked at the deck, paying ${RESOURCE_LABELS[e.swap.to]} for ${RESOURCE_LABELS[e.swap.from]} (scout)`
					: `${who(e.player)} peeked at the deck (scout)`,
				player: e.player,
			}
		case 'liquidate':
			return {
				text: `${who(e.player)} liquidated ${LIQUIDATION_LABELS[e.detail.kind]}`,
				player: e.player,
			}
		case 'build_super_city':
			return {
				text: `${who(e.player)} built a super city`,
				player: e.player,
			}
		case 'fence_token':
			return {
				text: `${who(e.player)} reserved an edge (fencer)`,
				player: e.player,
			}
		case 'invest':
			return {
				text: `${who(e.player)} set aside an investment`,
				player: e.player,
			}
		case 'investor_payout':
			return {
				text: `${who(e.player)} collected an investment payout`,
				player: e.player,
			}
		case 'magic_cast':
			return {
				text: `${who(e.player)} conjured production for ${e.target} (magician)`,
				player: e.player,
			}
		case 'haunt_spots_set':
			return {
				text: `${who(e.player)} chose their haunted spots`,
				player: e.player,
			}
		case 'ghost_spawned':
			return {
				text: `A ghost appeared on ${possessive(e.player, ctx)} haunted spot`,
				player: e.player,
			}
		case 'game_complete': {
			// Two historical shapes carry the winner under different keys.
			const winner = 'winner' in e ? e.winner : e.winner_index
			return { text: `${who(winner)} won the game`, player: winner }
		}
		// Ephemeral negotiation + per-turn bookkeeping is intentionally omitted
		// to keep the log focused on committed, state-changing actions.
		case 'turn_ended':
		case 'trade_proposed':
		case 'trade_canceled':
		case 'trade_rejected':
		case 'magic_skipped':
			return null
		default:
			return null
	}
}

function nameFor(idx: number, ctx: LogContext): string {
	if (idx === ctx.meIdx) return 'You'
	const uid = ctx.playerOrder[idx]
	return ctx.profilesById[uid]?.username ?? 'Player'
}

// "your production" rather than "You's production" for the self case.
function possessive(idx: number, ctx: LogContext): string {
	return idx === ctx.meIdx ? 'your' : `${nameFor(idx, ctx)}'s`
}

// For the possessive at the start of a line, where "your" would read as a typo.
function cap(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1)
}

// "2 wheat, 1 ore" from a list of picked resources.
function describeHand(take: Resource[]): string {
	const counts = {} as Record<Resource, number>
	for (const r of take) counts[r] = (counts[r] ?? 0) + 1
	const parts = RESOURCES.filter((r) => counts[r] > 0).map(
		(r) => `${counts[r]} ${RESOURCE_LABELS[r]}`
	)
	return parts.length > 0 ? parts.join(', ') : 'nothing'
}

const LIQUIDATION_LABELS: Record<string, string> = {
	road: 'a road',
	settlement: 'a settlement',
	city: 'a city',
	super_city: 'a super city',
	dev_card: 'a development card',
}

const styles = StyleSheet.create({
	collapsed: {
		position: 'absolute',
		top: spacing.sm + 32 + spacing.xs,
		right: spacing.sm,
		width: 32,
		height: 32,
		borderRadius: 16,
		backgroundColor: colors.card,
		borderWidth: 1,
		borderColor: colors.border,
		alignItems: 'center',
		justifyContent: 'center',
		shadowColor: '#000',
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.12,
		shadowRadius: 6,
		elevation: 3,
		zIndex: 4,
	},
	panel: {
		position: 'absolute',
		top: spacing.sm,
		right: spacing.sm,
		width: 244,
		maxHeight: 320,
		backgroundColor: colors.card,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		paddingVertical: spacing.xs,
		shadowColor: '#000',
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.12,
		shadowRadius: 6,
		elevation: 3,
		zIndex: 5,
	},
	header: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingHorizontal: spacing.sm,
		paddingBottom: spacing.xs,
		borderBottomWidth: 1,
		borderBottomColor: colors.borderLight,
	},
	title: {
		fontSize: font.sm,
		fontWeight: '700',
		color: colors.text,
	},
	closeBtn: {
		width: 28,
		height: 28,
		alignItems: 'center',
		justifyContent: 'center',
	},
	filterScroll: {
		flexGrow: 0,
		borderBottomWidth: 1,
		borderBottomColor: colors.borderLight,
	},
	filterRow: {
		paddingHorizontal: spacing.sm,
		paddingVertical: spacing.xs,
		gap: spacing.xs,
	},
	chip: {
		paddingHorizontal: spacing.sm,
		paddingVertical: 3,
		borderRadius: radius.full,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.cardAlt,
	},
	chipActive: {
		backgroundColor: colors.brand,
		borderColor: colors.brand,
	},
	chipText: {
		fontSize: font.xs,
		fontWeight: '600',
		color: colors.textSecondary,
	},
	chipTextActive: {
		color: colors.white,
	},
	scroll: {
		flexGrow: 0,
	},
	scrollBody: {
		paddingHorizontal: spacing.sm,
		paddingTop: spacing.xs,
		gap: spacing.xs,
	},
	empty: {
		paddingHorizontal: spacing.sm,
		paddingTop: spacing.sm,
		paddingBottom: spacing.xs,
		fontSize: font.sm,
		color: colors.textMuted,
	},
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
	},
	dot: {
		width: 10,
		height: 10,
		borderRadius: 5,
		borderWidth: 1,
		borderColor: colors.border,
	},
	rowText: {
		flex: 1,
		fontSize: font.sm,
		color: colors.text,
	},
	pressed: {
		opacity: 0.7,
	},
})
