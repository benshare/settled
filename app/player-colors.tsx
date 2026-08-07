// Rank the six player colors. Pushed from Account rather than shown inline:
// six drag rows and a ScrollView compete for the same vertical gesture, and a
// full-height screen never has to scroll.
//
// It lives on the root stack, not in the tab group (as does `create-game`): a
// hidden tab route answers back by returning to the navigator's first tab
// (Games), not to whoever pushed it. A real push pops back to Account.
//
// An empty ranking is not "the default order" — it means no preference, and
// the resolver answers it with a random color. So the unset state deliberately
// shows no rank numbers and says so; the first drag makes the ranking real.

import {
	COLOR_IDS,
	COLOR_LABELS,
	DEFAULT_COLOR_ORDER,
	parseColorPrefs,
	type ColorId,
} from '@/lib/catan/colors'
import { playerColors } from '@/lib/catan/palette'
import { useProfileStore } from '@/lib/stores/useProfileStore'
import { ColorScheme, font, radius, spacing } from '@/lib/theme'
import { useTheme } from '@/lib/ThemeContext'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Sortable, { type SortableGridRenderItem } from 'react-native-sortables'

const ROW_HEIGHT = 56

export default function PlayerColorsScreen() {
	const router = useRouter()
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])

	const profile = useProfileStore((s) => s.profile)
	const updateColorPrefs = useProfileStore((s) => s.updateColorPrefs)

	const stored = useMemo(
		() => parseColorPrefs(profile?.color_prefs),
		[profile?.color_prefs]
	)
	const ranked = stored.length > 0

	// The arrangement on screen. When nothing is stored this is just a
	// starting point to modify, which is why the rows carry no rank numbers
	// until a drag makes it real.
	const [order, setOrder] = useState<ColorId[]>(() =>
		ranked ? fill(stored) : [...DEFAULT_COLOR_ORDER]
	)
	const [error, setError] = useState<string | null>(null)

	// The profile can land after this screen mounts (a cold start, or a resync),
	// which would otherwise leave the list on its seeded order while the header
	// already reads "Ranked". Compared by value, not identity: an optimistic
	// save writes the store first, and re-seeding from it mid-animation would
	// yank the row out from under the drag that caused it.
	const storedKey = stored.join()
	useEffect(() => {
		const next = stored.length > 0 ? fill(stored) : [...DEFAULT_COLOR_ORDER]
		setOrder((prev) => (prev.join() === next.join() ? prev : next))
		// `stored` is rebuilt each render; `storedKey` is its value identity.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [storedKey])

	const save = useCallback(
		async (next: ColorId[]) => {
			const previous = order
			setOrder(next)
			setError(null)
			const { error: err } = await updateColorPrefs(next)
			if (err) {
				setOrder(previous)
				setError(err)
			}
		},
		[order, updateColorPrefs]
	)

	async function handleClear() {
		setOrder([...DEFAULT_COLOR_ORDER])
		setError(null)
		const { error: err } = await updateColorPrefs([])
		if (err) setError(err)
	}

	const renderItem = useCallback<SortableGridRenderItem<ColorId>>(
		({ item, index }) => (
			<View style={styles.row}>
				<Text style={styles.rank}>{ranked ? index + 1 : '·'}</Text>
				<View
					style={[
						styles.swatch,
						{ backgroundColor: playerColors[item] },
					]}
				/>
				<Text style={styles.label}>{COLOR_LABELS[item]}</Text>
				<Sortable.Handle>
					<View style={styles.handle}>
						<Ionicons
							name="reorder-three"
							size={24}
							color={colors.textMuted}
						/>
					</View>
				</Sortable.Handle>
			</View>
		),
		[styles, colors.textMuted, ranked]
	)

	return (
		<SafeAreaView style={styles.safe}>
			<View style={styles.header}>
				<Pressable
					onPress={() =>
						router.canGoBack()
							? router.back()
							: router.replace('/account')
					}
					hitSlop={8}
					style={({ pressed }) => [
						styles.back,
						pressed && styles.pressed,
					]}
				>
					<Ionicons
						name="chevron-back"
						size={26}
						color={colors.text}
					/>
				</Pressable>
				<Text style={styles.title}>Player colors</Text>
				<View style={styles.back} />
			</View>

			<View style={styles.container}>
				<Text style={styles.hint}>
					{ranked
						? 'Drag to reorder. Ties are broken randomly between players who want the same color.'
						: 'No preference set — colors are assigned randomly. Drag to rank them.'}
				</Text>

				<Sortable.Grid
					columns={1}
					data={order}
					renderItem={renderItem}
					rowGap={spacing.sm}
					customHandle
					onDragEnd={({ data }) => save(data)}
				/>

				{error && <Text style={styles.errorText}>{error}</Text>}

				{ranked && (
					<Pressable onPress={handleClear} hitSlop={8}>
						<Text style={styles.clear}>Clear preference</Text>
					</Pressable>
				)}
			</View>
		</SafeAreaView>
	)
}

// A stored ranking is always all six in practice, but a legacy or partial row
// still has to render six rows — so pad the display with whatever is missing.
function fill(prefs: ColorId[]): ColorId[] {
	return [...prefs, ...COLOR_IDS.filter((c) => !prefs.includes(c))]
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		safe: {
			flex: 1,
			backgroundColor: colors.background,
		},
		header: {
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'space-between',
			paddingHorizontal: spacing.md,
			paddingTop: spacing.sm,
			paddingBottom: spacing.sm,
		},
		back: {
			width: 40,
			height: 40,
			alignItems: 'center',
			justifyContent: 'center',
		},
		pressed: {
			opacity: 0.7,
		},
		title: {
			fontSize: font.md,
			fontWeight: '700',
			color: colors.text,
		},
		container: {
			padding: spacing.lg,
			gap: spacing.md,
		},
		hint: {
			fontSize: font.sm,
			color: colors.textSecondary,
			marginBottom: spacing.xs,
		},
		row: {
			flexDirection: 'row',
			alignItems: 'center',
			gap: spacing.md,
			height: ROW_HEIGHT,
			paddingHorizontal: spacing.md,
			borderRadius: radius.md,
			borderWidth: 1,
			borderColor: colors.border,
			backgroundColor: colors.card,
		},
		rank: {
			width: 16,
			fontSize: font.sm,
			fontWeight: '600',
			color: colors.textMuted,
		},
		// The border is not decoration: white is invisible against the light
		// theme's card without it.
		swatch: {
			width: 24,
			height: 24,
			borderRadius: 12,
			borderWidth: 1,
			borderColor: colors.border,
		},
		label: {
			flex: 1,
			fontSize: font.md,
			color: colors.text,
		},
		handle: {
			width: 40,
			height: ROW_HEIGHT,
			alignItems: 'center',
			justifyContent: 'center',
		},
		clear: {
			fontSize: font.base,
			fontWeight: '600',
			color: colors.brand,
			paddingVertical: spacing.xs,
		},
		errorText: {
			color: colors.error,
			fontSize: font.sm,
		},
	})
}
