// "App updates": what changed since this device last looked. Pushed once per
// launch by `usePatchNotes`; `from` is the oldest entry id to list. On the
// root stack for the same reason as `find-friends`. See
// `.claude/specs/patch-notes.md`.

import { Button } from '@/lib/modules/Button'
import {
	compareIds,
	entryDateLabel,
	markPatchNotesSeen,
	parseId,
	PATCH_NOTES,
} from '@/lib/patchNotes'
import { ColorScheme, font, spacing } from '@/lib/theme'
import { useTheme } from '@/lib/ThemeContext'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function PatchNotesScreen() {
	const router = useRouter()
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const { from } = useLocalSearchParams<{ from?: string }>()

	const entries = useMemo(() => {
		const valid = from && parseId(from)
		const shown = valid
			? PATCH_NOTES.filter((e) => compareIds(e.id, from) >= 0)
			: PATCH_NOTES.slice(-1)
		return [...shown].reverse()
	}, [from])

	// Stamped on show, not on "Got it": a back gesture or killing the app
	// counts as having seen it.
	useEffect(() => {
		markPatchNotesSeen()
	}, [])

	const leave = useCallback(() => {
		if (router.canGoBack()) router.back()
		else router.replace('/(app)/games')
	}, [router])

	return (
		<SafeAreaView style={styles.safe}>
			<Text style={styles.title}>App updates</Text>
			<ScrollView contentContainerStyle={styles.list}>
				{entries.map((entry) => (
					<View key={entry.id} style={styles.group}>
						{entries.length > 1 && (
							<Text style={styles.date}>
								{entryDateLabel(entry.id)}
							</Text>
						)}
						{entry.notes.map((note, i) => (
							<View key={i} style={styles.row}>
								<Text style={styles.bullet}>{'•'}</Text>
								<Text style={styles.note}>{note}</Text>
							</View>
						))}
					</View>
				))}
			</ScrollView>
			<View style={styles.footer}>
				<Button onPress={leave}>Got it</Button>
			</View>
		</SafeAreaView>
	)
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		safe: {
			flex: 1,
			backgroundColor: colors.background,
		},
		title: {
			fontSize: font.lg,
			fontWeight: '700',
			color: colors.text,
			textAlign: 'center',
			paddingTop: spacing.lg,
			paddingBottom: spacing.sm,
		},
		list: {
			padding: spacing.lg,
			gap: spacing.lg,
		},
		group: {
			gap: spacing.sm,
		},
		date: {
			fontSize: font.sm,
			fontWeight: '600',
			color: colors.textMuted,
			textTransform: 'uppercase',
		},
		row: {
			flexDirection: 'row',
			gap: spacing.sm,
		},
		bullet: {
			fontSize: font.base,
			color: colors.textMuted,
		},
		note: {
			flex: 1,
			fontSize: font.base,
			color: colors.text,
			lineHeight: 21,
		},
		footer: {
			padding: spacing.lg,
			paddingTop: spacing.sm,
		},
	})
}
