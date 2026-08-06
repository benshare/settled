// The combined status card, floating just above the dock. Two stacked rows in
// one banner:
//   1. the island content — this turn's roll (dice) + whose turn (bold);
//   2. the status line — the most recent action / what the table waits on.
// The status row is omitted when there's nothing to say (a bare roll with
// nobody pending); the island row always shows. Both are uniform across viewers
// (see `status.ts`). Keeps the banner's card styling.
//
// It also carries the honk nudge, on the right: honking is a complaint about
// *this* — the table sitting on the line the banner is showing — so the button
// belongs beside it rather than in the dock, which is about your own turn. It's
// the one interactive thing here, hence `box-none` on the card and `none` on
// the text.

import { useGameScreen } from '@/lib/game/gameScreenContext'
import { HonkButton } from '@/lib/game/gameScreenShared'
import type { GameEvent } from '@/lib/stores/useGamesStore'
import { colors, radius, spacing } from '@/lib/theme'
import { StyleSheet, Text, View } from 'react-native'
import { bannerStatus, islandStatus } from './status'

export function StatusBanner() {
	const {
		game,
		gameState,
		meIdx,
		profilesById,
		submitting,
		onHonk,
		inBonusSelection,
		isSpectator,
	} = useGameScreen()
	if (!game || !gameState) return null
	// The bonus pane owns the screen while a player picks (BoardArea hides the
	// log, legend and utility buttons behind the same gate, and the dock hides
	// itself), and it already names who the table is waiting on. A spectator
	// gets no pane, so the banner stays their readout.
	if (inBonusSelection && !isSpectator) return null
	const ctx = { game, gameState, meIdx, profilesById }
	const { label, dice } = islandStatus(ctx)
	const status = bannerStatus(ctx)

	return (
		<View style={styles.card} pointerEvents="box-none">
			<View style={styles.lines} pointerEvents="none">
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
			{/* Renders nothing until a nudge is actually due — a permanently
			    disabled button would widen the banner for the whole game. Also
			    null for a spectator (`canHonk` rejects a seatless viewer).
			    Slimmed to the status line's own height and bottom-aligned with
			    it (see `card`), so it reads as part of that line rather than as
			    a control the banner is built around. */}
			<HonkButton
				style={styles.honk}
				events={(game.events ?? []) as GameEvent[]}
				phase={gameState.phase}
				meIdx={meIdx}
				currentTurn={game.current_turn ?? 0}
				enabled={gameState.config.honk !== false}
				submitting={submitting}
				onHonk={onHonk}
			/>
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
		flexDirection: 'row',
		// Bottom-aligned, not centred: the nudge belongs to the status line
		// (the banner's last row), which is what it's complaining about.
		alignItems: 'flex-end',
		gap: spacing.sm,
		paddingVertical: 8,
		paddingHorizontal: spacing.md,
		borderRadius: radius.sm,
		backgroundColor: colors.white,
		borderWidth: 1,
		borderColor: colors.border,
		boxShadow: '0px 2px 6px rgba(0,0,0,0.12)',
	},
	// The two text rows, so the honk button can sit beside them rather than
	// under them. `shrink` so a long status line yields to the button instead
	// of pushing it off the card.
	lines: {
		flexShrink: 1,
		alignItems: 'center',
		gap: spacing.sm,
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
	// Overrides the small Button's 38pt height so it sits on the status line
	// rather than towering over it. `minHeight` is the line's own height.
	honk: {
		minHeight: 20,
		paddingVertical: 0,
		paddingHorizontal: spacing.sm,
		borderRadius: radius.sm,
	},
})
