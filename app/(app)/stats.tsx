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
import type { GameSize } from '@/lib/catan/types'
import { Avatar } from '@/lib/modules/Avatar'
import { SlidingArea } from '@/lib/modules/SlidingArea'
import { computeStats, type CardRate } from '@/lib/stats'
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

// Player counts behind each GameSize, for the catalog's size picker. The
// labels double as the phrasing in a withheld card's note ("Not dealt in
// 2-player games").
const CATALOG_SIZES: { size: GameSize; label: string }[] = [
	{ size: 'small', label: '2-player' },
	{ size: 'standard', label: '3-4 player' },
	{ size: 'expanded', label: '5-6 player' },
]

function sizeLabelFor(size: GameSize): string {
	return CATALOG_SIZES.find((s) => s.size === size)?.label ?? ''
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
		<SafeAreaView style={styles.safe}>
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
	// The catalog is read outside any game, so the table size it describes is
	// the reader's choice. Defaults to the 3-4 player baseline the pool
	// descriptions are written against.
	const [size, setSize] = useState<GameSize>('standard')
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
	return (
		<View
			style={styles.pane}
			onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
		>
			<SizeSelector size={size} onSize={setSize} />
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
												size
											)}
											unavailable={
												!isBonusAvailableAt(b.id, size)
											}
											size={size}
											tint={colors.success}
											width={cardWidth}
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
										size
									)}
									unavailable={
										!isCurseAvailableAt(c.id, size)
									}
									size={size}
									tint={colors.error}
									width={cardWidth}
								/>
							))}
						</View>
					</View>
				</>
			)}
		</View>
	)
}

// Segmented pill row picking which table size the catalog describes.
function SizeSelector({
	size,
	onSize,
}: {
	size: GameSize
	onSize: (s: GameSize) => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<View style={styles.sizeControl}>
			{CATALOG_SIZES.map((s) => {
				const active = s.size === size
				return (
					<Pressable
						key={s.size}
						style={[
							styles.sizePill,
							active && styles.sizePillActive,
						]}
						onPress={() => onSize(s.size)}
					>
						<Text
							style={[
								styles.sizeLabel,
								active && styles.sizeLabelActive,
							]}
						>
							{s.label}
						</Text>
					</Pressable>
				)
			})}
		</View>
	)
}

function CardCell({
	card,
	description,
	unavailable,
	size,
	tint,
	width,
}: {
	card: Bonus | Curse
	description: string
	unavailable: boolean
	size: GameSize
	tint: string
	width: number
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
			{unavailable && (
				<Text style={styles.cardUnavailable}>
					Not dealt in {sizeLabelFor(size)} games
				</Text>
			)}
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
			// Unselected: faded and 5% smaller than the active header.
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
		sizeControl: {
			flexDirection: 'row',
			borderRadius: radius.full,
			padding: 3,
			gap: 2,
			backgroundColor: colors.cardAlt,
			borderWidth: 1,
			borderColor: colors.border,
		},
		sizePill: {
			flex: 1,
			paddingVertical: 6,
			borderRadius: radius.full,
			alignItems: 'center',
		},
		sizePillActive: {
			backgroundColor: colors.brand,
		},
		sizeLabel: {
			fontSize: font.xs,
			fontWeight: '600',
			color: colors.textSecondary,
		},
		sizeLabelActive: {
			color: colors.white,
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
