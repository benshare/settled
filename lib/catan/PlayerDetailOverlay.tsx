// Modal overlay rendered when the user taps a player card in the strip.
// Shows the player's avatar + name, their point/card totals, and — if the
// game is running with bonuses — the full bonus and curse cards they hold.

import { Avatar } from '@/lib/modules/Avatar'
import { Ionicons } from '@expo/vector-icons'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import type { Profile } from '../stores/useProfileStore'
import { colors, font, radius, spacing } from '../theme'
import { bonusById, curseById } from './bonuses'
import { playerColors } from './palette'
import type { GameState } from './types'

export type PlayerDetailOverlayProps = {
	playerIdx: number | null
	playerOrder: string[]
	meIdx: number
	profilesById: Record<string, Profile>
	gameState: GameState
	onClose: () => void
}

export function PlayerDetailOverlay({
	playerIdx,
	playerOrder,
	meIdx,
	profilesById,
	gameState,
	onClose,
}: PlayerDetailOverlayProps) {
	const open = playerIdx !== null
	return (
		<Modal
			visible={open}
			transparent
			animationType="fade"
			onRequestClose={onClose}
		>
			<Pressable style={styles.backdrop} onPress={onClose}>
				<Pressable style={styles.sheet} onPress={() => {}}>
					{playerIdx !== null && (
						<Body
							playerIdx={playerIdx}
							playerOrder={playerOrder}
							meIdx={meIdx}
							profilesById={profilesById}
							gameState={gameState}
							onClose={onClose}
						/>
					)}
				</Pressable>
			</Pressable>
		</Modal>
	)
}

function Body({
	playerIdx,
	playerOrder,
	meIdx,
	profilesById,
	gameState,
	onClose,
}: {
	playerIdx: number
	playerOrder: string[]
	meIdx: number
	profilesById: Record<string, Profile>
	gameState: GameState
	onClose: () => void
}) {
	const uid = playerOrder[playerIdx]
	const profile = profilesById[uid]
	const name = playerIdx === meIdx ? 'You' : (profile?.username ?? 'Player')
	const color = playerColors[playerIdx] ?? playerColors[0]
	const player = gameState.players[playerIdx]
	const points = pointsFor(gameState, playerIdx)
	const cards = sumResources(player?.resources)
	const bonus = player?.bonus ? bonusById(player.bonus) : undefined
	const curse = player?.curse ? curseById(player.curse) : undefined
	const showBonuses = gameState.config.bonuses

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
						<Ionicons
							name="close"
							size={22}
							color={colors.text}
						/>
					</Pressable>
				</View>
			</View>

			<View style={styles.statsRow}>
				<StatChip
					icon="trophy-outline"
					label="Points"
					value={points}
				/>
				<StatChip
					icon="albums-outline"
					label="Cards"
					value={cards}
				/>
			</View>

			{showBonuses && (
				<View style={styles.cardsColumn}>
					{bonus ? (
						<CardBlock
							icon={bonus.icon}
							iconColor={colors.brand}
							title={bonus.title}
							description={bonus.description}
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
					{curse ? (
						<CardBlock
							icon={curse.icon}
							iconColor={colors.error}
							title={curse.title}
							description={curse.description}
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
	value: number
}) {
	return (
		<View style={styles.chip}>
			<Ionicons name={icon} size={16} color={colors.textSecondary} />
			<Text style={styles.chipValue}>{value}</Text>
			<Text style={styles.chipLabel}>{label}</Text>
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
				<View
					style={[
						styles.cardIcon,
						{ borderColor: borderColor },
					]}
				>
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

function pointsFor(gameState: GameState, playerIdx: number): number {
	let total = 0
	for (const v of Object.values(gameState.vertices)) {
		if (!v?.occupied || v.player !== playerIdx) continue
		total += v.building === 'city' ? 2 : 1
	}
	return total
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
	backdrop: {
		flex: 1,
		backgroundColor: 'rgba(0,0,0,0.35)',
		justifyContent: 'center',
		paddingHorizontal: spacing.lg,
	},
	sheet: {
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
		gap: spacing.sm,
		paddingHorizontal: spacing.md,
		paddingBottom: spacing.md,
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
