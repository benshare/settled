// Full-screen modal shown during the `post_placement` phase for players
// who still have a start-of-game bonus action pending. Today that's only
// `specialist` (declare a resource). New set-2/3 bonuses (explorer,
// fencer, haunt) plug into the same phase by adding entries to
// phase.pending and extending this overlay.

import { Button } from '@/lib/modules/Button'
import { ColorScheme, font, radius, spacing } from '@/lib/theme'
import { useTheme } from '@/lib/ThemeContext'
import { useMemo, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { RESOURCES, type Resource } from './board'
import { resourceColor } from './palette'

const RESOURCE_LABELS: Record<Resource, string> = {
	wood: 'Wood',
	wheat: 'Wheat',
	sheep: 'Sheep',
	brick: 'Brick',
	ore: 'Ore',
}

export function SpecialistDeclareOverlay({
	waitingOn,
	submitting,
	onConfirm,
}: {
	waitingOn: string[]
	submitting: boolean
	onConfirm: (resource: Resource) => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const [pick, setPick] = useState<Resource | null>(null)

	return (
		<Modal transparent animationType="fade" visible>
			<View style={styles.backdrop}>
				<View style={styles.sheet}>
					<Text style={styles.title}>Declare your specialty</Text>
					<Text style={styles.subtitle}>
						Pick the resource you'll specialize in. Any port trade
						that takes this resource as input costs 1 fewer for you.
					</Text>
					<View style={styles.grid}>
						{RESOURCES.map((r) => (
							<Pressable
								key={r}
								onPress={() => setPick(r)}
								style={({ pressed }) => [
									styles.card,
									{ backgroundColor: resourceColor[r] },
									pick === r && styles.cardPicked,
									pressed && styles.pressed,
								]}
							>
								<Text style={styles.cardLabel}>
									{RESOURCE_LABELS[r]}
								</Text>
							</Pressable>
						))}
					</View>
					{waitingOn.length > 0 && (
						<Text style={styles.waiting}>
							Waiting on {waitingOn.join(', ')}…
						</Text>
					)}
					<Button
						onPress={() => pick && onConfirm(pick)}
						disabled={pick === null}
						loading={submitting}
					>
						Confirm
					</Button>
				</View>
			</View>
		</Modal>
	)
}

// Spectator view: a specialist pick is pending but not ours — just wait.
export function SpecialistWaitOverlay({ waitingOn }: { waitingOn: string[] }) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<Modal transparent animationType="fade" visible>
			<View style={styles.backdrop}>
				<View style={styles.sheet}>
					<Text style={styles.title}>Start-of-game picks</Text>
					<Text style={styles.subtitle}>
						Waiting on {waitingOn.join(', ')} to declare their
						specialty.
					</Text>
				</View>
			</View>
		</Modal>
	)
}

// Explorer's "place 3 free roads" affordance during post_placement. Renders
// as a small inline banner with a counter; the actual road picks happen on
// the board (BuildLayer with tool='explorer_road'). Counter goes 3 → 0,
// mirroring `phase.pending.explorer[meIdx]`.
export function ExplorerStatusBanner({
	remaining,
	waitingOn,
}: {
	remaining: number
	waitingOn: string[]
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	if (remaining <= 0 && waitingOn.length === 0) return null
	return (
		<View style={styles.banner}>
			{remaining > 0 ? (
				<Text style={styles.bannerText}>
					Explorer: place {remaining} more free road
					{remaining === 1 ? '' : 's'} on the board.
				</Text>
			) : (
				<Text style={styles.bannerText}>
					Waiting on {waitingOn.join(', ')} to place explorer roads.
				</Text>
			)}
		</View>
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
		cardPicked: {
			borderWidth: 3,
			borderColor: colors.brand,
		},
		cardLabel: {
			fontSize: font.sm,
			fontWeight: '700',
			color: '#1A1A1A',
		},
		waiting: {
			fontSize: font.sm,
			color: colors.textSecondary,
			fontStyle: 'italic',
		},
		banner: {
			marginHorizontal: spacing.md,
			marginBottom: spacing.xs,
			padding: spacing.sm,
			backgroundColor: colors.card,
			borderRadius: radius.sm,
			borderWidth: 1,
			borderColor: colors.border,
		},
		bannerText: {
			fontSize: font.sm,
			fontWeight: '600',
			color: colors.text,
		},
		pressed: {
			opacity: 0.8,
		},
	})
}
