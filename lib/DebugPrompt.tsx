// An error modal shown at app load to whichever users have an enabled row in
// `debug_prompts` (see the migration of the same name). Renders nothing for
// everyone else, which is everyone: the flag, the targeting and the copied link
// all live in that table, so this ships inert and is turned on from the
// dashboard.

import * as Clipboard from 'expo-clipboard'
import { useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text } from 'react-native'
import { useAuth } from './auth'
import { Button } from './modules/Button'
import { Modal } from './modules/Modal'
import { supabase } from './supabase'
import { ColorScheme, font, radius, spacing } from './theme'
import { useTheme } from './ThemeContext'

const COPIED_MS = 1600

// Null for "no prompt": no row, RLS hid it, disabled, or no link to copy.
async function fetchLink(userId: string): Promise<string | null> {
	const { data, error } = await supabase
		.from('debug_prompts')
		.select('enabled, link')
		.eq('user_id', userId)
		.maybeSingle()
	if (error) {
		console.warn('[debugPrompt]', error.message)
		return null
	}
	return data?.enabled ? (data.link ?? null) : null
}

export function DebugPrompt() {
	const { user } = useAuth()
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const [link, setLink] = useState<string | null>(null)
	const [dismissed, setDismissed] = useState(false)
	const [copied, setCopied] = useState(false)

	useEffect(() => {
		setLink(null)
		setDismissed(false)
		if (!user?.id) return
		let cancelled = false
		fetchLink(user.id).then((l) => {
			if (!cancelled) setLink(l)
		})
		return () => {
			cancelled = true
		}
	}, [user?.id])

	useEffect(() => {
		if (!copied) return
		const t = setTimeout(() => setCopied(false), COPIED_MS)
		return () => clearTimeout(t)
	}, [copied])

	// Re-read rather than copying the value loaded at launch, so editing the
	// row takes effect on the next tap instead of the next app start.
	async function copy() {
		const fresh = user?.id ? await fetchLink(user.id) : null
		await Clipboard.setStringAsync(fresh ?? link ?? '')
		setCopied(true)
	}

	if (!link || dismissed) return null

	return (
		<Modal
			visible
			onDismiss={() => setDismissed(true)}
			contentStyle={styles.sheet}
		>
			<Text style={styles.title}>Error loading game assets</Text>
			<Text style={styles.message}>
				Please share debugging information with the developer.
			</Text>
			<Button onPress={copy}>
				{copied ? 'Copied' : 'Copy debug info'}
			</Button>
		</Modal>
	)
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		sheet: {
			width: '100%',
			maxWidth: 420,
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
		message: {
			fontSize: font.sm,
			color: colors.textSecondary,
			lineHeight: 20,
		},
	})
}
