import { StyleSheet, Text, View } from 'react-native'
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
	if (cards.length === 0) return null
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
	const dark = DARK_TEXT_RESOURCES.has(resource)
	const textColor = dark ? '#1A1A1A' : '#FFFFFF'
	return (
		<View
			style={[styles.card, { backgroundColor: resourceColor[resource] }]}
		>
			<Text style={[styles.name, { color: textColor }]}>
				{RESOURCE_LABELS[resource]}
			</Text>
			<Text style={[styles.count, { color: textColor }]}>{count}</Text>
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

// Light fills that need dark text for legibility.
const DARK_TEXT_RESOURCES: ReadonlySet<Resource> = new Set(['wheat', 'sheep'])

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
	},
	count: {
		fontSize: 22,
		fontWeight: '800',
	},
})
