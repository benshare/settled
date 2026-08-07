// The combined status card, floating just above the dock. Two stacked rows in
// one banner:
//   1. the island content — this turn's roll (dice) + whose turn (bold);
//   2. the status line — the most recent action / what the table waits on.
// The status row is omitted when there's nothing to say (a bare roll with
// nobody pending); the island row always shows. Both are uniform across viewers
// (see `status.ts`). Keeps the banner's card styling.
//
// It also carries the two nudge-at-the-line controls, on the right: the honk
// (a complaint about *this* — the table sitting on the line the banner is
// showing) and the undo arrow (taking back the action the line is reporting).
// Both are about the banner's own line rather than about your turn, which is
// what the dock is for, and they're mutually exclusive in practice — you can
// only honk at someone else and only undo your own move — so they share the
// slot. They're the only interactive things here, hence `box-none` on the card
// and `none` on the text.

import { useGameScreen } from '@/lib/game/gameScreenContext'
import {
	DieFaceView,
	HonkButton,
	UndoButton,
} from '@/lib/game/gameScreenShared'
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
		canUndo,
		onUndo,
		inBonusSelection,
		isSpectator,
		placementStage,
	} = useGameScreen()
	if (!game || !gameState) return null
	// The bonus pane owns the screen while a player picks (BoardArea hides the
	// log, legend and utility buttons behind the same gate, and the dock hides
	// itself), and it already names who the table is waiting on. A spectator
	// gets no pane, so the banner stays their readout.
	if (inBonusSelection && !isSpectator) return null
	const ctx = { game, gameState, meIdx, profilesById, placementStage }
	const { label, dice } = islandStatus(ctx)
	const status = bannerStatus(ctx)

	return (
		<View style={styles.card} pointerEvents="box-none">
			<View style={styles.lines} pointerEvents="none">
				<View style={styles.islandRow}>
					{dice && (
						<View style={styles.dice}>
							<DieFaceView value={dice.a} tone="red" size={22} />
							<DieFaceView
								value={dice.b}
								tone="yellow"
								size={22}
							/>
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
				currentTurn={gameState.currentTurn ?? 0}
				enabled={gameState.config.honk !== false}
				submitting={submitting}
				onHonk={onHonk}
			/>
			{/* Same slot, same slimming: rendered only when the server would
			    accept a take-back of this seat's last action. */}
			{canUndo && (
				<UndoButton
					style={styles.undo}
					iconSize={13}
					submitting={submitting}
					onPress={onUndo}
				/>
			)}
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
	// Same treatment for the arrow, whose default is a 52pt row square: shrunk
	// to the honk's height so the two read as one slot.
	undo: {
		width: 26,
		height: 20,
		borderRadius: radius.sm,
	},
})
