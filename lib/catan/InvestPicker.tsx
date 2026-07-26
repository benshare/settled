// Investor picker: set aside 3 of one resource for an investment token. Only
// resources the player holds ≥3 of are selectable; each token pays 1 back once
// the investor's roll resolves.

import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Modal } from '../modules/Modal'
import { ColorScheme, font, radius, spacing } from '../theme'
import { useTheme } from '../ThemeContext'
import { RESOURCES, type Resource } from './board'
import { INVEST_TRIO, INVESTOR_MAX_TOKENS } from './bonus'
import { resourceColor } from './palette'
import type { ResourceHand } from './types'

const RESOURCE_LABELS: Record<Resource, string> = {
	wood: 'Wood',
	wheat: 'Wheat',
	sheep: 'Sheep',
	brick: 'Brick',
	ore: 'Ore',
}

export function InvestPicker({
	hand,
	tokenCount,
	submitting,
	onCancel,
	onConfirm,
}: {
	hand: ResourceHand
	tokenCount: number
	submitting: boolean
	onCancel: () => void
	onConfirm: (resource: Resource) => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<Modal visible onDismiss={onCancel} contentStyle={styles.sheet}>
			<Text style={styles.title}>Invest</Text>
			<Text style={styles.subtitle}>
				Set aside {INVEST_TRIO} of a resource. Each token pays 1 back
				after you roll — {tokenCount}/{INVESTOR_MAX_TOKENS} tokens used.
				Set-aside cards can't be stolen.
			</Text>
			<View style={styles.grid}>
				{RESOURCES.map((r) => {
					const canPick = hand[r] >= INVEST_TRIO && !submitting
					return (
						<Pressable
							key={r}
							disabled={!canPick}
							onPress={() => onConfirm(r)}
							style={({ pressed }) => [
								styles.card,
								{ backgroundColor: resourceColor[r] },
								!canPick && styles.cardDisabled,
								pressed && canPick && styles.pressed,
							]}
						>
							<Text style={styles.cardCount}>{hand[r]}</Text>
							<Text style={styles.cardLabel}>
								{RESOURCE_LABELS[r]}
							</Text>
						</Pressable>
					)
				})}
			</View>
			<Pressable
				onPress={onCancel}
				style={({ pressed }) => [
					styles.cancelBtn,
					pressed && styles.pressed,
				]}
			>
				<Text style={styles.cancelText}>Cancel</Text>
			</Pressable>
		</Modal>
	)
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
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
		grid: {
			flexDirection: 'row',
			flexWrap: 'wrap',
			gap: spacing.sm,
			justifyContent: 'center',
		},
		card: {
			width: 84,
			height: 96,
			borderRadius: radius.sm,
			borderWidth: 1,
			borderColor: '#2B2B2B',
			alignItems: 'center',
			justifyContent: 'space-between',
			padding: spacing.sm,
		},
		cardDisabled: {
			opacity: 0.4,
		},
		cardCount: {
			fontSize: font.base,
			fontWeight: '800',
			color: '#1A1A1A',
			alignSelf: 'flex-end',
		},
		cardLabel: {
			fontSize: font.sm,
			fontWeight: '700',
			color: '#1A1A1A',
		},
		cancelBtn: {
			alignSelf: 'center',
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
