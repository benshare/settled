import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, font, radius, spacing } from '../theme'
import type { BuildKind } from './build'
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

export function BuildTradeBar({
	active,
	enabled,
	meIdx,
	onSelect,
}: {
	active: BuildKind | null
	enabled: BuildEnablement
	meIdx: number
	onSelect: (tool: BuildKind) => void
}) {
	return (
		<View style={styles.row}>
			<View style={[styles.panel, styles.buildPanel]}>
				<Text style={styles.title}>Build</Text>
				<View style={styles.iconRow}>
					{BUILD_OPTIONS.map((opt) => (
						<BuildIconButton
							key={opt.key}
							option={opt}
							enabled={enabled[opt.key]}
							active={
								opt.key !== 'dev_card' && active === opt.key
							}
							meIdx={meIdx}
							onPress={() => {
								if (opt.key === 'dev_card') return
								onSelect(opt.key)
							}}
						/>
					))}
				</View>
			</View>

			<View
				style={[styles.panel, styles.tradePanel, styles.panelDisabled]}
			>
				<Text style={styles.title}>Trade</Text>
				<View style={styles.tradeBody}>
					<Ionicons
						name="swap-horizontal"
						size={24}
						color={colors.textMuted}
					/>
				</View>
			</View>
		</View>
	)
}

function BuildIconButton({
	option,
	enabled,
	active,
	meIdx,
	onPress,
}: {
	option: BuildOption
	enabled: boolean
	active: boolean
	meIdx: number
	onPress: () => void
}) {
	const color = playerColors[meIdx] ?? playerColors[0]
	const interactive = enabled || active
	return (
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
		</Pressable>
	)
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
