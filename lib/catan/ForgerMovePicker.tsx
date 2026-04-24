// Modal for the forger to pick an adjacent hex to move their token onto,
// before rolling. The 6 candidate hexes are listed with their resource +
// number so the player can choose without scanning the board.

import { useMemo, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { Button } from '../modules/Button'
import { ColorScheme, font, radius, spacing } from '../theme'
import { useTheme } from '../ThemeContext'
import { type Hex } from './board'
import { hexesAdjacentTo } from './bonus'
import { resourceColor } from './palette'
import type { GameState } from './types'

const RESOURCE_GLYPH: Record<string, string> = {
	wood: 'Wood',
	wheat: 'Wheat',
	sheep: 'Sheep',
	brick: 'Brick',
	ore: 'Ore',
}

export function ForgerMovePicker({
	state,
	currentHex,
	submitting,
	onCancel,
	onConfirm,
}: {
	state: GameState
	currentHex: Hex
	submitting: boolean
	onCancel: () => void
	onConfirm: (hex: Hex) => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const [pick, setPick] = useState<Hex | null>(null)
	const candidates = useMemo(() => hexesAdjacentTo(currentHex), [currentHex])

	return (
		<Modal
			transparent
			animationType="fade"
			visible
			onRequestClose={onCancel}
		>
			<Pressable style={styles.backdrop} onPress={onCancel}>
				<Pressable style={styles.sheet}>
					<Text style={styles.title}>Move forger token</Text>
					<Text style={styles.subtitle}>
						Currently at {currentHex}. Pick an adjacent hex.
					</Text>
					<View style={styles.list}>
						{candidates.map((h) => {
							const hd = state.hexes[h]
							const desert = hd.resource === null
							return (
								<Pressable
									key={h}
									onPress={() => setPick(h)}
									style={({ pressed }) => [
										styles.row,
										pick === h && styles.rowPicked,
										pressed && styles.pressed,
									]}
								>
									<Text style={styles.hexLabel}>{h}</Text>
									{!desert && (
										<View
											style={[
												styles.chip,
												{
													backgroundColor:
														resourceColor[
															hd.resource
														],
												},
											]}
										>
											<Text style={styles.chipText}>
												{RESOURCE_GLYPH[hd.resource]} ·{' '}
												{hd.number}
											</Text>
										</View>
									)}
									{desert && (
										<View
											style={[
												styles.chip,
												{ backgroundColor: '#C8B383' },
											]}
										>
											<Text style={styles.chipText}>
												Desert
											</Text>
										</View>
									)}
								</Pressable>
							)
						})}
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
								onPress={() => pick && onConfirm(pick)}
								disabled={!pick}
								loading={submitting}
							>
								Move
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
			flexDirection: 'row',
			alignItems: 'center',
			gap: spacing.sm,
			padding: spacing.sm,
			borderRadius: radius.sm,
			borderWidth: 1,
			borderColor: colors.border,
			backgroundColor: colors.background,
		},
		rowPicked: {
			borderWidth: 2,
			borderColor: colors.brand,
		},
		hexLabel: {
			fontSize: font.base,
			fontWeight: '700',
			color: colors.text,
			minWidth: 40,
		},
		chip: {
			paddingHorizontal: 8,
			paddingVertical: 2,
			borderRadius: radius.sm,
			borderWidth: 1,
			borderColor: '#2B2B2B',
		},
		chipText: {
			fontSize: font.xs,
			fontWeight: '700',
			color: '#1A1A1A',
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
