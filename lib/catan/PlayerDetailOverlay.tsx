// Modal overlay rendered when the user taps a player card in the strip.
// Shows the player's avatar + name, their point/card totals, what's left in
// their piece supply, and — if the game is running with bonuses — the full
// bonus and curse cards they hold, plus an investor's set-aside investment
// tokens (public to the whole table).

import { Avatar } from '@/lib/modules/Avatar'
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Modal } from '../modules/Modal'
import type { Profile } from '../stores/useProfileStore'
import { colors, font, radius, spacing } from '../theme'
import { RESOURCES } from './board'
import {
	INVEST_TRIO,
	INVESTOR_MAX_TOKENS,
	METROPOLITAN_SUPER_CITY_CAP,
	superCityCount,
} from './bonus'
import {
	bonusById,
	bonusDescriptionFor,
	curseById,
	curseDescriptionFor,
} from './bonuses'
import {
	cityCountFor,
	curseOf,
	maxCitiesFor,
	maxRoadsFor,
	maxSettlementsFor,
	roadCountFor,
	settlementCountFor,
} from './curses'
import { knightsPlayed } from './dev'
import { longestRoadFor } from './longestRoad'
import { seatColor } from './palette'
import { CardFan, type CardFanEntry } from './ResourceHand'
import { gameSizeFor, type GameState, type PlayerState } from './types'

export type PlayerDetailOverlayProps = {
	playerIdx: number | null
	playerOrder: string[]
	meIdx: number
	profilesById: Record<string, Profile>
	gameState: GameState
	// Already-resolved display VP per player. See PlayerStrip /
	// GameContext for the selection rule.
	pointsByPlayer: number[]
	// Strictly-public VP per player (excludes hidden VP cards). When this is
	// lower than `pointsByPlayer[i]`, the overlay renders `public (revealed)`
	// in the Points chip — same convention as PlayerStrip.
	publicByPlayer: number[]
	onClose: () => void
}

export function PlayerDetailOverlay({
	playerIdx,
	playerOrder,
	meIdx,
	profilesById,
	gameState,
	pointsByPlayer,
	publicByPlayer,
	onClose,
}: PlayerDetailOverlayProps) {
	const open = playerIdx !== null
	return (
		<Modal visible={open} onDismiss={onClose} contentStyle={styles.sheet}>
			{playerIdx !== null && (
				<Body
					playerIdx={playerIdx}
					playerOrder={playerOrder}
					meIdx={meIdx}
					profilesById={profilesById}
					gameState={gameState}
					points={pointsByPlayer[playerIdx] ?? 0}
					publicPoints={
						publicByPlayer[playerIdx] ??
						pointsByPlayer[playerIdx] ??
						0
					}
					onClose={onClose}
				/>
			)}
		</Modal>
	)
}

function Body({
	playerIdx,
	playerOrder,
	meIdx,
	profilesById,
	gameState,
	points,
	publicPoints,
	onClose,
}: {
	playerIdx: number
	playerOrder: string[]
	meIdx: number
	profilesById: Record<string, Profile>
	gameState: GameState
	points: number
	publicPoints: number
	onClose: () => void
}) {
	const uid = playerOrder[playerIdx]
	const profile = profilesById[uid]
	const name = playerIdx === meIdx ? 'You' : (profile?.username ?? 'Player')
	const color = seatColor(gameState, playerIdx)
	const player = gameState.players[playerIdx]
	const cards = sumResources(player?.resources)
	const bonus = player?.bonus ? bonusById(player.bonus) : undefined
	const curse = player?.curse ? curseById(player.curse) : undefined
	const size = gameSizeFor(gameState.players.length)
	const showBonuses = gameState.config.bonuses
	const showDevCards = gameState.config.devCards
	const devCount = player?.devCards?.length ?? 0
	const knights = player ? knightsPlayed(player) : 0
	const hasLargestArmy = gameState.largestArmy === playerIdx
	const longestRoadLen = longestRoadFor(gameState, playerIdx)
	const hasLongestRoad = gameState.longestRoad === playerIdx

	return (
		<>
			<View style={styles.header}>
				<View style={[styles.colorBar, { backgroundColor: color }]} />
				<View style={styles.headerRow}>
					{profile ? (
						<Avatar profile={profile} size={56} />
					) : (
						<View style={styles.avatarPlaceholder} />
					)}
					<View style={styles.headerText}>
						<Text style={styles.name}>{name}</Text>
						{profile && playerIdx !== meIdx && (
							<Text style={styles.handle}>
								@{profile.username}
							</Text>
						)}
					</View>
					<Pressable
						onPress={onClose}
						hitSlop={8}
						style={({ pressed }) => [
							styles.closeBtn,
							pressed && styles.pressed,
						]}
					>
						<Ionicons name="close" size={22} color={colors.text} />
					</Pressable>
				</View>
			</View>

			<View style={styles.statsRow}>
				<StatChip
					icon="trophy-outline"
					label="Points"
					value={
						points > publicPoints
							? `${publicPoints} (${points})`
							: points
					}
				/>
				<StatChip icon="albums-outline" label="Cards" value={cards} />
				{showDevCards && <DevChip count={devCount} />}
			</View>

			<View style={styles.statsRow}>
				{showDevCards && (
					<ArmyChip
						knights={knights}
						hasLargestArmy={hasLargestArmy}
					/>
				)}
				<RoadChip
					length={longestRoadLen}
					hasLongestRoad={hasLongestRoad}
				/>
			</View>

			<View style={styles.piecesWrap}>
				<PiecesBlock
					gameState={gameState}
					playerIdx={playerIdx}
					color={color}
				/>
			</View>

			{showBonuses && (
				<View style={styles.cardsColumn}>
					{bonus ? (
						<CardBlock
							icon={bonus.icon}
							iconColor={colors.brand}
							title={bonus.title}
							description={bonusDescriptionFor(bonus.id, size)}
							tag="Bonus"
							tagColor={colors.brand}
							borderColor={colors.brand}
						/>
					) : (
						<EmptyCardBlock
							label={
								playerIdx === meIdx
									? 'No bonus yet.'
									: 'Bonus hidden until picked.'
							}
						/>
					)}
					{player?.bonus === 'investor' && (
						<InvestmentsBlock investments={player.investments} />
					)}
					{curse ? (
						<CardBlock
							icon={curse.icon}
							iconColor={colors.error}
							title={curse.title}
							description={curseDescriptionFor(curse.id, size)}
							tag="Curse"
							tagColor={colors.error}
							borderColor={colors.error}
						/>
					) : (
						<EmptyCardBlock label="No curse assigned." />
					)}
				</View>
			)}
		</>
	)
}

function StatChip({
	icon,
	label,
	value,
}: {
	icon: React.ComponentProps<typeof Ionicons>['name']
	label: string
	value: number | string
}) {
	return (
		<View style={styles.chip}>
			<Ionicons name={icon} size={16} color={colors.textSecondary} />
			<Text style={styles.chipValue}>{value}</Text>
			<Text style={styles.chipLabel}>{label}</Text>
		</View>
	)
}

function DevChip({ count }: { count: number }) {
	return (
		<View style={styles.chip}>
			<MaterialCommunityIcons
				name="script-text-outline"
				size={16}
				color={colors.textSecondary}
			/>
			<Text style={styles.chipValue}>{count}</Text>
			<Text style={styles.chipLabel}>Dev</Text>
		</View>
	)
}

function ArmyChip({
	knights,
	hasLargestArmy,
}: {
	knights: number
	hasLargestArmy: boolean
}) {
	const tint = hasLargestArmy ? colors.brand : colors.textSecondary
	return (
		<View
			style={[
				styles.chip,
				hasLargestArmy && { borderColor: colors.brand },
			]}
		>
			<MaterialCommunityIcons name="sword" size={16} color={tint} />
			<Text style={[styles.chipValue, { color: tint }]}>{knights}</Text>
			<Text style={[styles.chipLabel, { color: tint }]}>Army</Text>
		</View>
	)
}

function RoadChip({
	length,
	hasLongestRoad,
}: {
	length: number
	hasLongestRoad: boolean
}) {
	const tint = hasLongestRoad ? colors.brand : colors.textSecondary
	return (
		<View
			style={[
				styles.chip,
				hasLongestRoad && { borderColor: colors.brand },
			]}
		>
			<MaterialCommunityIcons
				name="road-variant"
				size={16}
				color={tint}
			/>
			<Text style={[styles.chipValue, { color: tint }]}>{length}</Text>
			<Text style={[styles.chipLabel, { color: tint }]}>Road</Text>
		</View>
	)
}

// What's left of the player's supply, read through the same helpers the build
// gates use — so a curse that shrinks a cap (compaction, decadence, elitism) is
// reflected here without this file knowing which curses those are. Public
// either way: every piece it counts is already visible on the board.
function PiecesBlock({
	gameState,
	playerIdx,
	color,
}: {
	gameState: GameState
	playerIdx: number
	color: string
}) {
	const curse = curseOf(gameState, playerIdx)
	const cities = cityCountFor(gameState, playerIdx)
	const isMetropolitan =
		gameState.players[playerIdx]?.bonus === 'metropolitan'
	return (
		<View style={styles.piecesBlock}>
			<View style={styles.piecesHeader}>
				<MaterialCommunityIcons
					name="cube-outline"
					size={16}
					color={colors.textSecondary}
				/>
				<Text style={styles.piecesTitle}>Pieces left</Text>
			</View>
			<View style={styles.piecesRow}>
				<PieceCount
					icon="road-variant"
					label="Roads"
					color={color}
					used={roadCountFor(gameState, playerIdx)}
					cap={maxRoadsFor(curse)}
				/>
				<PieceCount
					icon="home-outline"
					label="Settlements"
					color={color}
					used={settlementCountFor(gameState, playerIdx)}
					cap={maxSettlementsFor(curse, cities)}
				/>
				<PieceCount
					icon="city"
					label="Cities"
					color={color}
					used={cities}
					cap={maxCitiesFor(curse)}
				/>
				{/* A super city is its own one-piece supply, and upgrading a city
				    into one hands a city back — so without this the city count
				    would tick up for no visible reason. */}
				{isMetropolitan && (
					<PieceCount
						icon="castle"
						label="Super city"
						color={color}
						used={superCityCount(gameState, playerIdx)}
						cap={METROPOLITAN_SUPER_CITY_CAP}
					/>
				)}
			</View>
		</View>
	)
}

function PieceCount({
	icon,
	label,
	color,
	used,
	cap,
}: {
	icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']
	label: string
	color: string
	used: number
	cap: number
}) {
	const left = Math.max(0, cap - used)
	return (
		<View style={styles.piece}>
			<MaterialCommunityIcons
				name={icon}
				size={20}
				color={left === 0 ? colors.textMuted : color}
			/>
			<Text style={styles.pieceValue}>
				{left}
				<Text style={styles.pieceCap}> / {cap}</Text>
			</Text>
			<Text style={styles.pieceLabel}>{label}</Text>
		</View>
	)
}

function CardBlock({
	icon,
	iconColor,
	title,
	description,
	tag,
	tagColor,
	borderColor,
}: {
	icon: React.ComponentProps<typeof Ionicons>['name']
	iconColor: string
	title: string
	description: string
	tag: string
	tagColor: string
	borderColor: string
}) {
	return (
		<View style={[styles.cardBlock, { borderColor }]}>
			<View style={styles.cardHeader}>
				<View style={[styles.cardIcon, { borderColor: borderColor }]}>
					<Ionicons name={icon} size={28} color={iconColor} />
				</View>
				<View style={styles.cardHeaderText}>
					<Text style={[styles.cardTag, { color: tagColor }]}>
						{tag}
					</Text>
					<Text style={styles.cardTitle}>{title}</Text>
				</View>
			</View>
			<Text style={styles.cardDescription}>{description}</Text>
		</View>
	)
}

function EmptyCardBlock({ label }: { label: string }) {
	return (
		<View style={styles.emptyBlock}>
			<Text style={styles.emptyText}>{label}</Text>
		</View>
	)
}

// An investor's set-aside trios, visible to the whole table. Each token pays 1
// of its resource once the investor's roll resolves, so the fan doubles as
// "what they collect every turn".
function InvestmentsBlock({
	investments,
}: {
	investments: PlayerState['investments']
}) {
	const entries: CardFanEntry[] = RESOURCES.filter(
		(r) => (investments?.[r] ?? 0) > 0
	).map((r) => ({ resource: r, count: investments?.[r] ?? 0 }))
	const tokens = entries.reduce((n, e) => n + e.count, 0)
	return (
		<View style={styles.investBlock}>
			<View style={styles.investHeader}>
				<Ionicons
					name="trending-up-outline"
					size={16}
					color={colors.textSecondary}
				/>
				<Text style={styles.investTitle}>Invested</Text>
				<Text style={styles.investTokens}>
					{tokens}/{INVESTOR_MAX_TOKENS} tokens
				</Text>
			</View>
			<CardFan
				entries={entries}
				size="compact"
				emptyLabel="Nothing set aside yet."
			/>
			{tokens > 0 && (
				<Text style={styles.investCaption}>
					{tokens * INVEST_TRIO} cards set aside · +{tokens} after
					each roll
				</Text>
			)}
		</View>
	)
}

function sumResources(
	hand: GameState['players'][number]['resources'] | undefined
): number {
	if (!hand) return 0
	let total = 0
	for (const key in hand) total += hand[key as keyof typeof hand] ?? 0
	return total
}

const styles = StyleSheet.create({
	sheet: {
		width: '100%',
		maxWidth: 460,
		backgroundColor: colors.background,
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: colors.border,
		overflow: 'hidden',
	},
	header: {
		padding: spacing.md,
		paddingTop: spacing.lg,
	},
	colorBar: {
		position: 'absolute',
		top: 0,
		left: 0,
		right: 0,
		height: 4,
	},
	headerRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.md,
	},
	headerText: {
		flex: 1,
		gap: 2,
	},
	name: {
		fontSize: font.lg,
		fontWeight: '700',
		color: colors.text,
	},
	handle: {
		fontSize: font.sm,
		color: colors.textMuted,
	},
	avatarPlaceholder: {
		width: 56,
		height: 56,
		borderRadius: radius.full,
		backgroundColor: colors.border,
	},
	closeBtn: {
		width: 36,
		height: 36,
		borderRadius: radius.full,
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: colors.card,
		borderWidth: 1,
		borderColor: colors.border,
	},
	pressed: {
		opacity: 0.7,
	},
	statsRow: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: spacing.sm,
		paddingHorizontal: spacing.md,
		paddingBottom: spacing.sm,
	},
	chip: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 4,
		paddingHorizontal: spacing.sm,
		paddingVertical: 6,
		borderRadius: radius.full,
		backgroundColor: colors.card,
		borderWidth: 1,
		borderColor: colors.border,
	},
	chipValue: {
		fontSize: font.md,
		fontWeight: '700',
		color: colors.text,
	},
	chipLabel: {
		fontSize: font.sm,
		color: colors.textMuted,
	},
	piecesWrap: {
		paddingHorizontal: spacing.md,
		paddingBottom: spacing.sm,
	},
	piecesBlock: {
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radius.md,
		backgroundColor: colors.card,
		paddingHorizontal: spacing.md,
		paddingVertical: spacing.sm,
		gap: spacing.xs,
	},
	piecesHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
	},
	piecesTitle: {
		fontSize: font.sm,
		fontWeight: '700',
		color: colors.textSecondary,
		textTransform: 'uppercase',
		letterSpacing: 0.5,
	},
	piecesRow: {
		flexDirection: 'row',
	},
	piece: {
		flex: 1,
		alignItems: 'center',
		gap: 2,
	},
	pieceValue: {
		fontSize: font.md,
		fontWeight: '700',
		color: colors.text,
	},
	pieceCap: {
		fontSize: font.sm,
		fontWeight: '400',
		color: colors.textMuted,
	},
	pieceLabel: {
		fontSize: font.xs,
		color: colors.textMuted,
		textAlign: 'center',
	},
	cardsColumn: {
		paddingHorizontal: spacing.md,
		paddingBottom: spacing.md,
		gap: spacing.sm,
	},
	cardBlock: {
		borderWidth: 2,
		borderRadius: radius.md,
		backgroundColor: colors.card,
		padding: spacing.md,
		gap: spacing.xs,
	},
	cardHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
	},
	cardIcon: {
		width: 44,
		height: 44,
		borderRadius: radius.full,
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: colors.background,
		borderWidth: 1,
	},
	cardHeaderText: {
		flex: 1,
		gap: 2,
	},
	cardTag: {
		fontSize: font.xs,
		fontWeight: '700',
		textTransform: 'uppercase',
		letterSpacing: 0.5,
	},
	cardTitle: {
		fontSize: font.md,
		fontWeight: '700',
		color: colors.text,
	},
	cardDescription: {
		fontSize: font.sm,
		color: colors.textSecondary,
	},
	investBlock: {
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radius.md,
		backgroundColor: colors.card,
		paddingHorizontal: spacing.md,
		paddingVertical: spacing.sm,
		gap: spacing.xs,
	},
	investHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
	},
	investTitle: {
		flex: 1,
		fontSize: font.sm,
		fontWeight: '700',
		color: colors.textSecondary,
		textTransform: 'uppercase',
		letterSpacing: 0.5,
	},
	investTokens: {
		fontSize: font.sm,
		color: colors.textMuted,
	},
	investCaption: {
		fontSize: font.sm,
		color: colors.textMuted,
		textAlign: 'center',
	},
	emptyBlock: {
		borderRadius: radius.md,
		backgroundColor: colors.card,
		borderWidth: 1,
		borderColor: colors.border,
		borderStyle: 'dashed',
		padding: spacing.md,
	},
	emptyText: {
		fontSize: font.sm,
		color: colors.textMuted,
		textAlign: 'center',
	},
})
