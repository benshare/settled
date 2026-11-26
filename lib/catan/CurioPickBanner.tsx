// A curio_collector's +3 claim after a 2/12, as an inline banner over the
// board (styled after `SpecialistDeclareBanner`) rather than a modal: the pick
// is about what the player is short of, so the board and hand stay in view.
// Tapping a resource adds one (duplicates allowed); Clear starts over.

import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ColorScheme, font, radius, spacing } from '../theme'
import { useTheme } from '../ThemeContext'
import { RESOURCES, type Resource } from './board'
import { CURIO_PICK_SIZE } from './bonus'
import { resourceColor } from './palette'

export function CurioPickBanner({
	submitting,
	onConfirm,
}: {
	submitting: boolean
	onConfirm: (take: [Resource, Resource, Resource]) => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const [picks, setPicks] = useState<Resource[]>([])
	const full = picks.length >= CURIO_PICK_SIZE
	const canSubmit = full && !submitting

	return (
		<View style={styles.banner}>
			<View style={styles.row}>
				<View style={styles.body}>
					<Text style={styles.text}>
						{`Curio Collector: pick ${CURIO_PICK_SIZE} · ${picks.length}/${CURIO_PICK_SIZE}`}
					</Text>
					<View style={styles.circleRow}>
						{RESOURCES.map((r) => {
							const count = picks.filter((p) => p === r).length
							return (
								<Pressable
									key={r}
									onPress={() =>
										!full && setPicks([...picks, r])
									}
									disabled={full}
									hitSlop={4}
									accessibilityLabel={`Take ${r}`}
									style={({ pressed }) => [
										styles.circle,
										{ backgroundColor: resourceColor[r] },
										count > 0 && styles.circlePicked,
										full && count === 0 && styles.dimmed,
										pressed && styles.pressed,
									]}
								>
									{count > 0 && (
										<View style={styles.badge}>
											<Text style={styles.badgeText}>
												+{count}
											</Text>
										</View>
									)}
								</Pressable>
							)
						})}
					</View>
				</View>
				<View style={styles.actions}>
					<Pressable
						onPress={() =>
							canSubmit &&
							onConfirm([picks[0], picks[1], picks[2]])
						}
						disabled={!canSubmit}
						style={({ pressed }) => [
							styles.confirmBtn,
							!canSubmit && styles.disabled,
							pressed && styles.pressed,
						]}
					>
						<Text style={styles.confirmText}>
							{submitting ? '…' : 'Take'}
						</Text>
					</Pressable>
					<Pressable
						onPress={() => setPicks([])}
						disabled={picks.length === 0 || submitting}
						hitSlop={4}
						style={({ pressed }) => [
							styles.clearBtn,
							picks.length === 0 && styles.disabled,
							pressed && styles.pressed,
						]}
					>
						<Text style={styles.clearText}>Clear</Text>
					</Pressable>
				</View>
			</View>
		</View>
	)
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		banner: {
			marginHorizontal: spacing.md,
			marginBottom: spacing.xs,
			padding: spacing.sm,
			backgroundColor: colors.card,
			borderRadius: radius.sm,
			borderWidth: 1,
			borderColor: colors.border,
		},
		row: {
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'space-between',
			gap: spacing.sm,
		},
		body: {
			flex: 1,
			gap: spacing.xs,
		},
		text: {
			fontSize: font.sm,
			fontWeight: '600',
			color: colors.text,
		},
		circleRow: {
			flexDirection: 'row',
			gap: spacing.sm,
			// Room for the count badges, which overhang the circles' top.
			paddingTop: spacing.xs,
		},
		circle: {
			width: 32,
			height: 32,
			borderRadius: radius.full,
			borderWidth: 1,
			borderColor: '#2B2B2B',
		},
		circlePicked: {
			borderWidth: 3,
			borderColor: colors.brand,
		},
		badge: {
			position: 'absolute',
			top: -8,
			right: -10,
			paddingHorizontal: 5,
			paddingVertical: 1,
			borderRadius: radius.full,
			backgroundColor: colors.brand,
		},
		badgeText: {
			color: colors.white,
			fontWeight: '700',
			fontSize: font.xs,
		},
		actions: {
			alignItems: 'center',
			gap: spacing.xs,
		},
		confirmBtn: {
			paddingVertical: spacing.xs,
			paddingHorizontal: spacing.md,
			borderRadius: radius.sm,
			backgroundColor: colors.brand,
		},
		confirmText: {
			fontSize: font.sm,
			fontWeight: '700',
			color: colors.white,
		},
		clearBtn: {
			paddingVertical: 2,
			paddingHorizontal: spacing.sm,
		},
		clearText: {
			fontSize: font.xs,
			fontWeight: '600',
			color: colors.textSecondary,
		},
		dimmed: {
			opacity: 0.4,
		},
		disabled: {
			opacity: 0.5,
		},
		pressed: {
			opacity: 0.8,
		},
	})
}
