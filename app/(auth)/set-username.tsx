import { useAuth } from '@/lib/auth'
import { Button } from '@/lib/modules/Button'
import { Input } from '@/lib/modules/Input'
import { useProfileStore } from '@/lib/stores/useProfileStore'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/ThemeContext'
import { ColorScheme, font, spacing } from '@/lib/theme'
import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import {
	KeyboardAvoidingView,
	Platform,
	StyleSheet,
	Text,
	View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/

function validateUsername(value: string): string | null {
	if (value.length < 3) return 'Username must be at least 3 characters'
	if (value.length > 20) return 'Username must be 20 characters or fewer'
	if (!USERNAME_REGEX.test(value))
		return 'Letters, numbers, and underscores only'
	return null
}

export default function SetUsernameScreen() {
	const [username, setUsername] = useState('')
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const { user } = useAuth()
	const router = useRouter()
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])

	async function handleSubmit() {
		if (!user) return
		const validationError = validateUsername(username)
		if (validationError) {
			setError(validationError)
			return
		}

		setLoading(true)
		setError(null)

		const { error: dbError } = await supabase
			.from('profiles')
			.upsert({ id: user.id, username }, { onConflict: 'id' })

		if (dbError) {
			setLoading(false)
			if (dbError.code === '23505') {
				setError('Username already taken')
			} else {
				setError('Something went wrong. Please try again.')
			}
			return
		}

		await useProfileStore.getState().loadProfile(user.id)
		setLoading(false)
		router.replace('/(app)/play')
	}

	return (
		<SafeAreaView style={styles.safe}>
			<KeyboardAvoidingView
				style={styles.flex}
				behavior={Platform.OS === 'ios' ? 'padding' : undefined}
			>
				<View style={styles.container}>
					<View style={styles.intro}>
						<Text style={styles.title}>Choose a username</Text>
						<Text style={styles.subtitle}>
							This is how you&apos;ll appear to others.
						</Text>
					</View>

					<View style={styles.form}>
						<Input
							label="Username"
							placeholder="your_username"
							autoCapitalize="none"
							autoCorrect={false}
							maxLength={20}
							value={username}
							onChangeText={(t) => {
								setUsername(t)
								setError(null)
							}}
							error={error ?? undefined}
							autoFocus
						/>
						<Button
							loading={loading}
							disabled={username.length < 3}
							onPress={handleSubmit}
						>
							Continue
						</Button>
					</View>

					<View />
				</View>
			</KeyboardAvoidingView>
		</SafeAreaView>
	)
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		safe: {
			flex: 1,
			backgroundColor: colors.background,
		},
		flex: {
			flex: 1,
		},
		container: {
			flex: 1,
			justifyContent: 'space-between',
			paddingHorizontal: spacing.lg,
			paddingVertical: spacing.xl,
		},
		intro: {
			gap: spacing.sm,
			marginTop: spacing.xl,
		},
		title: {
			fontSize: font.xl,
			fontWeight: '700',
			color: colors.text,
		},
		subtitle: {
			fontSize: font.md,
			color: colors.textSecondary,
		},
		form: {
			gap: spacing.md,
		},
	})
}
