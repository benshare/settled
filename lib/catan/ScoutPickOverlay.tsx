// Modal shown to a scout-bonus buyer after they purchase a dev card. Up to
// 3 cards are revealed face-up; the buyer picks one and the rest go to the
// bottom of the deck in their drawn order.

import { Ionicons } from '@expo/vector-icons'
import { useMemo, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { Button } from '../modules/Button'
import { ColorScheme, font, radius, spacing } from '../theme'
import { useTheme } from '../ThemeContext'
import { DEV_CARD_POOL, type DevCardId } from './devCards'

export function ScoutPickOverlay({
	cards,
	submitting,
	onConfirm,
}: {
	cards: DevCardId[]
	submitting: boolean
	onConfirm: (index: number) => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const [pick, setPick] = useState<number | null>(null)

	return (
		<Modal transparent animationType="fade" visible>
			<View style={styles.backdrop}>
				<View style={styles.sheet}>
					<Text style={styles.title}>Scout: peek 3 dev cards</Text>
					<Text style={styles.subtitle}>
						Pick one to add to your hand. The other{' '}
						{Math.max(0, cards.length - 1)} go to the bottom of the
						deck in their drawn order.
					</Text>
					<View style={styles.row}>
						{cards.map((id, idx) => (
							<ScoutCard
								key={`${id}-${idx}`}
								id={id}
								picked={pick === idx}
								onPress={() => setPick(idx)}
								styles={styles}
							/>
						))}
					</View>
					<Button
						onPress={() => pick !== null && onConfirm(pick)}
						disabled={pick === null}
						loading={submitting}
					>
						Take this card
					</Button>
				</View>
			</View>
		</Modal>
	)
}

// Spectator/owner-other view while a scout pick is pending.
export function ScoutWaitOverlay({ ownerName }: { ownerName: string }) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<Modal transparent animationType="fade" visible>
			<View style={styles.backdrop}>
				<View style={styles.sheet}>
					<Text style={styles.title}>Scout pick</Text>
					<Text style={styles.subtitle}>
						Waiting on {ownerName} to choose 1 of 3 peeked dev
						cards.
					</Text>
				</View>
			</View>
		</Modal>
	)
}

function ScoutCard({
	id,
	picked,
	onPress,
	styles,
}: {
	id: DevCardId
	picked: boolean
	onPress: () => void
	styles: ReturnType<typeof makeStyles>
}) {
	const data = DEV_CARD_POOL.find((c) => c.id === id)
	if (!data) return null
	return (
		<Pressable
			onPress={onPress}
			style={({ pressed }) => [
				styles.card,
				picked && styles.cardPicked,
				pressed && styles.pressed,
			]}
		>
			<Ionicons name={data.icon} size={28} color="#1A1A1A" />
			<Text style={styles.cardLabel}>{data.title}</Text>
		</Pressable>
	)
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		backdrop: {
			flex: 1,
			backgroundColor: 'rgba(0,0,0,0.55)',
			alignItems: 'center',
			justifyContent: 'center',
			padding: spacing.lg,
		},
		sheet: {
			width: '100%',
			maxWidth: 460,
			backgroundColor: colors.card,
			borderRadius: radius.md,
			padding: spacing.lg,
			gap: spacing.md,
		},
		title: {
			fontSize: font.lg,
			fontWeight: '700',
			color: colors.text,
		},
		subtitle: {
			fontSize: font.sm,
			color: colors.textSecondary,
			lineHeight: 20,
		},
		row: {
			flexDirection: 'row',
			gap: spacing.sm,
			justifyContent: 'center',
		},
		card: {
			width: 110,
			minHeight: 130,
			borderRadius: radius.sm,
			borderWidth: 1,
			borderColor: '#2B2B2B',
			backgroundColor: '#E9E2C5',
			alignItems: 'center',
			justifyContent: 'center',
			padding: spacing.sm,
			gap: spacing.xs,
		},
		cardPicked: {
			borderWidth: 3,
			borderColor: colors.brand,
		},
		cardLabel: {
			fontSize: font.sm,
			fontWeight: '700',
			color: '#1A1A1A',
			textAlign: 'center',
		},
		pressed: {
			opacity: 0.85,
		},
	})
}
