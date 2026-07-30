// Modal shown to a scout-bonus buyer after they purchase a dev card. Up to
// 2 cards are revealed face-up; the buyer picks one and the rest go to the
// bottom of the deck in their drawn order.

import { Ionicons } from '@expo/vector-icons'
import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Modal } from '../modules/Modal'
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
		<Modal
			visible
			dismissOnBackdropPress={false}
			contentStyle={styles.sheet}
		>
			<Text style={styles.title}>Scout: peek 2 dev cards</Text>
			<Text style={styles.subtitle}>{subtitleFor(cards.length)}</Text>
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
		</Modal>
	)
}

// The peek is clamped to the deck size, so a near-empty deck can reveal
// fewer than SCOUT_PEEK_SIZE cards.
function subtitleFor(count: number) {
	if (count <= 1) return 'Take this card to add it to your hand.'
	if (count === 2)
		return 'Pick one to add to your hand. The other goes to the bottom of the deck.'
	return `Pick one to add to your hand. The other ${count - 1} go to the bottom of the deck in their drawn order.`
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
