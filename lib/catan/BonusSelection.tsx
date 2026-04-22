// Bonus-selection screen. Rendered when gameState.phase.kind ===
// 'select_bonus'. Each player sees two bonus cards (tap to pick one) plus
// their curse card, which is displayed for information only — the curse is
// assigned automatically and follows the player regardless of their pick.
//
// After submit, the local player shows a waiting state until every other
// player has also chosen. When the last player commits, the edge function
// flips the phase to initial_placement; realtime drops this screen out of
// view without any client-side cleanup needed.

import { Button } from '@/lib/modules/Button'
import { useTheme } from '@/lib/ThemeContext'
import { ColorScheme, font, radius, spacing } from '@/lib/theme'
import { Ionicons } from '@expo/vector-icons'
import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import {
	bonusById,
	curseById,
	type Bonus,
	type BonusId,
	type Curse,
} from './bonuses'
import type { SelectBonusHand } from './types'

export type BonusSelectionProps = {
	hand: SelectBonusHand | undefined
	waitingOn: string[] // usernames of players still picking
	submitting: boolean
	onPick: (bonus: BonusId) => void
}

export function BonusSelection({
	hand,
	waitingOn,
	submitting,
	onPick,
}: BonusSelectionProps) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])

	// Track the player's in-flight pick separately from `hand.chosen` so the
	// UI can show a selected state before the realtime update lands.
	const [pick, setPick] = useState<0 | 1 | null>(null)

	if (!hand) {
		// Spectator (or somehow not in the player_order for a select_bonus
		// game). No hand to pick — just show a waiting placeholder.
		return (
			<View style={styles.wrap}>
				<Text style={styles.heading}>Bonus selection</Text>
				<Text style={styles.subheading}>
					Players are choosing their bonus cards.
				</Text>
			</View>
		)
	}

	const committed = hand.chosen !== null
	const offered: Bonus[] = hand.offered.map(
		(id) => bonusById(id) ?? fallbackBonus(id)
	)
	const curse: Curse = curseById(hand.curse) ?? fallbackCurse(hand.curse)

	async function onConfirm() {
		if (pick === null || !hand) return
		onPick(hand.offered[pick])
	}

	return (
		<View style={styles.wrap}>
			<Text style={styles.heading}>Pick your bonus</Text>
			<Text style={styles.subheading}>
				Keep one bonus card. The other will be discarded. Your curse
				card stays either way.
			</Text>

			<View style={styles.bonusRow}>
				{offered.map((b, i) => {
					const isPicked = committed
						? hand.offered[i] === hand.chosen
						: pick === i
					const isDiscarded = committed && !isPicked
					return (
						<Pressable
							key={i}
							onPress={() => !committed && setPick(i as 0 | 1)}
							disabled={committed || submitting}
							style={({ pressed }) => [
								styles.card,
								isPicked && styles.cardPicked,
								isDiscarded && styles.cardFaded,
								pressed && !committed && styles.pressed,
							]}
						>
							<View style={styles.cardIcon}>
								<Ionicons
									name={b.icon}
									size={32}
									color={
										isDiscarded
											? colors.textMuted
											: colors.brand
									}
								/>
							</View>
							<Text style={styles.cardTitle}>{b.title}</Text>
							<Text style={styles.cardDescription}>
								{b.description}
							</Text>
							{isPicked && (
								<View style={styles.cardBadge}>
									<Ionicons
										name="checkmark"
										size={14}
										color={colors.white}
									/>
									<Text style={styles.cardBadgeText}>
										Kept
									</Text>
								</View>
							)}
						</Pressable>
					)
				})}
			</View>

			<View style={[styles.card, styles.curseCard]}>
				<View style={styles.cardIcon}>
					<Ionicons
						name={curse.icon}
						size={32}
						color={colors.error}
					/>
				</View>
				<Text style={styles.cardTitle}>
					{curse.title}{' '}
					<Text style={styles.curseTag}>(curse)</Text>
				</Text>
				<Text style={styles.cardDescription}>{curse.description}</Text>
			</View>

			{committed ? (
				<View style={styles.waitingRow}>
					<Text style={styles.waitingText}>
						{waitingOn.length === 0
							? 'Everyone is ready — starting placement…'
							: `Waiting for ${formatList(waitingOn)} to pick`}
					</Text>
				</View>
			) : (
				<View style={styles.actionRow}>
					<Button
						onPress={onConfirm}
						disabled={pick === null || submitting}
						loading={submitting}
					>
						{pick === null ? 'Pick a bonus' : 'Confirm'}
					</Button>
				</View>
			)}
		</View>
	)
}

function fallbackBonus(id: BonusId): Bonus {
	return {
		id,
		title: 'Unknown bonus',
		description: 'Unrecognized bonus card.',
		icon: 'help',
	}
}

function fallbackCurse(id: string): Curse {
	return {
		id: id as Curse['id'],
		title: 'Unknown curse',
		description: 'Unrecognized curse card.',
		icon: 'help',
	}
}

function formatList(names: string[]): string {
	if (names.length === 0) return ''
	if (names.length === 1) return names[0]
	if (names.length === 2) return `${names[0]} and ${names[1]}`
	return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		wrap: {
			flex: 1,
			padding: spacing.lg,
			gap: spacing.md,
		},
		heading: {
			fontSize: font.lg,
			fontWeight: '700',
			color: colors.text,
		},
		subheading: {
			fontSize: font.base,
			color: colors.textMuted,
		},
		bonusRow: {
			flexDirection: 'row',
			gap: spacing.sm,
			marginTop: spacing.sm,
		},
		card: {
			flex: 1,
			padding: spacing.md,
			borderRadius: radius.md,
			borderWidth: 2,
			borderColor: colors.border,
			backgroundColor: colors.card,
			gap: spacing.xs,
			minHeight: 160,
		},
		cardPicked: {
			borderColor: colors.brand,
			backgroundColor: colors.brandDim,
		},
		cardFaded: {
			opacity: 0.45,
		},
		pressed: {
			opacity: 0.85,
		},
		cardIcon: {
			width: 44,
			height: 44,
			borderRadius: radius.full,
			alignItems: 'center',
			justifyContent: 'center',
			backgroundColor: colors.background,
			borderWidth: 1,
			borderColor: colors.border,
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
		cardBadge: {
			flexDirection: 'row',
			alignItems: 'center',
			alignSelf: 'flex-start',
			gap: 4,
			paddingHorizontal: spacing.sm,
			paddingVertical: 2,
			borderRadius: radius.full,
			backgroundColor: colors.brand,
			marginTop: spacing.xs,
		},
		cardBadgeText: {
			fontSize: font.xs,
			fontWeight: '700',
			color: colors.white,
		},
		curseCard: {
			flexGrow: 0,
			borderColor: colors.error,
			backgroundColor: colors.card,
		},
		curseTag: {
			fontSize: font.sm,
			fontWeight: '600',
			color: colors.error,
		},
		actionRow: {
			marginTop: 'auto',
		},
		waitingRow: {
			marginTop: 'auto',
			alignItems: 'center',
			paddingVertical: spacing.md,
		},
		waitingText: {
			fontSize: font.base,
			color: colors.textMuted,
			textAlign: 'center',
		},
	})
}
