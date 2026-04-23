// Viewer's dev-card hand. Compact row of grouped tiles rendered in the main
// HUD, beside ResourceHand. Tapping a group opens a play sheet with the
// card's description; tapping Play either dispatches directly (Knight,
// Road Building) or opens the resource picker (Monopoly, Year of Plenty).
// VP cards are shown for information only — they're not playable.

import { Ionicons } from '@expo/vector-icons'
import { useMemo, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, font, radius, spacing } from '../theme'
import { DEV_CARD_POOL, devCardById, type DevCardId } from './devCards'
import { MonopolyPicker } from './MonopolyPicker'
import type { DevCardEntry } from './types'
import { YearOfPlentyPicker } from './YearOfPlentyPicker'
import type { Resource } from './board'

type GroupKey = DevCardId

type Group = {
	id: GroupKey
	count: number
	// Youngest entry in the stack — used to decide if any card in the stack
	// is playable this turn.
	oldestPurchasedTurn: number
}

function groupHand(entries: DevCardEntry[]): Group[] {
	const map = new Map<GroupKey, Group>()
	for (const e of entries) {
		const prev = map.get(e.id)
		if (prev) {
			prev.count += 1
			prev.oldestPurchasedTurn = Math.min(
				prev.oldestPurchasedTurn,
				e.purchasedTurn
			)
		} else {
			map.set(e.id, {
				id: e.id,
				count: 1,
				oldestPurchasedTurn: e.purchasedTurn,
			})
		}
	}
	// Order matches DEV_CARD_POOL so the UI is stable.
	return DEV_CARD_POOL.map((c) => map.get(c.id)).filter(
		(g): g is Group => g !== undefined
	)
}

export type DevPlayPayload =
	| { id: 'knight' | 'road_building' }
	| { id: 'year_of_plenty'; r1: Resource; r2: Resource }
	| { id: 'monopoly'; resource: Resource }

export function DevCardHand({
	entries,
	round,
	myTurn,
	phaseKind,
	playedDevThisTurn,
	onPlay,
}: {
	entries: DevCardEntry[]
	round: number
	myTurn: boolean
	phaseKind: string
	playedDevThisTurn: boolean
	onPlay: (p: DevPlayPayload) => void
}) {
	const groups = useMemo(() => groupHand(entries), [entries])
	const [openGroup, setOpenGroup] = useState<GroupKey | null>(null)
	const [pickerFor, setPickerFor] = useState<
		'monopoly' | 'year_of_plenty' | null
	>(null)

	if (groups.length === 0) return null

	function reasonUnplayable(group: Group): string | null {
		if (group.id === 'victory_point')
			return 'Counts silently toward your score.'
		if (!myTurn) return 'Wait for your turn.'
		if (phaseKind !== 'main' && phaseKind !== 'roll')
			return 'Wait for the next turn.'
		if (playedDevThisTurn) return 'One dev card per turn.'
		if (group.oldestPurchasedTurn >= round) return 'Available next turn.'
		return null
	}

	const openCard = openGroup ? devCardById(openGroup) : null
	const openReason = openGroup
		? reasonUnplayable(groups.find((g) => g.id === openGroup)!)
		: null

	function onPlayPress() {
		if (!openGroup) return
		if (openGroup === 'monopoly') {
			setPickerFor('monopoly')
			return
		}
		if (openGroup === 'year_of_plenty') {
			setPickerFor('year_of_plenty')
			return
		}
		onPlay({ id: openGroup as 'knight' | 'road_building' })
		setOpenGroup(null)
	}

	return (
		<View style={styles.row}>
			{groups.map((g) => {
				const card = devCardById(g.id)
				if (!card) return null
				const disabled = reasonUnplayable(g) !== null
				return (
					<Pressable
						key={g.id}
						style={({ pressed }) => [
							styles.tile,
							disabled && styles.tileDim,
							pressed && styles.pressed,
						]}
						onPress={() => setOpenGroup(g.id)}
					>
						<Ionicons
							name={card.icon}
							size={18}
							color={disabled ? colors.textMuted : colors.text}
						/>
						<Text style={styles.tileLabel} numberOfLines={1}>
							{card.title}
						</Text>
						{g.count > 1 && (
							<View style={styles.badge}>
								<Text style={styles.badgeText}>{g.count}</Text>
							</View>
						)}
					</Pressable>
				)
			})}

			<Modal
				transparent
				animationType="fade"
				visible={openGroup !== null && pickerFor === null}
				onRequestClose={() => setOpenGroup(null)}
			>
				<Pressable
					style={styles.backdrop}
					onPress={() => setOpenGroup(null)}
				>
					<Pressable style={styles.sheet}>
						{openCard && (
							<>
								<View style={styles.sheetHeader}>
									<Ionicons
										name={openCard.icon}
										size={24}
										color={colors.text}
									/>
									<Text style={styles.sheetTitle}>
										{openCard.title}
									</Text>
								</View>
								<Text style={styles.sheetDescription}>
									{openCard.description}
								</Text>
								{openReason ? (
									<Text style={styles.sheetHint}>
										{openReason}
									</Text>
								) : (
									<Pressable
										style={({ pressed }) => [
											styles.playBtn,
											pressed && styles.pressed,
										]}
										onPress={onPlayPress}
									>
										<Text style={styles.playBtnText}>
											Play
										</Text>
									</Pressable>
								)}
							</>
						)}
					</Pressable>
				</Pressable>
			</Modal>

			{pickerFor === 'monopoly' && (
				<MonopolyPicker
					onCancel={() => setPickerFor(null)}
					onConfirm={(resource) => {
						setPickerFor(null)
						setOpenGroup(null)
						onPlay({ id: 'monopoly', resource })
					}}
				/>
			)}
			{pickerFor === 'year_of_plenty' && (
				<YearOfPlentyPicker
					onCancel={() => setPickerFor(null)}
					onConfirm={(r1, r2) => {
						setPickerFor(null)
						setOpenGroup(null)
						onPlay({ id: 'year_of_plenty', r1, r2 })
					}}
				/>
			)}
		</View>
	)
}

const styles = StyleSheet.create({
	row: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: spacing.xs,
		paddingHorizontal: spacing.md,
		paddingBottom: spacing.xs,
	},
	tile: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
		paddingHorizontal: spacing.sm,
		paddingVertical: 6,
		borderRadius: radius.sm,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.card,
	},
	tileDim: {
		opacity: 0.55,
	},
	tileLabel: {
		fontSize: font.sm,
		color: colors.text,
		fontWeight: '600',
	},
	badge: {
		marginLeft: 2,
		paddingHorizontal: 6,
		paddingVertical: 1,
		borderRadius: radius.full,
		backgroundColor: colors.brand,
	},
	badgeText: {
		fontSize: font.xs,
		fontWeight: '700',
		color: colors.white,
	},
	pressed: {
		opacity: 0.75,
	},
	backdrop: {
		flex: 1,
		backgroundColor: 'rgba(0,0,0,0.4)',
		alignItems: 'center',
		justifyContent: 'center',
		padding: spacing.lg,
	},
	sheet: {
		width: '100%',
		maxWidth: 360,
		backgroundColor: colors.card,
		borderRadius: radius.md,
		padding: spacing.lg,
		gap: spacing.md,
	},
	sheetHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
	},
	sheetTitle: {
		fontSize: font.lg,
		fontWeight: '700',
		color: colors.text,
	},
	sheetDescription: {
		fontSize: font.base,
		color: colors.textSecondary,
	},
	sheetHint: {
		fontSize: font.sm,
		color: colors.textMuted,
		fontStyle: 'italic',
	},
	playBtn: {
		backgroundColor: colors.brand,
		borderRadius: radius.sm,
		paddingVertical: spacing.sm,
		alignItems: 'center',
	},
	playBtnText: {
		color: colors.white,
		fontWeight: '700',
		fontSize: font.md,
	},
})
