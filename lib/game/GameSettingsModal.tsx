// Read-only view of the settings a game was created with, opened from either
// layout's overflow menu. Labels track `app/create-game.tsx` so a setting reads
// the same here as where it was chosen; rows that couldn't apply to this game
// (bonus options with bonuses off, extra build at ≤4 players) are left out,
// mirroring the create form.

import { timeoutLabel } from '@/lib/catan/timeout'
import {
	monopolyCap,
	parseGameConfig,
	type GameConfig,
} from '@/lib/catan/types'
import { Modal } from '@/lib/modules/Modal'
import { colors, font, radius, spacing } from '@/lib/theme'
import { ScrollView, StyleSheet, Text, View } from 'react-native'

export function GameSettingsModal({
	visible,
	config,
	playerCount,
	onDismiss,
}: {
	visible: boolean
	config: unknown
	playerCount: number
	onDismiss: () => void
}) {
	const rows = settingRows(parseGameConfig(config), playerCount)
	return (
		<Modal
			visible={visible}
			onDismiss={onDismiss}
			contentStyle={styles.sheet}
		>
			<Text style={styles.title}>Game settings</Text>
			<ScrollView style={styles.list}>
				{rows.map(([label, value]) => (
					<View key={label} style={styles.row}>
						<Text style={styles.label}>{label}</Text>
						<Text style={styles.value}>{value}</Text>
					</View>
				))}
			</ScrollView>
		</Modal>
	)
}

function settingRows(
	config: GameConfig,
	playerCount: number
): [string, string][] {
	const onOff = (b: boolean) => (b ? 'On' : 'Off')
	const rows: [string, string][] = [
		['Dev cards', onOff(config.devCards)],
		['Random numbers', onOff(config.numberLayout === 'random')],
		['Honking', onOff(config.honk)],
		['Friendly robber', onOff(config.friendlyRobber)],
		['Allow spectators', onOff(config.spectators)],
	]
	if (config.devCards) {
		rows.push([
			'Limit monopoly',
			config.limitMonopoly
				? `On (${monopolyCap(playerCount)} per player)`
				: 'Off',
		])
	}
	rows.push([
		'Move timeout',
		config.timeout === null ? 'Off' : timeoutLabel(config.timeout),
	])
	rows.push([
		'Trades',
		config.tradeMode === 'confirm' ? 'Confirm' : 'Automatic',
	])
	if (playerCount > 4) {
		const eb = config.extraBuild
		rows.push(['Extra build phases', onOff(eb.enabled)])
		if (eb.enabled) {
			rows.push([
				'Build phases',
				eb.buildPhases === 'across' ? 'Across' : 'Every roll',
			])
			rows.push([
				'Allow building',
				eb.moreThanSeven ? 'Over 7 cards' : 'Always',
			])
		}
	}
	rows.push(['Bonuses', onOff(config.bonuses)])
	if (config.bonuses) {
		rows.push([
			'Bonus sets',
			[...config.bonusSets]
				.sort()
				.map((s) => `Set ${s}`)
				.join(', '),
		])
		rows.push(['Bonus cards', String(config.bonusCount)])
		rows.push(['Curse cards', String(config.curseCount)])
		rows.push(['Ban bad combos', onOff(config.bannedCombos)])
	}
	return rows
}

const styles = StyleSheet.create({
	sheet: {
		width: '100%',
		maxWidth: 420,
		maxHeight: '80%',
		backgroundColor: colors.background,
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: colors.border,
		overflow: 'hidden',
	},
	title: {
		fontSize: font.md,
		fontWeight: '700',
		color: colors.text,
		padding: spacing.md,
		borderBottomWidth: 1,
		borderBottomColor: colors.border,
	},
	list: {
		flexGrow: 0,
	},
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: spacing.md,
		paddingVertical: spacing.sm,
		paddingHorizontal: spacing.md,
		borderBottomWidth: 1,
		borderBottomColor: colors.borderLight,
	},
	label: {
		fontSize: font.base,
		color: colors.text,
	},
	value: {
		fontSize: font.base,
		fontWeight: '600',
		color: colors.textSecondary,
	},
})
