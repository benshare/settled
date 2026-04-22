import { StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme'
import { RESOURCES, type Resource } from './board'
import { resourceColor } from './palette'
import type { ResourceHand as ResourceHandType } from './types'

const CARD_W = 56
const CARD_H = 84
const OVERLAP = 14 // px pulled in from each card's left edge
const FAN_STEP_DEG = 4 // rotation per card step from the center
const ARC_LIFT = 2 // px outer cards shift to fake a bottom pivot

export function ResourceHand({ hand }: { hand: ResourceHandType }) {
	const cards = RESOURCES.filter((r) => (hand[r] ?? 0) > 0)

	if (cards.length === 0) {
		return (
			<View style={[styles.row, styles.emptyRow]}>
				<Text style={styles.emptyText}>Your hand is empty</Text>
			</View>
		)
	}

	const center = (cards.length - 1) / 2

	return (
		<View style={styles.row}>
			{cards.map((r, i) => {
				const offset = i - center
				return (
					<View
						key={r}
						style={[
							styles.cardWrap,
							{
								marginLeft: i === 0 ? 0 : -OVERLAP,
								transform: [
									{ translateY: Math.abs(offset) * ARC_LIFT },
									{ rotate: `${offset * FAN_STEP_DEG}deg` },
								],
								zIndex: i,
							},
						]}
					>
						<ResourceCard resource={r} count={hand[r] ?? 0} />
					</View>
				)
			})}
		</View>
	)
}

function ResourceCard({
	resource,
	count,
}: {
	resource: Resource
	count: number
}) {
	return (
		<View
			style={[styles.card, { backgroundColor: resourceColor[resource] }]}
		>
			<Text style={styles.name}>{RESOURCE_LABELS[resource]}</Text>
			<Text style={styles.count}>{count}</Text>
		</View>
	)
}

const RESOURCE_LABELS: Record<Resource, string> = {
	wood: 'Wood',
	wheat: 'Wheat',
	sheep: 'Sheep',
	brick: 'Brick',
	ore: 'Ore',
}

const CARD_TEXT = '#1A1A1A'

const styles = StyleSheet.create({
	row: {
		flexDirection: 'row',
		alignItems: 'flex-end',
		justifyContent: 'center',
		paddingHorizontal: 12,
		paddingTop: 16,
		paddingBottom: 8,
		minHeight: CARD_H + 24,
	},
	emptyRow: {
		alignItems: 'center',
	},
	emptyText: {
		fontSize: 13,
		color: colors.textMuted,
		fontStyle: 'italic',
	},
	cardWrap: {
		width: CARD_W,
		height: CARD_H,
	},
	card: {
		width: CARD_W,
		height: CARD_H,
		borderRadius: 8,
		paddingVertical: 6,
		paddingHorizontal: 4,
		justifyContent: 'space-between',
		alignItems: 'center',
		borderWidth: 1,
		borderColor: '#2B2B2B',
	},
	name: {
		fontSize: 11,
		fontWeight: '600',
		color: CARD_TEXT,
	},
	count: {
		fontSize: 22,
		fontWeight: '800',
		color: CARD_TEXT,
	},
})
