import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme'
import { RESOURCES, type Resource } from './board'
import { resourceColor, resourceShadowColor } from './palette'
import type { ResourceHand as ResourceHandType } from './types'

// Fan geometry, per size. `full` keeps the original physical-hand look used
// across the game; `compact` shrinks everything proportionally so two fans
// stack inside a half-width trade-panel column.
const DIMS = {
	full: { w: 56, h: 84, overlap: 14, step: 4, lift: 2, radius: 8 },
	compact: { w: 38, h: 58, overlap: 12, step: 3, lift: 1.5, radius: 6 },
} as const

export type CardFanSize = keyof typeof DIMS
export type CardFanEntry = { resource: Resource; count: number }

// The reusable fanned-card primitive. Cards overlap, rotate around the
// center, and arc-lift to fake a bottom pivot. Solid = a real resource card;
// shadow = a desaturated "not yet real" card with no count. When `onCardPress`
// is set each card is tappable (the parent owns what a tap does).
export function CardFan({
	entries,
	variant = 'solid',
	showCount = true,
	size = 'full',
	onCardPress,
	disabledResources,
	emptyLabel,
}: {
	entries: CardFanEntry[]
	variant?: 'solid' | 'shadow'
	showCount?: boolean
	size?: CardFanSize
	onCardPress?: (r: Resource) => void
	disabledResources?: readonly Resource[]
	emptyLabel?: string
}) {
	const dim = DIMS[size]
	const rowStyle = size === 'full' ? styles.rowFull : styles.rowCompact

	if (entries.length === 0) {
		return (
			<View
				style={[
					rowStyle,
					styles.emptyRow,
					{ minHeight: dim.h + (size === 'full' ? 24 : 12) },
				]}
			>
				{emptyLabel ? (
					<Text style={styles.emptyText}>{emptyLabel}</Text>
				) : null}
			</View>
		)
	}

	const center = (entries.length - 1) / 2

	return (
		<View
			style={[
				rowStyle,
				{ minHeight: dim.h + (size === 'full' ? 24 : 12) },
			]}
		>
			{entries.map(({ resource: r, count }, i) => {
				const offset = i - center
				const disabled = disabledResources?.includes(r) ?? false
				return (
					<View
						key={r}
						style={{
							width: dim.w,
							height: dim.h,
							marginLeft: i === 0 ? 0 : -dim.overlap,
							transform: [
								{ translateY: Math.abs(offset) * dim.lift },
								{ rotate: `${offset * dim.step}deg` },
							],
							zIndex: i,
						}}
					>
						<Card
							resource={r}
							count={count}
							variant={variant}
							showCount={showCount}
							dim={dim}
							disabled={disabled}
							onPress={onCardPress}
						/>
					</View>
				)
			})}
		</View>
	)
}

function Card({
	resource,
	count,
	variant,
	showCount,
	dim,
	disabled,
	onPress,
}: {
	resource: Resource
	count: number
	variant: 'solid' | 'shadow'
	showCount: boolean
	dim: (typeof DIMS)[CardFanSize]
	disabled: boolean
	onPress?: (r: Resource) => void
}) {
	const bg =
		variant === 'shadow'
			? resourceShadowColor[resource]
			: resourceColor[resource]
	const body = (
		<View
			style={[
				styles.card,
				{
					width: dim.w,
					height: dim.h,
					borderRadius: dim.radius,
					backgroundColor: bg,
				},
				variant === 'shadow' && styles.cardShadow,
				disabled && styles.cardDisabled,
			]}
		>
			<Text style={[styles.name, { fontSize: dim.w < 50 ? 9 : 11 }]}>
				{RESOURCE_LABELS[resource]}
			</Text>
			{showCount ? (
				<Text
					style={[styles.count, { fontSize: dim.w < 50 ? 16 : 22 }]}
				>
					{count}
				</Text>
			) : null}
		</View>
	)

	if (!onPress) return body

	return (
		<Pressable
			disabled={disabled}
			onPress={() => onPress(resource)}
			style={({ pressed }) =>
				pressed && !disabled ? styles.pressed : null
			}
			hitSlop={4}
		>
			{body}
		</Pressable>
	)
}

// The original game-wide hand display: full-size, solid, counted, read-only.
// Behaviour is unchanged from before the CardFan extraction.
export function ResourceHand({ hand }: { hand: ResourceHandType }) {
	const entries = RESOURCES.filter((r) => (hand[r] ?? 0) > 0).map((r) => ({
		resource: r,
		count: hand[r] ?? 0,
	}))
	return <CardFan entries={entries} emptyLabel="Your hand is empty" />
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
	rowFull: {
		flexDirection: 'row',
		alignItems: 'flex-end',
		justifyContent: 'center',
		paddingHorizontal: 12,
		paddingTop: 16,
		paddingBottom: 8,
	},
	rowCompact: {
		flexDirection: 'row',
		alignItems: 'flex-end',
		justifyContent: 'center',
		paddingHorizontal: 6,
		paddingTop: 8,
		paddingBottom: 4,
	},
	emptyRow: {
		alignItems: 'center',
		justifyContent: 'center',
	},
	emptyText: {
		fontSize: 13,
		color: colors.textMuted,
		fontStyle: 'italic',
	},
	card: {
		paddingVertical: 6,
		paddingHorizontal: 4,
		justifyContent: 'space-between',
		alignItems: 'center',
		borderWidth: 1,
		borderColor: '#2B2B2B',
	},
	cardShadow: {
		borderColor: '#6B6256',
	},
	cardDisabled: {
		opacity: 0.4,
	},
	name: {
		fontWeight: '600',
		color: CARD_TEXT,
	},
	count: {
		fontWeight: '800',
		color: CARD_TEXT,
	},
	pressed: {
		opacity: 0.7,
	},
})
