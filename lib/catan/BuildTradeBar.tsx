import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, font, radius, spacing } from '../theme'

type BuildOption = {
	key: 'road' | 'settlement' | 'city' | 'dev_card'
	label: string
	icon: React.ComponentProps<typeof Ionicons>['name']
}

const BUILD_OPTIONS: readonly BuildOption[] = [
	{ key: 'road', label: 'Road', icon: 'trail-sign-outline' },
	{ key: 'settlement', label: 'Settlement', icon: 'home-outline' },
	{ key: 'city', label: 'City', icon: 'business-outline' },
	{ key: 'dev_card', label: 'Dev card', icon: 'albums-outline' },
]

export function BuildTradeBar() {
	return (
		<View style={styles.row}>
			<View style={[styles.panel, styles.buildPanel]}>
				<Text style={styles.title}>Build</Text>
				<View style={styles.iconRow}>
					{BUILD_OPTIONS.map((opt) => (
						<BuildIconButton key={opt.key} option={opt} />
					))}
				</View>
			</View>

			<Pressable
				style={({ pressed }) => [
					styles.panel,
					styles.tradePanel,
					pressed && styles.pressed,
				]}
			>
				<Text style={styles.title}>Trade</Text>
				<View style={styles.tradeBody}>
					<Ionicons
						name="swap-horizontal"
						size={24}
						color={colors.text}
					/>
				</View>
			</Pressable>
		</View>
	)
}

function BuildIconButton({ option }: { option: BuildOption }) {
	return (
		<Pressable
			style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
			accessibilityLabel={option.label}
		>
			<Ionicons name={option.icon} size={22} color={colors.text} />
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
