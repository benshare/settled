// Modal for the metropolitan player to choose how many wheat to replace
// with extra ore when paying for a city or super_city. Only shown when
// the player has a meaningful choice (at least one valid swap option
// they can afford that differs from the default).

import { useMemo, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { Button } from '../modules/Button'
import { metropolitanCityCost } from './bonus'
import { ColorScheme, font, radius, spacing } from '../theme'
import { useTheme } from '../ThemeContext'
import type { ResourceHand } from './types'

export function MetropolitanCostPicker({
	hand,
	titleKind,
	submitting,
	onCancel,
	onConfirm,
}: {
	hand: ResourceHand
	titleKind: 'city' | 'super_city'
	submitting: boolean
	onCancel: () => void
	onConfirm: (swapDelta: number) => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const options = useMemo(() => {
		const out: Array<{
			delta: number
			cost: ResourceHand
			affordable: boolean
		}> = []
		for (let d = 0; d <= 2; d++) {
			const cost = metropolitanCityCost('metropolitan', d)
			const affordable = hand.wheat >= cost.wheat && hand.ore >= cost.ore
			out.push({ delta: d, cost, affordable })
		}
		return out
	}, [hand])
	const firstAffordable = options.find((o) => o.affordable)?.delta ?? 0
	const [pick, setPick] = useState<number>(firstAffordable)

	const label = titleKind === 'super_city' ? 'Super City' : 'City'

	return (
		<Modal
			transparent
			animationType="fade"
			visible
			onRequestClose={onCancel}
		>
			<Pressable style={styles.backdrop} onPress={onCancel}>
				<Pressable style={styles.sheet}>
					<Text style={styles.title}>Metropolitan: {label} cost</Text>
					<Text style={styles.subtitle}>
						Replace any number of Wheat in the cost with the same
						number of Ore.
					</Text>
					<View style={styles.list}>
						{options.map((o) => (
							<Pressable
								key={o.delta}
								onPress={() => o.affordable && setPick(o.delta)}
								disabled={!o.affordable}
								style={({ pressed }) => [
									styles.row,
									pick === o.delta && styles.rowPicked,
									!o.affordable && styles.rowDisabled,
									pressed && o.affordable && styles.pressed,
								]}
							>
								<Text style={styles.rowText}>
									{o.cost.wheat} Wheat + {o.cost.ore} Ore
								</Text>
								{!o.affordable && (
									<Text style={styles.rowSub}>
										insufficient
									</Text>
								)}
							</Pressable>
						))}
					</View>
					<View style={styles.actions}>
						<Pressable
							style={({ pressed }) => [
								styles.cancelBtn,
								pressed && styles.pressed,
							]}
							onPress={onCancel}
						>
							<Text style={styles.cancelText}>Cancel</Text>
						</Pressable>
						<View style={{ flex: 1 }}>
							<Button
								onPress={() => onConfirm(pick)}
								disabled={!options[pick]?.affordable}
								loading={submitting}
							>
								Build {label}
							</Button>
						</View>
					</View>
				</Pressable>
			</Pressable>
		</Modal>
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
			maxWidth: 420,
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
		list: {
			gap: spacing.xs,
		},
		row: {
			padding: spacing.sm,
			borderRadius: radius.sm,
			borderWidth: 1,
			borderColor: colors.border,
			backgroundColor: colors.background,
			flexDirection: 'row',
			justifyContent: 'space-between',
			alignItems: 'center',
		},
		rowPicked: {
			borderWidth: 2,
			borderColor: colors.brand,
		},
		rowDisabled: {
			opacity: 0.45,
		},
		rowText: {
			fontSize: font.base,
			fontWeight: '600',
			color: colors.text,
		},
		rowSub: {
			fontSize: font.xs,
			color: colors.error,
			fontWeight: '600',
		},
		actions: {
			flexDirection: 'row',
			gap: spacing.sm,
			alignItems: 'center',
		},
		cancelBtn: {
			paddingVertical: spacing.sm,
			paddingHorizontal: spacing.md,
		},
		cancelText: {
			fontSize: font.base,
			color: colors.textSecondary,
			fontWeight: '600',
		},
		pressed: {
			opacity: 0.85,
		},
	})
}
