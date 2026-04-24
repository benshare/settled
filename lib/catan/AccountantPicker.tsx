// Modal for the accountant to liquidate one of their pieces back into
// resources. Lists every eligible piece (placedTurn < state.round) plus
// every dev card in hand. Roads that would split the player's road network
// are filtered out so the player isn't shown an action that will fail
// validation server-side.

import { useMemo } from 'react'
import {
	Modal,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native'
import { type Edge, RESOURCES, type Vertex } from './board'
import {
	CITY_REFUND,
	DEV_CARD_REFUND,
	ROAD_REFUND,
	SETTLEMENT_REFUND,
	SUPER_CITY_REFUND,
	roadRemovalSplitsBuildings,
} from './bonus'
import { ColorScheme, font, radius, spacing } from '../theme'
import { useTheme } from '../ThemeContext'
import { devCardById, type DevCardId } from './devCards'
import { resourceColor } from './palette'
import type { GameState, ResourceHand } from './types'

export type LiquidationTarget =
	| { kind: 'road'; edge: Edge }
	| { kind: 'settlement'; vertex: Vertex }
	| { kind: 'city'; vertex: Vertex }
	| { kind: 'super_city'; vertex: Vertex }
	| { kind: 'dev_card'; index: number; id: DevCardId }

export function AccountantPicker({
	state,
	playerIdx,
	submitting,
	onCancel,
	onConfirm,
}: {
	state: GameState
	playerIdx: number
	submitting: boolean
	onCancel: () => void
	onConfirm: (target: LiquidationTarget) => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const targets = useMemo(
		() => buildTargetList(state, playerIdx),
		[state, playerIdx]
	)

	return (
		<Modal
			transparent
			animationType="fade"
			visible
			onRequestClose={onCancel}
		>
			<Pressable style={styles.backdrop} onPress={onCancel}>
				<Pressable style={styles.sheet}>
					<Text style={styles.title}>
						Accountant: liquidate a piece
					</Text>
					<Text style={styles.subtitle}>
						Refunds the full original cost. Pieces placed this turn
						and roads that would disconnect your network are not
						listed.
					</Text>
					<ScrollView style={styles.scroll}>
						{targets.length === 0 && (
							<Text style={styles.empty}>
								Nothing eligible to liquidate yet.
							</Text>
						)}
						{targets.map((t, idx) => (
							<Pressable
								key={`${t.kind}-${idx}`}
								onPress={() => onConfirm(t.target)}
								disabled={submitting}
								style={({ pressed }) => [
									styles.row,
									pressed && !submitting && styles.pressed,
								]}
							>
								<View style={styles.rowMain}>
									<Text style={styles.rowKind}>
										{t.label}
									</Text>
									<Text style={styles.rowSub}>
										{t.detail}
									</Text>
								</View>
								<RefundChips
									refund={t.refund}
									styles={styles}
								/>
							</Pressable>
						))}
					</ScrollView>
					<Pressable
						style={({ pressed }) => [
							styles.cancelBtn,
							pressed && styles.pressed,
						]}
						onPress={onCancel}
					>
						<Text style={styles.cancelText}>Close</Text>
					</Pressable>
				</Pressable>
			</Pressable>
		</Modal>
	)
}

type Listed = {
	kind: LiquidationTarget['kind']
	label: string
	detail: string
	refund: ResourceHand
	target: LiquidationTarget
}

function buildTargetList(state: GameState, playerIdx: number): Listed[] {
	const out: Listed[] = []
	for (const [eidStr, es] of Object.entries(state.edges)) {
		if (!es?.occupied || es.player !== playerIdx) continue
		if (es.placedTurn >= state.round) continue
		const eid = eidStr as Edge
		if (roadRemovalSplitsBuildings(state, playerIdx, eid)) continue
		out.push({
			kind: 'road',
			label: 'Road',
			detail: eid,
			refund: ROAD_REFUND,
			target: { kind: 'road', edge: eid },
		})
	}
	for (const [vidStr, vs] of Object.entries(state.vertices)) {
		if (!vs?.occupied || vs.player !== playerIdx) continue
		if (vs.placedTurn >= state.round) continue
		const vid = vidStr as Vertex
		if (vs.building === 'settlement') {
			out.push({
				kind: 'settlement',
				label: 'Settlement',
				detail: vid,
				refund: SETTLEMENT_REFUND,
				target: { kind: 'settlement', vertex: vid },
			})
		} else if (vs.building === 'city') {
			out.push({
				kind: 'city',
				label: 'City → settlement',
				detail: vid,
				refund: CITY_REFUND,
				target: { kind: 'city', vertex: vid },
			})
		} else if (vs.building === 'super_city') {
			out.push({
				kind: 'super_city',
				label: 'Super City → city',
				detail: vid,
				refund: SUPER_CITY_REFUND,
				target: { kind: 'super_city', vertex: vid },
			})
		}
	}
	const me = state.players[playerIdx]
	me.devCards.forEach((entry, idx) => {
		if (entry.purchasedTurn >= state.round) return
		const data = devCardById(entry.id)
		out.push({
			kind: 'dev_card',
			label: 'Dev card',
			detail: data?.title ?? entry.id,
			refund: DEV_CARD_REFUND,
			target: { kind: 'dev_card', index: idx, id: entry.id },
		})
	})
	return out
}

function RefundChips({
	refund,
	styles,
}: {
	refund: ResourceHand
	styles: ReturnType<typeof makeStyles>
}) {
	return (
		<View style={styles.chipRow}>
			{RESOURCES.filter((r) => refund[r] > 0).map((r) => (
				<View
					key={r}
					style={[styles.chip, { backgroundColor: resourceColor[r] }]}
				>
					<Text style={styles.chipText}>+{refund[r]}</Text>
				</View>
			))}
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
			maxWidth: 460,
			maxHeight: '85%',
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
		scroll: {
			maxHeight: 360,
		},
		empty: {
			fontSize: font.sm,
			color: colors.textMuted,
			textAlign: 'center',
			paddingVertical: spacing.md,
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
			marginBottom: spacing.xs,
		},
		rowMain: {
			flex: 1,
		},
		rowKind: {
			fontSize: font.base,
			fontWeight: '700',
			color: colors.text,
		},
		rowSub: {
			fontSize: font.xs,
			color: colors.textSecondary,
		},
		chipRow: {
			flexDirection: 'row',
			gap: 4,
		},
		chip: {
			paddingHorizontal: 6,
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
		pressed: {
			opacity: 0.85,
		},
		cancelBtn: {
			alignItems: 'center',
			paddingVertical: spacing.sm,
		},
		cancelText: {
			fontSize: font.base,
			color: colors.textSecondary,
			fontWeight: '600',
		},
	})
}
