// Modal shown to a curio_collector after a 2/12 original roll for which
// they gained at least one card. Pick any 3 resources (duplicates allowed)
// to add to your hand.

import { useMemo, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { ColorScheme, font, radius, spacing } from '../theme'
import { useTheme } from '../ThemeContext'
import { RESOURCES, type Resource } from './board'
import { resourceColor } from './palette'

const RESOURCE_LABELS: Record<Resource, string> = {
	wood: 'Wood',
	wheat: 'Wheat',
	sheep: 'Sheep',
	brick: 'Brick',
	ore: 'Ore',
}

const PICK_COUNT = 3

export function CurioPickOverlay({
	submitting,
	onConfirm,
}: {
	submitting: boolean
	onConfirm: (take: [Resource, Resource, Resource]) => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const [picks, setPicks] = useState<Resource[]>([])

	function onTap(r: Resource) {
		if (picks.length >= PICK_COUNT) return
		setPicks((prev) => [...prev, r])
	}
	function onClear() {
		setPicks([])
	}
	function onSubmit() {
		if (picks.length !== PICK_COUNT) return
		onConfirm([picks[0], picks[1], picks[2]])
	}

	return (
		<Modal transparent animationType="fade" visible>
			<View style={styles.backdrop}>
				<View style={styles.sheet}>
					<Text style={styles.title}>Curio Collector: pick 3</Text>
					<Text style={styles.subtitle}>
						You gained cards on a 2 or 12 — pick 3 additional
						resources of your choice.
					</Text>
					<View style={styles.grid}>
						{RESOURCES.map((r) => {
							const count = picks.filter((p) => p === r).length
							return (
								<Pressable
									key={r}
									style={({ pressed }) => [
										styles.card,
										{ backgroundColor: resourceColor[r] },
										pressed && styles.pressed,
									]}
									onPress={() => onTap(r)}
									disabled={picks.length >= PICK_COUNT}
								>
									<Text style={styles.cardLabel}>
										{RESOURCE_LABELS[r]}
									</Text>
									{count > 0 && (
										<View style={styles.countBadge}>
											<Text style={styles.countText}>
												+{count}
											</Text>
										</View>
									)}
								</Pressable>
							)
						})}
					</View>
					<Text style={styles.progress}>
						{picks.length} / {PICK_COUNT} selected
					</Text>
					<View style={styles.actions}>
						<Pressable
							style={({ pressed }) => [
								styles.secondaryBtn,
								pressed && styles.pressed,
							]}
							onPress={onClear}
							disabled={picks.length === 0}
						>
							<Text style={styles.secondaryText}>Clear</Text>
						</Pressable>
						<Pressable
							style={({ pressed }) => [
								styles.primaryBtn,
								(picks.length !== PICK_COUNT || submitting) &&
									styles.primaryBtnDisabled,
								pressed &&
									picks.length === PICK_COUNT &&
									styles.pressed,
							]}
							onPress={onSubmit}
							disabled={picks.length !== PICK_COUNT || submitting}
						>
							<Text style={styles.primaryText}>
								{submitting ? '…' : 'Take'}
							</Text>
						</Pressable>
					</View>
				</View>
			</View>
		</Modal>
	)
}

// Spectator view: someone else's curio pick is pending.
export function CurioWaitOverlay({ waitingOn }: { waitingOn: string[] }) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<Modal transparent animationType="fade" visible>
			<View style={styles.backdrop}>
				<View style={styles.sheet}>
					<Text style={styles.title}>Curio Collector pick</Text>
					<Text style={styles.subtitle}>
						Waiting on {waitingOn.join(', ')} to claim 3 resources.
					</Text>
				</View>
			</View>
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
			justifyContent: 'flex-end',
			padding: spacing.sm,
		},
		cardLabel: {
			fontSize: font.sm,
			fontWeight: '700',
			color: '#1A1A1A',
		},
		countBadge: {
			position: 'absolute',
			top: -6,
			right: -6,
			paddingHorizontal: 6,
			paddingVertical: 2,
			borderRadius: radius.full,
			backgroundColor: colors.brand,
		},
		countText: {
			color: colors.white,
			fontWeight: '700',
			fontSize: font.xs,
		},
		progress: {
			textAlign: 'center',
			fontSize: font.sm,
			color: colors.textMuted,
		},
		actions: {
			flexDirection: 'row',
			gap: spacing.sm,
		},
		primaryBtn: {
			flex: 1,
			backgroundColor: colors.brand,
			borderRadius: radius.sm,
			paddingVertical: spacing.sm,
			alignItems: 'center',
		},
		primaryBtnDisabled: {
			opacity: 0.4,
		},
		primaryText: {
			color: colors.white,
			fontWeight: '700',
			fontSize: font.md,
		},
		secondaryBtn: {
			flex: 1,
			borderRadius: radius.sm,
			paddingVertical: spacing.sm,
			alignItems: 'center',
			borderWidth: 1,
			borderColor: colors.border,
		},
		secondaryText: {
			color: colors.text,
			fontWeight: '600',
			fontSize: font.md,
		},
		pressed: {
			opacity: 0.8,
		},
	})
}
