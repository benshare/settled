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
import { colors, font, radius, shadow, spacing, z } from '../theme'
import { RESOURCES, type Resource } from './board'
import { bonusById, curseById } from './bonuses'
import { devCardById } from './devCards'
import type { ResourceHand } from './types'

const RESOURCE_LABELS: Record<Resource, string> = {
	wood: 'wood',
	wheat: 'wheat',
	sheep: 'sheep',
	brick: 'brick',
	ore: 'ore',
}

// Exported so the HUD status banner can reuse `describeEvent` for its
// "most recent action" line rather than duplicating the event formatters.
export type LogContext = {
	playerOrder: string[]
	profilesById: Record<string, Profile>
	meIdx: number
}

// Filter categories. Kinds may belong to more than one bucket — a ritual roll
// is both a roll and a bonus — so these are membership lists, not a partition.
// `satisfies` keeps them honest against the event union: a renamed or dropped
// kind fails to compile here rather than silently filtering to nothing.
const CATEGORIES = {
	rolls: [
		'rolled',
		'reroll',
		'roll_choice',
		'ritual_roll',
		'fortune_teller_roll',
	],
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
		'roll_choice',
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
// (for the colored dot). `player: null` renders a neutral marker. `detail` is
// the expanded body — omitted for events with nothing more to say, which is
// what makes a row tappable or not.
export type LogLine = {
	text: string
	player: number | null
	detail?: DetailRow[]
}

// One line of an expanded row: an optional label (who / what side of a trade)
// and the resources. A row with no label is a plain note.
type DetailRow = { label?: string; text: string }

export function ActionLog({
	events,
	playerOrder,
	profilesById,
	meIdx,
	seatColors,
	anchorBottom,
}: {
	events: GameEvent[]
	playerOrder: string[]
	profilesById: Record<string, Profile>
	meIdx: number
	// Each seat's color, in seat order. Resolved once in `gameContext`
	// (`useGame().seatColors`) so this can't disagree with the board.
	seatColors: readonly string[]
	// When set, anchor from the bottom (HUD bottom-right column) instead of the
	// default top-right. The button sits in the second slot; the panel opens
	// from there.
	anchorBottom?: number
}) {
	const [open, setOpen] = useState(false)
	const [filter, setFilter] = useState<Filter>('all')
	const SLOT = 32 + spacing.xs
	const collapsedVpos =
		anchorBottom != null
			? { bottom: anchorBottom + SLOT }
			: { top: spacing.sm + SLOT }
	const panelVpos =
		anchorBottom != null
			? { bottom: anchorBottom + SLOT }
			: { top: spacing.sm }
	// Keyed the same way as the rendered rows, so an expansion survives new
	// events landing above it. Everything starts collapsed.
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

	const toggle = (key: string) =>
		setExpanded((prev) => {
			const next = new Set(prev)
			if (!next.delete(key)) next.add(key)
			return next
		})

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
					collapsedVpos,
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
			style={[styles.panel, panelVpos]}
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
						<LogRow
							key={key}
							line={line}
							color={
								line.player === null
									? colors.textMuted
									: (seatColors[line.player] ??
										colors.textMuted)
							}
							expanded={expanded.has(key)}
							onToggle={() => toggle(key)}
						/>
					))}
				</ScrollView>
			)}
		</Animated.View>
	)
}

function LogRow({
	line,
	color,
	expanded,
	onToggle,
}: {
	line: LogLine
	// The seat's color, or the muted tone for a table-wide event.
	color: string
	expanded: boolean
	onToggle: () => void
}) {
	const dot = <View style={[styles.dot, { backgroundColor: color }]} />

	if (!line.detail) {
		return (
			<View style={styles.row}>
				{dot}
				<Text style={styles.rowText}>{line.text}</Text>
			</View>
		)
	}

	return (
		<View>
			<Pressable
				onPress={onToggle}
				style={({ pressed }) => [styles.row, pressed && styles.pressed]}
				accessibilityRole="button"
				accessibilityState={{ expanded }}
			>
				{dot}
				<Text style={styles.rowText}>{line.text}</Text>
				<Ionicons
					name={expanded ? 'chevron-up' : 'chevron-down'}
					size={12}
					color={colors.textMuted}
				/>
			</Pressable>
			{expanded && (
				<Animated.View
					entering={FadeIn.duration(120)}
					style={styles.detail}
				>
					{line.detail.map((d, i) => (
						<View
							key={`${d.label ?? ''}-${i}`}
							style={styles.detailRow}
						>
							{d.label !== undefined && (
								<Text style={styles.detailLabel}>
									{d.label}
								</Text>
							)}
							<Text style={styles.detailText}>{d.text}</Text>
						</View>
					))}
				</Animated.View>
			)}
		</View>
	)
}

export function describeEvent(e: GameEvent, ctx: LogContext): LogLine | null {
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
				detail: gainsDetail(e.gains, ctx),
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
				detail: [
					{ label: `${who(e.from)} gave`, text: handText(e.give) },
					{ label: `${who(e.to)} gave`, text: handText(e.receive) },
				],
			}
		case 'bank_trade': {
			const detail: DetailRow[] = [
				{ label: 'Gave', text: handText(e.give) },
				{ label: 'Got', text: handText(e.receive) },
			]
			// One rate for the whole trade is the common case and reads best;
			// a mixed give (a 2:1 port alongside the 4:1 bank) needs the
			// per-resource breakdown to be honest about what it cost.
			const rateText = e.ratio
				? `${e.ratio}:1`
				: e.rates
					? e.rates
							.map(
								(r) =>
									`${r.ratio * r.groups} ${RESOURCE_LABELS[r.resource]} at ${r.ratio}:1`
							)
							.join(' · ')
					: null
			if (rateText) detail.push({ label: 'Rate', text: rateText })
			// Pre-combination events only: the merchant's extras are ordinary
			// 1:1 groups now, but old rows still carry the side-conversion.
			if (e.merchant) {
				detail.push({
					label: 'Merchant',
					text: `${e.merchant.count} ${RESOURCE_LABELS[e.merchant.resource]} → ${handText(e.merchant.take)}`,
				})
			}
			return {
				text: `${who(e.player)} traded with the bank`,
				player: e.player,
				detail,
			}
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
				detail: devPlayedDetail(e),
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
		case 'fortune_teller_roll':
			return {
				text: `${who(e.player)} rolled ${e.total} (fortune teller)`,
				player: e.player,
				detail: [{ label: 'Gained', text: handText(e.gain) }],
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
				text: `${who(e.player)} tapped a knight (veteran)`,
				player: e.player,
				detail: [
					{
						label: 'Gained',
						text: `1 ${RESOURCE_LABELS[e.resources[0]]}, 1 ${RESOURCE_LABELS[e.resources[1]]}`,
					},
				],
			}
		case 'roll_choice':
			return {
				text: `${who(e.player)} kept one of two rolls (gambler)`,
				player: e.player,
				detail: [
					{
						label: 'Kept',
						text: `${e.kept_dice[0] + e.kept_dice[1]} (${e.kept_dice.join(' + ')})`,
					},
					{
						label: 'Passed on',
						text: `${e.discarded_dice[0] + e.discarded_dice[1]} (${e.discarded_dice.join(' + ')})`,
					},
				],
			}
		case 'reroll':
			return {
				text: `${who(e.player)} rerolled the dice (gambler)`,
				player: e.player,
				detail: [
					{
						label: 'Threw away',
						text: `${e.old_dice[0] + e.old_dice[1]} (${e.old_dice.join(' + ')})`,
					},
					{
						label: 'Kept',
						text: `${e.new_dice[0] + e.new_dice[1]} (${e.new_dice.join(' + ')})`,
					},
				],
			}
		case 'explorer_road':
			return {
				text: `${who(e.player)} placed a free road (explorer)`,
				player: e.player,
			}
		case 'shepherd_swap':
			return {
				text: `${who(e.player)} swapped sheep (shepherd)`,
				player: e.player,
				detail: [
					{
						label: 'Got',
						text: `1 ${RESOURCE_LABELS[e.take[0]]}, 1 ${RESOURCE_LABELS[e.take[1]]}`,
					},
				],
			}
		case 'ritual_roll':
			return {
				text: `${who(e.player)} performed a ritual and rolled ${e.total}`,
				player: e.player,
				detail: [
					{ label: 'Discarded', text: handText(e.discard) },
					...(gainsDetail(e.gains, ctx) ?? []),
				],
			}
		case 'curio_collected':
			return {
				text: `${who(e.player)} collected 3 resources (curio collector)`,
				player: e.player,
				detail: [{ label: 'Took', text: describeHand(e.take) }],
			}
		case 'forger_token_set':
			return {
				text: `${cap(possessive(e.player, ctx))} forger token activated`,
				player: e.player,
			}
		case 'forger_token_move':
			return {
				text: `${who(e.player)} moved ${who(e.player) === "You" ? "your" : "their"} forger token`,
				player: e.player,
			}
		case 'forger_copy':
			return {
				text: `${who(e.player)} copied ${possessive(e.target, ctx)} production (forger)`,
				player: e.player,
				detail: [{ label: 'Gained', text: handText(e.gain) }],
			}
		// The card itself is acquired at `confirm_scout_card`, which logs the
		// usual `dev_bought` — this is the peek that precedes it.
		case 'scout_buy':
			return {
				text: `${who(e.player)} peeked at the deck (scout)`,
				player: e.player,
				detail: e.swap
					? [
							{
								label: 'Paid',
								text: `${RESOURCE_LABELS[e.swap.to]} instead of ${RESOURCE_LABELS[e.swap.from]}`,
							},
						]
					: undefined,
			}
		case 'liquidate':
			return {
				text: `${who(e.player)} liquidated ${LIQUIDATION_LABELS[e.detail.kind]}`,
				player: e.player,
				detail: [{ label: 'Refund', text: handText(e.detail.refund) }],
			}
		case 'build_super_city':
			return {
				text: `${who(e.player)} built a super city`,
				player: e.player,
				detail: [{ label: 'Cost', text: handText(e.cost) }],
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
				detail: [
					{ label: 'Trio', text: `3 ${RESOURCE_LABELS[e.resource]}` },
				],
			}
		case 'investor_payout':
			return {
				text: `${who(e.player)} collected an investment payout`,
				player: e.player,
				detail: [{ label: 'Gained', text: handText(e.gain) }],
			}
		case 'magic_cast':
			return {
				text: `${who(e.player)} conjured production for ${e.target} (magician)`,
				player: e.player,
				detail: [
					{ label: 'Discarded', text: handText(e.discard) },
					{ label: 'Gained', text: handText(e.gain) },
				],
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
		case 'forfeit_submitted':
			return { text: `${who(e.player)} forfeited`, player: e.player }
		case 'forfeit_withdrawn':
			return {
				text: `${who(e.player)} withdrew ${possessive(e.player, ctx)} forfeit`,
				player: e.player,
			}
		case 'end_game_proposed':
			return {
				text: `${who(e.player)} wants to end the game`,
				player: e.player,
			}
		case 'end_game_withdrawn':
			return {
				text: `${who(e.player)} no longer wants to end the game`,
				player: e.player,
			}
		// No winner and no scoreboard — the whole table voted to stop.
		case 'game_canceled':
			return { text: 'Game canceled', player: null }
		case 'game_complete': {
			// Two historical shapes carry the winner under different keys.
			const winner = 'winner' in e ? e.winner : e.winner_index
			const byForfeit = 'by_forfeit' in e && e.by_forfeit
			return {
				text: byForfeit
					? `${who(winner)} won — everyone else forfeited`
					: `${who(winner)} won the game`,
				player: winner,
			}
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

// One detail row per seat that collected, in seat order. `undefined` (rather
// than an empty list) when the roll predates `gains` being recorded, so the
// row stays un-expandable instead of claiming nobody collected.
function gainsDetail(
	gains: Record<number, ResourceHand> | undefined,
	ctx: LogContext
): DetailRow[] | undefined {
	if (!gains) return undefined
	const rows = Object.keys(gains)
		.map(Number)
		.sort((a, b) => a - b)
		.filter((idx) => handTotal(gains[idx]) > 0)
		.map((idx) => ({
			label: nameFor(idx, ctx),
			text: handText(gains[idx]),
		}))
	return rows.length > 0 ? rows : [{ text: 'Nobody collected anything.' }]
}

function devPlayedDetail(
	e: Extract<GameEvent, { kind: 'dev_played' }>
): DetailRow[] | undefined {
	if (e.take) {
		return [
			{
				label: 'Took',
				text: `1 ${RESOURCE_LABELS[e.take[0]]}, 1 ${RESOURCE_LABELS[e.take[1]]}`,
			},
		]
	}
	if (e.resource) {
		return [
			{ label: 'Named', text: RESOURCE_LABELS[e.resource] },
			{
				label: 'Took',
				text: `${e.total ?? 0} ${RESOURCE_LABELS[e.resource]}`,
			},
		]
	}
	return undefined
}

// "2 wheat, 1 ore" — or "nothing" for an empty hand.
function handText(hand: ResourceHand): string {
	const parts = RESOURCES.filter((r) => hand[r] > 0).map(
		(r) => `${hand[r]} ${RESOURCE_LABELS[r]}`
	)
	return parts.length > 0 ? parts.join(', ') : 'nothing'
}

function handTotal(hand: ResourceHand): number {
	let n = 0
	for (const r of RESOURCES) n += hand[r]
	return n
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
		right: spacing.sm,
		width: 32,
		height: 32,
		borderRadius: 16,
		backgroundColor: colors.card,
		borderWidth: 1,
		borderColor: colors.border,
		alignItems: 'center',
		justifyContent: 'center',
		boxShadow: shadow.card,
		zIndex: z.floatingButton,
	},
	panel: {
		position: 'absolute',
		right: spacing.sm,
		width: 244,
		maxHeight: 320,
		backgroundColor: colors.card,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		paddingVertical: spacing.xs,
		boxShadow: shadow.card,
		zIndex: z.panel,
	},
	header: {
		flexDirection: 'row',
		flexShrink: 0,
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
		flexShrink: 0,
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
	// Indented to clear the row's dot, so detail reads as belonging to it.
	detail: {
		paddingLeft: 10 + spacing.xs,
		paddingTop: 2,
		paddingBottom: spacing.xs,
		gap: 1,
	},
	detailRow: {
		flexDirection: 'row',
		gap: spacing.xs,
	},
	detailLabel: {
		fontSize: font.xs,
		color: colors.textMuted,
	},
	detailText: {
		flex: 1,
		fontSize: font.xs,
		color: colors.textSecondary,
	},
	pressed: {
		opacity: 0.7,
	},
})
