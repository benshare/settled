// Modal shown to a scout-bonus buyer after they purchase a dev card. 2 cards
// are revealed face-up; the buyer picks one and the rest go to the bottom of
// the deck in their drawn order. A deck down to its last card never opens this
// — the server hands that card over as an ordinary buy, since there is nothing
// to choose between.

import { Ionicons } from '@expo/vector-icons'
import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Button } from '../modules/Button'
import { MinimizableModal } from '../modules/MinimizableModal'
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
		<MinimizableModal
			title="Scout selection"
			dismissOnBackdropPress={false}
			contentStyle={styles.sheet}
		>
			<Text style={styles.subtitle}>Which dev card do you want?</Text>
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
		</MinimizableModal>
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
		sheet: {
			maxWidth: 460,
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
