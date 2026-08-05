// The combined status card, floating just above the dock. Two stacked rows in
// one banner:
//   1. the island content — this turn's roll (dice) + whose turn (bold);
//   2. the status line — the most recent action / what the table waits on.
// The status row is omitted when there's nothing to say (a bare roll with
// nobody pending); the island row always shows. Both are uniform across viewers
// (see `status.ts`). Keeps the banner's card styling.

import { useGameScreen } from '@/lib/game/gameScreenContext'
import { colors, radius, spacing } from '@/lib/theme'
import { StyleSheet, Text, View } from 'react-native'
import { bannerStatus, islandStatus } from './status'

export function StatusBanner() {
	const { game, gameState, meIdx, profilesById } = useGameScreen()
	if (!game || !gameState) return null
	const ctx = { game, gameState, meIdx, profilesById }
	const { label, dice } = islandStatus(ctx)
	const status = bannerStatus(ctx)

	return (
		<View style={styles.card} pointerEvents="none">
			<View style={styles.islandRow}>
				{dice && (
					<View style={styles.dice}>
						<Pip value={dice.a} />
						<Pip value={dice.b} />
					</View>
				)}
				<Text style={styles.islandLabel} numberOfLines={1}>
					{label}
				</Text>
			</View>
			{status && (
				<Text style={styles.statusText} numberOfLines={2}>
					{status}
				</Text>
			)}
		</View>
	)
}

function Pip({ value }: { value: number }) {
	return (
		<View style={styles.pip}>
			<Text style={styles.pipText}>{value}</Text>
		</View>
	)
}

const styles = StyleSheet.create({
	card: {
		maxWidth: '96%',
		alignItems: 'center',
		gap: spacing.sm,
		paddingVertical: 8,
		paddingHorizontal: spacing.md,
		borderRadius: radius.sm,
		backgroundColor: colors.white,
		borderWidth: 1,
		borderColor: colors.border,
		boxShadow: '0px 2px 6px rgba(0,0,0,0.12)',
	},
	islandRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
	},
	dice: {
		flexDirection: 'row',
		gap: 4,
	},
	pip: {
		width: 22,
		height: 22,
		borderRadius: radius.sm,
		backgroundColor: '#F4EAD0',
		borderWidth: 1,
		borderColor: '#2B2B2B',
		alignItems: 'center',
		justifyContent: 'center',
	},
	pipText: {
		fontSize: 13,
		fontWeight: '700',
		color: '#1A1A1A',
	},
	islandLabel: {
		fontSize: 16,
		fontWeight: '700',
		color: colors.text,
	},
	statusText: {
		fontSize: 13,
		fontWeight: '600',
		color: colors.text,
		textAlign: 'center',
	},
})
