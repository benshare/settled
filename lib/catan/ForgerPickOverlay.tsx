// Modal shown to a forger after their token's hex produced and at least one
// other player gained from it. The forger picks one candidate to copy from.

import { useMemo, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { Button } from '../modules/Button'
import { ColorScheme, font, radius, spacing } from '../theme'
import { useTheme } from '../ThemeContext'
import { RESOURCES, type Hex } from './board'
import { playerColors, resourceColor } from './palette'
import type { ResourceHand } from './types'

export function ForgerPickOverlay({
	hex,
	gainsByCandidate,
	playerNames,
	submitting,
	onConfirm,
}: {
	hex: Hex
	gainsByCandidate: Record<number, ResourceHand>
	playerNames: Record<number, string>
	submitting: boolean
	onConfirm: (target: number) => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const [pick, setPick] = useState<number | null>(null)
	const candidates = Object.keys(gainsByCandidate).map(Number)

	return (
		<Modal transparent animationType="fade" visible>
			<View style={styles.backdrop}>
				<View style={styles.sheet}>
					<Text style={styles.title}>Forger: copy from a player</Text>
					<Text style={styles.subtitle}>
						Your token at hex {hex} produced. Pick one player to
						copy what THEY gained from that hex on this roll.
					</Text>
					<View style={styles.list}>
						{candidates.map((idx) => (
							<CandidateRow
								key={idx}
								name={playerNames[idx] ?? `Player ${idx + 1}`}
								idx={idx}
								gain={gainsByCandidate[idx]}
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
						Copy
					</Button>
				</View>
			</View>
		</Modal>
	)
}

function CandidateRow({
	name,
	idx,
	gain,
	picked,
	onPress,
	styles,
}: {
	name: string
	idx: number
	gain: ResourceHand
	picked: boolean
	onPress: () => void
	styles: ReturnType<typeof makeStyles>
}) {
	const color = playerColors[idx] ?? playerColors[0]
	return (
		<Pressable
			onPress={onPress}
			style={({ pressed }) => [
				styles.row,
				picked && { borderColor: color, borderWidth: 2 },
				pressed && styles.pressed,
			]}
		>
			<View style={[styles.dot, { backgroundColor: color }]} />
			<Text style={styles.name}>{name}</Text>
			<View style={styles.gainRow}>
				{RESOURCES.filter((r) => gain[r] > 0).map((r) => (
					<View
						key={r}
						style={[
							styles.gainChip,
							{ backgroundColor: resourceColor[r] },
						]}
					>
						<Text style={styles.gainText}>+{gain[r]}</Text>
					</View>
				))}
			</View>
		</Pressable>
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
			maxWidth: 460,
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
			gap: spacing.sm,
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
		dot: {
			width: 14,
			height: 14,
			borderRadius: radius.full,
			borderWidth: 1,
			borderColor: '#2B2B2B',
		},
		name: {
			flex: 1,
			fontSize: font.base,
			fontWeight: '600',
			color: colors.text,
		},
		gainRow: {
			flexDirection: 'row',
			gap: 4,
		},
		gainChip: {
			paddingHorizontal: 6,
			paddingVertical: 2,
			borderRadius: radius.sm,
			borderWidth: 1,
			borderColor: '#2B2B2B',
		},
		gainText: {
			fontSize: font.xs,
			fontWeight: '700',
			color: '#1A1A1A',
		},
		pressed: {
			opacity: 0.85,
		},
	})
}
