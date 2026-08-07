import { useAuth } from '@/lib/auth'
import {
	BONUS_POOL,
	bonusById,
	bonusDescriptionFor,
	CURSE_POOL,
	curseById,
	curseDescriptionFor,
	isBonusAvailableAt,
	isCurseAvailableAt,
	type Bonus,
	type Curse,
} from '@/lib/catan/bonuses'
import { GAME_SIZES, type GameSize } from '@/lib/catan/types'
import { Avatar } from '@/lib/modules/Avatar'
import { Modal } from '@/lib/modules/Modal'
import { SlidingArea } from '@/lib/modules/SlidingArea'
import {
	cardStatKey,
	computeStats,
	indexCardStats,
	type CardRate,
	type CardStat,
} from '@/lib/stats'
import { useGamesStore } from '@/lib/stores/useGamesStore'
import type { Profile } from '@/lib/stores/useProfileStore'
import { useStatsStore } from '@/lib/stores/useStatsStore'
import { useTheme } from '@/lib/ThemeContext'
import { ColorScheme, font, radius, spacing } from '@/lib/theme'
import { Ionicons } from '@expo/vector-icons'
import { useMemo, useState } from 'react'
import {
	ActivityIndicator,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

type TabKey = 'stats' | 'catalog'

const TABS: { key: TabKey; label: string }[] = [
	{ key: 'stats', label: 'Stats' },
	{ key: 'catalog', label: 'Bonuses & curses' },
]

const BONUS_SETS: { set: Bonus['set']; label: string }[] = [
	{ set: '1', label: 'Set 1' },
	{ set: '2', label: 'Set 2' },
	{ set: '3', label: 'Set 3' },
]

// Player counts behind each GameSize, for the catalog's filter menu. The
// labels double as the phrasing in a withheld card's note ("Not dealt in
// 2-player games").
const CATALOG_SIZES: { size: GameSize; label: string }[] = [
	{ size: 'small', label: '2-player' },
	{ size: 'standard', label: '3-4 player' },
	{ size: 'expanded', label: '5-6 player' },
]

// The size every card's description is written against, and so the one the
// catalog always reads: the filter is a lens on the sample, not a mode the
// card is read in. See .claude/specs/card-stats-filter.md.
const BASELINE_SIZE: GameSize = 'standard'

function sizeLabelsFor(sizes: GameSize[]): string {
	const labels = CATALOG_SIZES.filter((s) => sizes.includes(s.size)).map(
		(s) => s.label
	)
	if (labels.length <= 1) return labels[0] ?? ''
	return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`
}

// Grid width at or above which the catalog uses 3 columns; narrower (phones in
// portrait) drops to 2.
const CATALOG_THREE_COL_MIN = 480

export default function StatsScreen() {
	const { user } = useAuth()
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const results = useStatsStore((s) => s.results)
	const error = useStatsStore((s) => s.error)
	const completeGames = useGamesStore((s) => s.completeGames)
	const profilesById = useGamesStore((s) => s.profilesById)
	const [tab, setTab] = useState<TabKey>('stats')
	const activeIndex = TABS.findIndex((t) => t.key === tab)

	const loaded = results !== undefined && completeGames !== undefined
	const stats = useMemo(
		() => computeStats(results ?? [], completeGames ?? [], user?.id ?? ''),
		[results, completeGames, user?.id]
	)

	return (
		<SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
			<TabBar tab={tab} onTab={setTab} />
			<ScrollView contentContainerStyle={styles.container}>
				<SlidingArea index={activeIndex}>
					<StatsTab
						loaded={loaded}
						error={error}
						stats={stats}
						profilesById={profilesById}
					/>
					<CatalogTab />
				</SlidingArea>
			</ScrollView>
		</SafeAreaView>
	)
}

function TabBar({ tab, onTab }: { tab: TabKey; onTab: (t: TabKey) => void }) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<View style={styles.tabBar}>
			{TABS.map((t) => {
				const active = t.key === tab
				return (
					<Pressable
						key={t.key}
						style={[styles.tab, active && styles.tabActive]}
						onPress={() => onTab(t.key)}
					>
						<Text
							style={[
								styles.tabLabel,
								active && styles.tabLabelActive,
							]}
						>
							{t.label}
						</Text>
					</Pressable>
				)
			})}
		</View>
	)
}

function StatsTab({
	loaded,
	error,
	stats,
	profilesById,
}: {
	loaded: boolean
	error: string | null
	stats: ReturnType<typeof computeStats>
	profilesById: Record<string, Profile>
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])

	if (!loaded) return <ActivityIndicator color={colors.textMuted} />
	if (error) return <Text style={styles.error}>{error}</Text>
	if (stats.gamesPlayed === 0) {
		return (
			<Text style={styles.emptyText}>Play a game to see your stats.</Text>
		)
	}

	return (
		<View style={styles.pane}>
			<View style={styles.section}>
				<Text style={styles.sectionHeading}>Games</Text>
				<View style={styles.grid}>
					<StatTile
						label="Win rate"
						value={percent(stats.winRate)}
						sub={`${stats.wins} of ${stats.gamesPlayed} games`}
					/>
					<StatTile
						label="Avg points"
						value={oneDecimal(stats.avgPoints)}
					/>
					<StatTile
						label="Avg place"
						value={oneDecimal(stats.avgPlacement)}
						sub={`of ${oneDecimal(stats.avgPlayers)}`}
					/>
					<StatTile
						label="Avg rounds"
						value={oneDecimal(stats.avgRounds)}
					/>
					<StatTile
						label="Avg players"
						value={oneDecimal(stats.avgPlayers)}
					/>
				</View>
				{/* Win rate counts every game; the averages only count the ones
				    played out. Without this the two denominators look like a
				    mistake. */}
				{stats.playedGames < stats.gamesPlayed && (
					<Text style={styles.footnote}>
						Averages exclude {stats.gamesPlayed - stats.playedGames}{' '}
						forfeited{' '}
						{stats.gamesPlayed - stats.playedGames === 1
							? 'game'
							: 'games'}
						.
					</Text>
				)}
			</View>

			<View style={styles.section}>
				<Text style={styles.sectionHeading}>Friends</Text>
				<View style={styles.grid}>
					<StatTile
						label="People played with"
						value={String(stats.distinctOpponents)}
					/>
				</View>
				{stats.topOpponents.map((o) => (
					<OpponentRow
						key={o.userId}
						profile={profilesById[o.userId]}
						games={o.games}
					/>
				))}
			</View>

			{stats.bonusGames > 0 && (
				<View style={styles.section}>
					<Text style={styles.sectionHeading}>Bonuses</Text>
					<View style={styles.grid}>
						<StatTile
							label="Bonuses played"
							value={String(stats.bonusesPlayed)}
							sub={`of ${stats.bonusPoolSize}`}
						/>
						<StatTile
							label="Curses played"
							value={String(stats.cursesPlayed)}
							sub={`of ${stats.cursePoolSize}`}
						/>
					</View>
					{stats.topPickRate && (
						<CardRateRow
							label="Most picked"
							rate={stats.topPickRate}
							unit="offers"
						/>
					)}
					{stats.topCursePickRate && (
						<CardRateRow
							label="Most picked curse"
							rate={stats.topCursePickRate}
							unit="offers"
							kind="curse"
						/>
					)}
					{stats.topWinRate && (
						<CardRateRow
							label="Best win rate"
							rate={stats.topWinRate}
							unit="games"
						/>
					)}
				</View>
			)}
		</View>
	)
}

function CatalogTab() {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	// Global play numbers, everyone's games — see
	// .claude/specs/card-global-stats.md. Undefined until loaded, which the
	// cells render as no footer at all rather than a skeleton.
	const cardStats = useStatsStore((s) => s.cardStats)
	// Which table sizes the numbers are measured over. All of them by default:
	// the sample is small enough that splitting it three ways leaves most cards
	// reading "No games yet".
	const [sizes, setSizes] = useState<GameSize[]>([...GAME_SIZES])
	const statsByCard = useMemo(
		() => (cardStats ? indexCardStats(cardStats, sizes) : undefined),
		[cardStats, sizes]
	)
	// Measure the grid's real width rather than deriving it from the window —
	// safe-area insets / max-width can leave the content narrower than the
	// screen, which would misjudge how many columns fit.
	const [gridWidth, setGridWidth] = useState(0)
	const columns = gridWidth >= CATALOG_THREE_COL_MIN ? 3 : 2
	// Fixed column width so full rows are even and a short final row keeps its
	// column widths instead of stretching to fill.
	const cardWidth =
		gridWidth > 0
			? Math.floor((gridWidth - (columns - 1) * spacing.sm) / columns)
			: 0
	// Only shown on a card withheld from every checked size, so it can name
	// them all — there is no size left where the card is dealt.
	const unavailableNote = `Not dealt in ${sizeLabelsFor(sizes)} games`
	return (
		<View
			style={styles.pane}
			onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
		>
			<CatalogFilter sizes={sizes} onSizes={setSizes} />
			{cardWidth > 0 && (
				<>
					{BONUS_SETS.map(({ set, label }) => (
						<View key={set} style={styles.section}>
							<Text style={styles.sectionHeading}>{label}</Text>
							<View style={styles.cardGrid}>
								{BONUS_POOL.filter((b) => b.set === set).map(
									(b) => (
										<CardCell
											key={b.id}
											card={b}
											description={bonusDescriptionFor(
												b.id,
												BASELINE_SIZE
											)}
											unavailable={sizes.every(
												(s) =>
													!isBonusAvailableAt(b.id, s)
											)}
											unavailableNote={unavailableNote}
											tint={colors.success}
											width={cardWidth}
											stats={statsByCard}
											kind="bonus"
										/>
									)
								)}
							</View>
						</View>
					))}

					<View style={styles.section}>
						<Text style={styles.sectionHeading}>Curses</Text>
						<View style={styles.cardGrid}>
							{CURSE_POOL.map((c) => (
								<CardCell
									key={c.id}
									card={c}
									description={curseDescriptionFor(
										c.id,
										BASELINE_SIZE
									)}
									unavailable={sizes.every(
										(s) => !isCurseAvailableAt(c.id, s)
									)}
									unavailableNote={unavailableNote}
									tint={colors.error}
									width={cardWidth}
									stats={statsByCard}
									kind="curse"
								/>
							))}
						</View>
					</View>
				</>
			)}
		</View>
	)
}

// The catalog's one filter: an icon that opens a menu of table sizes to
// measure the numbers over. Built for more controls than it has — a second one
// goes in the same sheet, under its own heading.
function CatalogFilter({
	sizes,
	onSizes,
}: {
	sizes: GameSize[]
	onSizes: (s: GameSize[]) => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const [open, setOpen] = useState(false)
	const narrowed = sizes.length < GAME_SIZES.length

	function toggle(size: GameSize) {
		// The last checked size doesn't uncheck: with none checked there is no
		// table for the catalog to describe, and every cell would need a fourth
		// empty state.
		if (sizes.includes(size)) {
			if (sizes.length === 1) return
			onSizes(sizes.filter((s) => s !== size))
		} else {
			onSizes(GAME_SIZES.filter((s) => s === size || sizes.includes(s)))
		}
	}

	return (
		<View style={styles.filterBar}>
			<Pressable
				onPress={() => setOpen(true)}
				style={({ pressed }) => [
					styles.filterButton,
					pressed && styles.pressed,
				]}
				accessibilityRole="button"
				accessibilityLabel="Filter catalog"
			>
				<Ionicons
					name="filter"
					size={18}
					color={narrowed ? colors.brand : colors.textSecondary}
				/>
				{/* The trigger carries no text, so this dot is the only sign
				    that the numbers are measured over less than everything. */}
				{narrowed && <View style={styles.filterDot} />}
			</Pressable>

			<Modal
				visible={open}
				onDismiss={() => setOpen(false)}
				contentStyle={styles.filterSheet}
			>
				<Text style={styles.filterSheetTitle}>Players</Text>
				{CATALOG_SIZES.map((s) => {
					const checked = sizes.includes(s.size)
					return (
						<Pressable
							key={s.size}
							onPress={() => toggle(s.size)}
							style={({ pressed }) => [
								styles.filterRow,
								pressed && styles.pressed,
							]}
						>
							<Text
								style={[
									styles.filterLabel,
									checked && styles.filterLabelChecked,
								]}
							>
								{s.label}
							</Text>
							<Ionicons
								name={checked ? 'checkbox' : 'square-outline'}
								size={20}
								color={
									checked ? colors.brand : colors.textMuted
								}
							/>
						</Pressable>
					)
				})}
			</Modal>
		</View>
	)
}

function CardCell({
	card,
	description,
	unavailable,
	unavailableNote,
	tint,
	width,
	stats,
	kind,
}: {
	card: Bonus | Curse
	description: string
	unavailable: boolean
	unavailableNote: string
	tint: string
	width: number
	// Undefined while the global numbers are still loading.
	stats: Map<string, CardStat> | undefined
	kind: 'bonus' | 'curse'
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<View
			style={[
				styles.cardCell,
				{ width },
				unavailable && styles.cardCellUnavailable,
			]}
		>
			<View style={styles.cardIcon}>
				<Ionicons name={card.icon} size={22} color={tint} />
			</View>
			<Text style={styles.cardTitle}>{card.title}</Text>
			<Text style={styles.cardDescription}>{description}</Text>
			{unavailable ? (
				<Text style={styles.cardUnavailable}>{unavailableNote}</Text>
			) : (
				stats && (
					<CardStatFooter
						stat={stats.get(cardStatKey(kind, card.id))}
					/>
				)
			)}
		</View>
	)
}

// Everyone's games with this card, over the checked table sizes. The sample is
// always printed: there is no minimum-games filter, so a 100% off three games
// has to be able to read as what it is.
function CardStatFooter({ stat }: { stat: CardStat | undefined }) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	if (!stat) {
		return (
			<View style={styles.statFooter}>
				<Text style={styles.statSample}>No games yet</Text>
			</View>
		)
	}
	return (
		<View style={styles.statFooter}>
			<View style={styles.statRow}>
				<StatCol
					value={stat.winRate === null ? '—' : percent(stat.winRate)}
					label="win"
				/>
				<StatCol
					value={
						stat.avgPoints === null
							? '—'
							: oneDecimal(stat.avgPoints)
					}
					label="pts"
				/>
				{/* Dropped rather than dashed when nothing was ever a real
				    choice — curses were dealt one per player until Aug 2026, so
				    a column of em-dashes would be most of the catalog. */}
				{stat.pickRate !== null && (
					<StatCol value={percent(stat.pickRate)} label="picked" />
				)}
			</View>
			<Text style={styles.statSample}>{plural(stat.games, 'game')}</Text>
		</View>
	)
}

function StatCol({ value, label }: { value: string; label: string }) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<View style={styles.statCol}>
			<Text style={styles.statValue}>{value}</Text>
			<Text style={styles.statLabel}>{label}</Text>
		</View>
	)
}

function StatTile({
	label,
	value,
	sub,
}: {
	label: string
	value: string
	sub?: string
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<View style={styles.tile}>
			<Text style={styles.tileValue}>{value}</Text>
			<Text style={styles.tileLabel}>{label}</Text>
			{sub ? <Text style={styles.tileSub}>{sub}</Text> : null}
		</View>
	)
}

function OpponentRow({
	profile,
	games,
}: {
	profile: Profile | undefined
	games: number
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<View style={styles.row}>
			<Avatar profile={profile} size={40} />
			<Text style={styles.rowText} numberOfLines={1}>
				{profile?.username ?? '…'}
			</Text>
			<Text style={styles.rowValue}>
				{games} {games === 1 ? 'game' : 'games'}
			</Text>
		</View>
	)
}

function CardRateRow({
	label,
	rate,
	unit,
	kind = 'bonus',
}: {
	label: string
	rate: CardRate
	unit: string
	// Which pool `rate.id` names — the rate itself carries only the id.
	kind?: 'bonus' | 'curse'
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const card = kind === 'curse' ? curseById(rate.id) : bonusById(rate.id)
	return (
		<View style={styles.row}>
			<Ionicons
				name={
					card?.icon ??
					(kind === 'curse' ? 'skull-outline' : 'sparkles-outline')
				}
				size={24}
				color={colors.text}
				style={styles.rowIcon}
			/>
			<View style={styles.rowStack}>
				<Text style={styles.rowPrimary} numberOfLines={1}>
					{card?.title ?? rate.id}
				</Text>
				<Text style={styles.rowSecondary}>{label}</Text>
			</View>
			<View style={styles.rowStackEnd}>
				<Text style={styles.rowValue}>{percent(rate.rate)}</Text>
				<Text style={styles.rowSecondary}>
					{rate.hits} of {rate.total} {unit}
				</Text>
			</View>
		</View>
	)
}

function percent(rate: number): string {
	return `${Math.round(rate * 100)}%`
}

function oneDecimal(value: number): string {
	return value.toFixed(1)
}

function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		safe: {
			flex: 1,
			backgroundColor: colors.background,
		},
		container: {
			padding: spacing.lg,
			gap: spacing.lg,
		},
		tabBar: {
			flexDirection: 'row',
			alignItems: 'baseline',
			gap: spacing.xl,
			paddingHorizontal: spacing.lg,
			paddingTop: spacing.lg,
			paddingBottom: spacing.sm,
		},
		tab: {
			// Layout only; the header look lives on the label.
		},
		tabActive: {},
		tabLabel: {
			fontSize: font.xl * 0.95,
			fontWeight: '700',
			color: colors.textMuted,
		},
		tabLabelActive: {
			fontSize: font.xl,
			color: colors.text,
		},
		pane: {
			gap: spacing.lg,
		},
		section: {
			gap: spacing.sm,
		},
		footnote: {
			fontSize: font.xs,
			color: colors.textMuted,
		},
		sectionHeading: {
			fontSize: font.sm,
			fontWeight: '600',
			letterSpacing: 0.5,
			textTransform: 'uppercase',
			color: colors.textSecondary,
		},
		grid: {
			flexDirection: 'row',
			flexWrap: 'wrap',
			gap: spacing.sm,
		},
		tile: {
			// Two per row; the basis leaves room for the grid gap.
			flexBasis: '48%',
			flexGrow: 1,
			gap: 2,
			padding: spacing.md,
			borderWidth: 1,
			borderColor: colors.border,
			backgroundColor: colors.card,
			borderRadius: radius.md,
		},
		tileValue: {
			fontSize: font.xl,
			fontWeight: '700',
			color: colors.text,
		},
		tileLabel: {
			fontSize: font.base,
			color: colors.textSecondary,
		},
		tileSub: {
			fontSize: font.sm,
			color: colors.textMuted,
		},
		row: {
			flexDirection: 'row',
			alignItems: 'center',
			gap: spacing.sm,
			paddingVertical: spacing.sm,
			paddingHorizontal: spacing.md,
			borderWidth: 1,
			borderColor: colors.border,
			backgroundColor: colors.card,
			borderRadius: radius.md,
		},
		rowIcon: {
			width: 40,
			textAlign: 'center',
		},
		rowStack: {
			flex: 1,
			gap: 2,
		},
		rowStackEnd: {
			alignItems: 'flex-end',
			gap: 2,
		},
		rowText: {
			flex: 1,
			fontSize: font.md,
			color: colors.text,
		},
		rowPrimary: {
			fontSize: font.md,
			color: colors.text,
		},
		rowValue: {
			fontSize: font.md,
			fontWeight: '600',
			color: colors.text,
		},
		rowSecondary: {
			fontSize: font.sm,
			color: colors.textMuted,
		},
		cardGrid: {
			flexDirection: 'row',
			flexWrap: 'wrap',
			gap: spacing.sm,
		},
		filterBar: {
			flexDirection: 'row',
			justifyContent: 'flex-end',
		},
		filterButton: {
			width: 34,
			height: 34,
			borderRadius: radius.full,
			alignItems: 'center',
			justifyContent: 'center',
			backgroundColor: colors.cardAlt,
			borderWidth: 1,
			borderColor: colors.border,
		},
		filterDot: {
			position: 'absolute',
			top: 4,
			right: 4,
			width: 7,
			height: 7,
			borderRadius: radius.full,
			backgroundColor: colors.brand,
		},
		pressed: {
			opacity: 0.7,
		},
		filterSheet: {
			width: '100%',
			maxWidth: 420,
			backgroundColor: colors.card,
			borderRadius: radius.md,
			padding: spacing.lg,
			gap: spacing.xs,
		},
		filterSheetTitle: {
			fontSize: font.lg,
			fontWeight: '700',
			color: colors.text,
		},
		filterRow: {
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'space-between',
			paddingVertical: spacing.sm,
		},
		filterLabel: {
			fontSize: font.base,
			color: colors.text,
		},
		filterLabelChecked: {
			color: colors.brand,
			fontWeight: '600',
		},
		cardCell: {
			// Width is set inline (fixed column width). No fixed height: the
			// grid's default cross-axis stretch makes every card in a row match
			// the tallest one, so rows stay even without truncating text.
			alignItems: 'center',
			gap: spacing.xs,
			padding: spacing.md,
			borderWidth: 1,
			borderColor: colors.border,
			backgroundColor: colors.card,
			borderRadius: radius.md,
		},
		cardCellUnavailable: {
			opacity: 0.5,
		},
		cardUnavailable: {
			fontSize: font.xs,
			fontStyle: 'italic',
			color: colors.textMuted,
			textAlign: 'center',
		},
		cardIcon: {
			width: 40,
			height: 40,
			borderRadius: radius.full,
			alignItems: 'center',
			justifyContent: 'center',
			backgroundColor: colors.background,
			borderWidth: 1,
			borderColor: colors.border,
		},
		cardTitle: {
			fontSize: font.base,
			fontWeight: '700',
			color: colors.text,
			textAlign: 'center',
		},
		cardDescription: {
			fontSize: font.xs,
			color: colors.textSecondary,
			textAlign: 'center',
		},
		statFooter: {
			// Pushed to the bottom of a cell that stretches to its row's
			// tallest, so the numbers sit under the description however long
			// it ran.
			marginTop: 'auto',
			alignSelf: 'stretch',
			paddingTop: spacing.xs,
			borderTopWidth: 1,
			borderTopColor: colors.border,
			gap: 2,
		},
		statRow: {
			flexDirection: 'row',
		},
		statCol: {
			flex: 1,
			alignItems: 'center',
		},
		statValue: {
			fontSize: font.sm,
			fontWeight: '700',
			color: colors.text,
		},
		statLabel: {
			fontSize: font.xs,
			color: colors.textMuted,
		},
		statSample: {
			fontSize: font.xs,
			color: colors.textMuted,
			textAlign: 'center',
		},
		emptyText: {
			fontSize: font.base,
			color: colors.textMuted,
			textAlign: 'center',
			marginTop: spacing.xl,
		},
		error: {
			fontSize: font.base,
			color: colors.error,
			textAlign: 'center',
			marginTop: spacing.xl,
		},
	})
}
