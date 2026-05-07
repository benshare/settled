// Floating top-right overlay on the game board. Collapsed = info icon. Expanded
// = a small panel with two tabs: a resource legend (colored circle + name) and
// a build-costs reference.

import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import { colors, font, radius, spacing } from '../theme'
import { RESOURCES, type Resource } from './board'
import { BUILD_COSTS } from './build'
import { DEV_CARD_COST } from './dev'
import { resourceColor } from './palette'

type Tab = 'key' | 'cost'

const RESOURCE_LABELS: Record<Resource, string> = {
	wood: 'Wood',
	wheat: 'Wheat',
	sheep: 'Sheep',
	brick: 'Brick',
	ore: 'Ore',
}

const COST_ENTRIES = [
	{ key: 'road', label: 'Road', cost: BUILD_COSTS.road },
	{ key: 'settlement', label: 'Settlement', cost: BUILD_COSTS.settlement },
	{ key: 'city', label: 'City', cost: BUILD_COSTS.city },
	{ key: 'dev_card', label: 'Dev card', cost: DEV_CARD_COST },
] as const

export function BoardLegend({ devCardsEnabled }: { devCardsEnabled: boolean }) {
	const [open, setOpen] = useState(false)
	const [tab, setTab] = useState<Tab>('key')

	if (!open) {
		return (
			<Pressable
				onPress={() => setOpen(true)}
				style={({ pressed }) => [
					styles.collapsed,
					pressed && styles.pressed,
				]}
				hitSlop={6}
				accessibilityLabel="Open board info"
			>
				<Ionicons
					name="information-circle"
					size={26}
					color={colors.text}
				/>
			</Pressable>
		)
	}

	return (
		<Animated.View
			entering={FadeIn.duration(150)}
			exiting={FadeOut.duration(120)}
			style={styles.panel}
		>
			<View style={styles.header}>
				<View style={styles.tabs}>
					<TabButton
						icon="key"
						active={tab === 'key'}
						onPress={() => setTab('key')}
						accessibilityLabel="Resource legend"
					/>
					<TabButton
						icon="logo-usd"
						active={tab === 'cost'}
						onPress={() => setTab('cost')}
						accessibilityLabel="Build costs"
					/>
				</View>
				<Pressable
					onPress={() => setOpen(false)}
					style={({ pressed }) => [
						styles.closeBtn,
						pressed && styles.pressed,
					]}
					accessibilityLabel="Close board info"
					hitSlop={6}
				>
					<Ionicons
						name="close"
						size={18}
						color={colors.textSecondary}
					/>
				</Pressable>
			</View>
			<View style={styles.body}>
				{tab === 'key' ? (
					<ResourceList />
				) : (
					<CostList devCardsEnabled={devCardsEnabled} />
				)}
			</View>
		</Animated.View>
	)
}

function TabButton({
	icon,
	active,
	onPress,
	accessibilityLabel,
}: {
	icon: React.ComponentProps<typeof Ionicons>['name']
	active: boolean
	onPress: () => void
	accessibilityLabel: string
}) {
	return (
		<Pressable
			onPress={onPress}
			style={({ pressed }) => [
				styles.tab,
				active && styles.tabActive,
				pressed && styles.pressed,
			]}
			accessibilityLabel={accessibilityLabel}
		>
			<Ionicons
				name={icon}
				size={18}
				color={active ? colors.text : colors.textMuted}
			/>
		</Pressable>
	)
}

function ResourceList() {
	return (
		<View style={styles.list}>
			{RESOURCES.map((r) => (
				<View key={r} style={styles.row}>
					<View
						style={[
							styles.dot,
							{ backgroundColor: resourceColor[r] },
						]}
					/>
					<Text style={styles.label}>{RESOURCE_LABELS[r]}</Text>
				</View>
			))}
		</View>
	)
}

function CostList({ devCardsEnabled }: { devCardsEnabled: boolean }) {
	const items = devCardsEnabled
		? COST_ENTRIES
		: COST_ENTRIES.filter((e) => e.key !== 'dev_card')
	return (
		<View style={styles.list}>
			{items.map((entry) => (
				<View key={entry.key} style={styles.row}>
					<Text style={styles.costLabel}>{entry.label}</Text>
					<View style={styles.costDots}>
						{RESOURCES.flatMap((r) => {
							const n = entry.cost[r] ?? 0
							return Array.from({ length: n }).map((_, i) => (
								<View
									key={`${r}-${i}`}
									style={[
										styles.smallDot,
										{ backgroundColor: resourceColor[r] },
									]}
								/>
							))
						})}
					</View>
				</View>
			))}
		</View>
	)
}

const styles = StyleSheet.create({
	collapsed: {
		position: 'absolute',
		top: spacing.sm,
		right: spacing.sm,
		width: 32,
		height: 32,
		borderRadius: 16,
		backgroundColor: colors.card,
		borderWidth: 1,
		borderColor: colors.border,
		alignItems: 'center',
		justifyContent: 'center',
		shadowColor: '#000',
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.12,
		shadowRadius: 6,
		elevation: 3,
		zIndex: 4,
	},
	panel: {
		position: 'absolute',
		top: spacing.sm,
		right: spacing.sm,
		minWidth: 168,
		maxWidth: 220,
		backgroundColor: colors.card,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		paddingVertical: spacing.xs,
		shadowColor: '#000',
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.12,
		shadowRadius: 6,
		elevation: 3,
		zIndex: 4,
	},
	header: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingHorizontal: spacing.xs,
		paddingBottom: spacing.xs,
		borderBottomWidth: 1,
		borderBottomColor: colors.borderLight,
	},
	tabs: {
		flexDirection: 'row',
		gap: spacing.xs,
	},
	tab: {
		width: 36,
		height: 28,
		borderRadius: radius.sm,
		alignItems: 'center',
		justifyContent: 'center',
	},
	tabActive: {
		backgroundColor: colors.cardAlt,
	},
	closeBtn: {
		width: 28,
		height: 28,
		alignItems: 'center',
		justifyContent: 'center',
	},
	body: {
		paddingHorizontal: spacing.sm,
		paddingTop: spacing.xs,
		paddingBottom: spacing.xs,
	},
	list: {
		gap: spacing.xs,
	},
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
	},
	dot: {
		width: 14,
		height: 14,
		borderRadius: 7,
		borderWidth: 1,
		borderColor: colors.border,
	},
	smallDot: {
		width: 10,
		height: 10,
		borderRadius: 5,
		borderWidth: 1,
		borderColor: colors.border,
	},
	label: {
		fontSize: font.sm,
		color: colors.text,
	},
	costLabel: {
		flex: 1,
		fontSize: font.sm,
		fontWeight: '600',
		color: colors.text,
	},
	costDots: {
		flexDirection: 'row',
		gap: 3,
		flexWrap: 'wrap',
		flexShrink: 1,
		justifyContent: 'flex-end',
	},
	pressed: {
		opacity: 0.7,
	},
})
