import {
	Pressable,
	StyleSheet,
	Text,
	View,
	type StyleProp,
	type ViewStyle,
} from 'react-native'
import { colors, font, radius, shadow, spacing } from '../theme'

import { Ionicons } from '@expo/vector-icons'
import { Tooltip } from '../modules/Tooltip'
import type { BuildKind } from './build'
import type { CurseHint } from './curses'

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
	color,
	tradeEnabled,
	tradeActive,
	showTrade = true,
	flush = false,
	devCardsEnabled,
	carpenterEnabled,
	superCityEnabled,
	superCityActive,
	accountantEnabled,
	investorEnabled,
	onSelect,
	onTradePress,
	onBuyDevCard,
	onBuyCarpenterVP,
	onSelectSuperCity,
	onAccountant,
	onInvest,
}: {
	active: BuildKind | 'super_city' | null
	enabled: BuildEnablement
	// Per-kind curse hint: when present, the button shows a curse-icon badge
	// and a tooltip with the reason, even if the button is also disabled for
	// unrelated reasons (resources / turn / phase).
	curseHints?: BuildCurseHints
	color: string
	tradeEnabled: boolean
	tradeActive: boolean
	// When false, the trade button is left out entirely and the build panel
	// spans the row on its own — the HUD dock renders trade separately, in a
	// row of its own alongside the turn's primary action.
	showTrade?: boolean
	// Drops the outer row's padding so the build panel sits flush to its
	// container — the dock uses it so the panel's width matches the trade +
	// primary-action row directly below it.
	flush?: boolean
	// Config gate: when the game wasn't created with dev cards, the button
	// is hidden entirely rather than just disabled.
	devCardsEnabled: boolean
	// Carpenter-bonus-only button. Undefined = player is not carpenter and
	// the button is hidden. Boolean = eligible to buy (enabled/disabled).
	carpenterEnabled?: boolean
	// Metropolitan-bonus-only button. Undefined = not metropolitan and
	// hidden. Boolean = eligible to upgrade.
	superCityEnabled?: boolean
	superCityActive?: boolean
	// Accountant-bonus-only button. Undefined = not accountant and hidden.
	// Boolean = liquidation modal can be opened.
	accountantEnabled?: boolean
	// Investor-bonus-only button. Undefined = not investor and hidden.
	// Boolean = eligible to set aside a trio (≥3 VP, ≥3 of a resource, cap).
	investorEnabled?: boolean
	onSelect: (tool: BuildKind) => void
	// Optional: only consumed by the built-in trade button, which the dock
	// omits (showTrade={false}) in favour of rendering trade itself.
	onTradePress?: () => void
	onBuyDevCard: () => void
	onBuyCarpenterVP?: () => void
	onSelectSuperCity?: () => void
	onAccountant?: () => void
	onInvest?: () => void
}) {
	const options = devCardsEnabled
		? BUILD_OPTIONS
		: BUILD_OPTIONS.filter((o) => o.key !== 'dev_card')
	return (
		<View style={[styles.row, flush && styles.rowFlush]}>
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
							color={color}
							onPress={() => {
								if (opt.key === 'dev_card') {
									onBuyDevCard()
									return
								}
								onSelect(opt.key)
							}}
						/>
					))}
					{carpenterEnabled !== undefined && (
						<CarpenterVPButton
							enabled={carpenterEnabled}
							onPress={() => onBuyCarpenterVP?.()}
						/>
					)}
					{superCityEnabled !== undefined && (
						<SuperCityButton
							enabled={superCityEnabled}
							active={!!superCityActive}
							color={color}
							onPress={() => onSelectSuperCity?.()}
						/>
					)}
					{accountantEnabled !== undefined && (
						<AccountantButton
							enabled={accountantEnabled}
							onPress={() => onAccountant?.()}
						/>
					)}
					{investorEnabled !== undefined && (
						<InvestorButton
							enabled={investorEnabled}
							onPress={() => onInvest?.()}
						/>
					)}
				</View>
			</View>

			{showTrade && onTradePress && (
				<TradeButton
					tradeEnabled={tradeEnabled}
					tradeActive={tradeActive}
					color={color}
					onTradePress={onTradePress}
				/>
			)}
		</View>
	)
}

// The trade affordance. `compact` is a short horizontal pill (icon + label) the
// height of a small button, used by the HUD dock where trade shares a row with
// the turn's primary action; the default is the taller title-over-icon panel
// that mirrors the build panel in the classic bar.
export function TradeButton({
	tradeEnabled,
	tradeActive,
	color,
	compact = false,
	onTradePress,
	style,
}: {
	tradeEnabled: boolean
	tradeActive: boolean
	color: string
	compact?: boolean
	onTradePress: () => void
	style?: StyleProp<ViewStyle>
}) {
	const tradeInteractive = tradeEnabled || tradeActive
	if (compact) {
		return (
			<Pressable
				disabled={!tradeInteractive}
				onPress={onTradePress}
				style={({ pressed }) => [
					styles.tradeCompact,
					!tradeInteractive && styles.panelDisabled,
					tradeActive && { borderColor: color, borderWidth: 2 },
					pressed && tradeInteractive && styles.pressed,
					style,
				]}
			>
				<Ionicons
					name="swap-horizontal"
					size={18}
					color={tradeInteractive ? colors.text : colors.textMuted}
				/>
				<Text
					style={[
						styles.tradeCompactLabel,
						!tradeInteractive && { color: colors.textMuted },
					]}
				>
					Trade
				</Text>
				{tradeActive && (
					<View style={styles.cancelBadge}>
						<Ionicons name="close" size={12} color={colors.white} />
					</View>
				)}
			</Pressable>
		)
	}
	return (
		<Pressable
			disabled={!tradeInteractive}
			onPress={onTradePress}
			style={({ pressed }) => [
				styles.panel,
				styles.tradePanel,
				!tradeInteractive && styles.panelDisabled,
				tradeActive && { borderColor: color, borderWidth: 2 },
				pressed && tradeInteractive && styles.pressed,
				style,
			]}
		>
			<Text style={styles.title}>Trade</Text>
			<View style={styles.tradeBody}>
				<Ionicons
					name="swap-horizontal"
					size={24}
					color={tradeInteractive ? colors.text : colors.textMuted}
				/>
			</View>
			{tradeActive && (
				<View style={styles.cancelBadge}>
					<Ionicons name="close" size={12} color={colors.white} />
				</View>
			)}
		</Pressable>
	)
}

function BuildIconButton({
	option,
	enabled,
	active,
	curseHint,
	color,
	onPress,
}: {
	option: BuildOption
	enabled: boolean
	active: boolean
	curseHint: CurseHint | undefined
	color: string
	onPress: () => void
}) {
	// A curse hint means the action is currently blocked by the player's
	// curse, so the button must be non-interactive regardless of other
	// enablement signals.
	const interactive = (enabled || active) && !curseHint
	// Any disabled button — curse or resource/turn — keeps its full-size shape
	// and dims, with the curse badge (when present) sitting on top as the
	// reason. Never replace the button with a bare icon; that shifts the row.
	const dim = !interactive
	const button = (
		<Pressable
			disabled={!interactive}
			onPress={onPress}
			style={({ pressed }) => [
				styles.iconBtn,
				active && { borderColor: color, borderWidth: 2 },
				dim && styles.iconBtnDisabled,
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
		return (
			<Tooltip label={curseHint.reason} style={styles.iconSlot}>
				{button}
			</Tooltip>
		)
	}
	return button
}

function CarpenterVPButton({
	enabled,
	onPress,
}: {
	enabled: boolean
	onPress: () => void
}) {
	return (
		<Pressable
			disabled={!enabled}
			onPress={onPress}
			style={({ pressed }) => [
				styles.iconBtn,
				styles.carpenterBtn,
				!enabled && styles.iconBtnDisabled,
				pressed && enabled && styles.pressed,
			]}
			accessibilityLabel="Carpenter: spend 4 Wood for 1 VP"
		>
			<Ionicons
				name="construct-outline"
				size={20}
				color={enabled ? colors.white : colors.textMuted}
			/>
			<Text
				style={[
					styles.carpenterCostLabel,
					!enabled && { color: colors.textMuted },
				]}
			>
				4W→VP
			</Text>
		</Pressable>
	)
}

function SuperCityButton({
	enabled,
	active,
	color,
	onPress,
}: {
	enabled: boolean
	active: boolean
	color: string
	onPress: () => void
}) {
	const interactive = enabled || active
	return (
		<Pressable
			disabled={!interactive}
			onPress={onPress}
			style={({ pressed }) => [
				styles.iconBtn,
				styles.superCityBtn,
				active && { borderColor: color, borderWidth: 2 },
				!interactive && styles.iconBtnDisabled,
				pressed && interactive && styles.pressed,
			]}
			accessibilityLabel={
				active
					? 'Cancel Super City upgrade'
					: 'Metropolitan: upgrade a city to a Super City'
			}
		>
			<Ionicons
				name="business"
				size={20}
				color={interactive ? colors.white : colors.textMuted}
			/>
			<Text
				style={[
					styles.carpenterCostLabel,
					!interactive && { color: colors.textMuted },
				]}
			>
				Super
			</Text>
			{active && (
				<View style={styles.cancelBadge}>
					<Ionicons name="close" size={12} color={colors.white} />
				</View>
			)}
		</Pressable>
	)
}

function AccountantButton({
	enabled,
	onPress,
}: {
	enabled: boolean
	onPress: () => void
}) {
	return (
		<Pressable
			disabled={!enabled}
			onPress={onPress}
			style={({ pressed }) => [
				styles.iconBtn,
				styles.accountantBtn,
				!enabled && styles.iconBtnDisabled,
				pressed && enabled && styles.pressed,
			]}
			accessibilityLabel="Accountant: liquidate a piece for resources"
		>
			<Ionicons
				name="calculator-outline"
				size={20}
				color={enabled ? colors.white : colors.textMuted}
			/>
			<Text
				style={[
					styles.carpenterCostLabel,
					!enabled && { color: colors.textMuted },
				]}
			>
				Liquid
			</Text>
		</Pressable>
	)
}

function InvestorButton({
	enabled,
	onPress,
}: {
	enabled: boolean
	onPress: () => void
}) {
	return (
		<Pressable
			disabled={!enabled}
			onPress={onPress}
			style={({ pressed }) => [
				styles.iconBtn,
				styles.investorBtn,
				!enabled && styles.iconBtnDisabled,
				pressed && enabled && styles.pressed,
			]}
			accessibilityLabel="Investor: set aside 3 of a resource for a token"
		>
			<Ionicons
				name="trending-up-outline"
				size={20}
				color={enabled ? colors.white : colors.textMuted}
			/>
			<Text
				style={[
					styles.carpenterCostLabel,
					!enabled && { color: colors.textMuted },
				]}
			>
				Invest
			</Text>
		</Pressable>
	)
}

const styles = StyleSheet.create({
	row: {
		flexDirection: 'row',
		alignItems: 'stretch',
		justifyContent: 'space-between',
		// Wraps the trade panel below the build panel when the bar is placed in
		// a narrow column (the HUD dock); stays one row at full width (classic).
		flexWrap: 'wrap',
		gap: spacing.sm,
		paddingHorizontal: spacing.md,
		paddingTop: spacing.xs,
		paddingBottom: spacing.sm,
	},
	// Dock: no outer padding, so the build panel is flush to the right column and
	// its width matches the trade + primary-action row below it.
	rowFlush: {
		paddingHorizontal: 0,
		paddingTop: 0,
		paddingBottom: 0,
	},
	panel: {
		backgroundColor: colors.card,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		paddingHorizontal: spacing.sm,
		paddingVertical: spacing.sm,
		gap: spacing.xs,
		boxShadow: shadow.bar,
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
	// Compact horizontal pill sized to a small Button (minHeight 38) so trade
	// sits level with Roll / End turn in the dock's action row.
	tradeCompact: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		gap: spacing.xs,
		minHeight: 38,
		paddingHorizontal: spacing.md,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.card,
		boxShadow: shadow.bar,
	},
	tradeCompactLabel: {
		fontSize: font.md,
		fontWeight: '600',
		color: colors.text,
		letterSpacing: 0.2,
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
		flexWrap: 'wrap',
		gap: spacing.xs,
	},
	// Layout carrier for a tooltip-wrapped button: takes the row share the
	// button itself would claim, and stays row-direction so the button's
	// `flex: 1` keeps resolving horizontally.
	iconSlot: {
		flex: 1,
		flexDirection: 'row',
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
	carpenterBtn: {
		backgroundColor: '#6F5A2A',
		borderColor: '#3B2D12',
		flexDirection: 'column',
		gap: 2,
	},
	superCityBtn: {
		backgroundColor: '#3B5BA5',
		borderColor: '#1F326B',
		flexDirection: 'column',
		gap: 2,
	},
	accountantBtn: {
		backgroundColor: '#5A3F8F',
		borderColor: '#322357',
		flexDirection: 'column',
		gap: 2,
	},
	investorBtn: {
		backgroundColor: '#1F7A5A',
		borderColor: '#0F3E2D',
		flexDirection: 'column',
		gap: 2,
	},
	carpenterCostLabel: {
		fontSize: 9,
		fontWeight: '800',
		color: colors.white,
		letterSpacing: 0.3,
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
