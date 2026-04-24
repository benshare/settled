import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Tooltip } from '../modules/Tooltip'
import { colors, font, radius, spacing } from '../theme'
import type { BuildKind } from './build'
import type { CurseHint } from './curses'
import { playerColors } from './palette'

type BuildOption = {
	key: BuildKind | 'dev_card'
	label: string
	icon: React.ComponentProps<typeof Ionicons>['name']
}

const BUILD_OPTIONS: readonly BuildOption[] = [
	{ key: 'road', label: 'Road', icon: 'trail-sign-outline' },
	{ key: 'settlement', label: 'Settlement', icon: 'home-outline' },
	{ key: 'city', label: 'City', icon: 'business-outline' },
	{ key: 'dev_card', label: 'Dev card', icon: 'albums-outline' },
]

export type BuildEnablement = Record<BuildKind | 'dev_card', boolean>
export type BuildCurseHints = Partial<Record<BuildKind | 'dev_card', CurseHint>>

export function BuildTradeBar({
	active,
	enabled,
	curseHints,
	meIdx,
	tradeEnabled,
	tradeActive,
	devCardsEnabled,
	onSelect,
	onTradePress,
	onBuyDevCard,
}: {
	active: BuildKind | null
	enabled: BuildEnablement
	// Per-kind curse hint: when present, the button shows a curse-icon badge
	// and a tooltip with the reason, even if the button is also disabled for
	// unrelated reasons (resources / turn / phase).
	curseHints?: BuildCurseHints
	meIdx: number
	tradeEnabled: boolean
	tradeActive: boolean
	// Config gate: when the game wasn't created with dev cards, the button
	// is hidden entirely rather than just disabled.
	devCardsEnabled: boolean
	onSelect: (tool: BuildKind) => void
	onTradePress: () => void
	onBuyDevCard: () => void
}) {
	const color = playerColors[meIdx] ?? playerColors[0]
	const tradeInteractive = tradeEnabled || tradeActive
	const options = devCardsEnabled
		? BUILD_OPTIONS
		: BUILD_OPTIONS.filter((o) => o.key !== 'dev_card')
	return (
		<View style={styles.row}>
			<View style={[styles.panel, styles.buildPanel]}>
				<Text style={styles.title}>Build</Text>
				<View style={styles.iconRow}>
					{options.map((opt) => (
						<BuildIconButton
							key={opt.key}
							option={opt}
							enabled={enabled[opt.key]}
							active={
								opt.key !== 'dev_card' && active === opt.key
							}
							curseHint={curseHints?.[opt.key]}
							meIdx={meIdx}
							onPress={() => {
								if (opt.key === 'dev_card') {
									onBuyDevCard()
									return
								}
								onSelect(opt.key)
							}}
						/>
					))}
				</View>
			</View>

			<Pressable
				disabled={!tradeInteractive}
				onPress={onTradePress}
				style={({ pressed }) => [
					styles.panel,
					styles.tradePanel,
					!tradeInteractive && styles.panelDisabled,
					tradeActive && { borderColor: color, borderWidth: 2 },
					pressed && tradeInteractive && styles.pressed,
				]}
			>
				<Text style={styles.title}>Trade</Text>
				<View style={styles.tradeBody}>
					<Ionicons
						name="swap-horizontal"
						size={24}
						color={
							tradeInteractive ? colors.text : colors.textMuted
						}
					/>
				</View>
				{tradeActive && (
					<View style={styles.cancelBadge}>
						<Ionicons name="close" size={12} color={colors.white} />
					</View>
				)}
			</Pressable>
		</View>
	)
}

function BuildIconButton({
	option,
	enabled,
	active,
	curseHint,
	meIdx,
	onPress,
}: {
	option: BuildOption
	enabled: boolean
	active: boolean
	curseHint: CurseHint | undefined
	meIdx: number
	onPress: () => void
}) {
	const color = playerColors[meIdx] ?? playerColors[0]
	// A curse hint means the action is currently blocked by the player's
	// curse, so the button must be non-interactive regardless of other
	// enablement signals.
	const interactive = (enabled || active) && !curseHint
	const button = (
		<Pressable
			disabled={!interactive}
			onPress={onPress}
			style={({ pressed }) => [
				styles.iconBtn,
				active && { borderColor: color, borderWidth: 2 },
				!interactive && styles.iconBtnDisabled,
				pressed && interactive && styles.pressed,
			]}
			accessibilityLabel={
				active ? `Cancel ${option.label}` : option.label
			}
		>
			<Ionicons
				name={option.icon}
				size={22}
				color={interactive ? colors.text : colors.textMuted}
			/>
			{active && (
				<View style={styles.cancelBadge}>
					<Ionicons name="close" size={12} color={colors.white} />
				</View>
			)}
			{curseHint && !active && (
				<View style={styles.curseBadge}>
					<Ionicons
						name={curseHint.icon}
						size={10}
						color={colors.white}
					/>
				</View>
			)}
		</Pressable>
	)
	if (curseHint) {
		return <Tooltip label={curseHint.reason}>{button}</Tooltip>
	}
	return button
}

const styles = StyleSheet.create({
	row: {
		flexDirection: 'row',
		alignItems: 'stretch',
		justifyContent: 'space-between',
		gap: spacing.sm,
		paddingHorizontal: spacing.md,
		paddingTop: spacing.xs,
		paddingBottom: spacing.sm,
	},
	panel: {
		backgroundColor: colors.card,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		paddingHorizontal: spacing.sm,
		paddingVertical: spacing.sm,
		gap: spacing.xs,
		shadowColor: '#000',
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.08,
		shadowRadius: 6,
		elevation: 2,
	},
	panelDisabled: {
		opacity: 0.45,
	},
	buildPanel: {
		flex: 1,
	},
	tradePanel: {
		minWidth: 96,
		alignItems: 'center',
	},
	title: {
		fontSize: font.sm,
		fontWeight: '700',
		color: colors.textSecondary,
		letterSpacing: 0.3,
		textTransform: 'uppercase',
	},
	iconRow: {
		flexDirection: 'row',
		gap: spacing.xs,
	},
	iconBtn: {
		flex: 1,
		height: 40,
		borderRadius: radius.sm,
		backgroundColor: colors.white,
		borderWidth: 1,
		borderColor: colors.border,
		alignItems: 'center',
		justifyContent: 'center',
	},
	iconBtnDisabled: {
		opacity: 0.4,
	},
	cancelBadge: {
		position: 'absolute',
		top: -6,
		right: -6,
		width: 18,
		height: 18,
		borderRadius: 9,
		backgroundColor: colors.error,
		alignItems: 'center',
		justifyContent: 'center',
	},
	curseBadge: {
		position: 'absolute',
		top: -6,
		right: -6,
		width: 16,
		height: 16,
		borderRadius: 8,
		backgroundColor: colors.error,
		alignItems: 'center',
		justifyContent: 'center',
		borderWidth: 1,
		borderColor: colors.card,
	},
	tradeBody: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
		minHeight: 40,
	},
	pressed: {
		opacity: 0.7,
	},
})
