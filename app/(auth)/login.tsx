import { useAuth } from '@/lib/auth'
import { useProfileStore } from '@/lib/stores/useProfileStore'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/ThemeContext'
import { ColorScheme, font, radius, spacing } from '@/lib/theme'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
	KeyboardAvoidingView,
	Platform,
	Pressable,
	StyleSheet,
	Text,
	TextInput,
	View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

// Dev-only: each entry must exist in the profiles table and have its password
// set by dev/set-test-passwords.mjs. Each renders as its own sign-in button.
const DEV_TEST_USERNAMES = ['ben', 'testuser1', 'testuser2', 'testuser3']
const DEV_TEST_PASSWORD = 'testpassword'

// App Store reviewer bypass: typing this phone number signs in as the
// dedicated reviewer account (seeded by dev/seed-appstore-user.mjs) without
// sending an SMS. Active in release builds.
const REVIEWER_PHONE_DIGITS = '1234567890'
const REVIEWER_PHONE = '+11234567890'
const REVIEWER_PASSWORD = 'testpassword'

export default function LoginScreen() {
	const [phone, setPhone] = useState('')
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const { signInWithPhone } = useAuth()
	const router = useRouter()
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])

	const digits = phone.replace(/\D/g, '')
	const canContinue = digits.length >= 10

	useEffect(() => {
		if (canContinue && !loading) handleContinue()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [canContinue])

	async function handleDevSignIn(username: string) {
		setLoading(true)
		setError(null)
		const n = parseInt(username.replace(/\D/g, ''), 10)
		if (Number.isNaN(n)) {
			setLoading(false)
			setError(`${username} must end in a number`)
			return
		}
		const phone = `+1555${String(n).padStart(7, '0')}`
		const { data, error } = await supabase.auth.signInWithPassword({
			phone,
			password: DEV_TEST_PASSWORD,
		})
		if (error || !data.session?.user) {
			setLoading(false)
			setError(error?.message ?? 'dev sign-in failed')
			return
		}
		const profile = await useProfileStore
			.getState()
			.loadProfile(data.session.user.id)
		setLoading(false)
		if (profile) {
			router.replace('/(app)/play')
		} else {
			router.replace('/(auth)/set-username')
		}
	}

	async function handleContinue() {
		setLoading(true)
		setError(null)

		if (digits === REVIEWER_PHONE_DIGITS) {
			const { data, error } = await supabase.auth.signInWithPassword({
				phone: REVIEWER_PHONE,
				password: REVIEWER_PASSWORD,
			})
			if (error || !data.session?.user) {
				setLoading(false)
				setError(error?.message ?? 'reviewer sign-in failed')
				return
			}
			const profile = await useProfileStore
				.getState()
				.loadProfile(data.session.user.id)
			setLoading(false)
			if (profile) {
				router.replace('/(app)/play')
			} else {
				router.replace('/(auth)/set-username')
			}
			return
		}

		const normalized = digits.length === 10 ? `+1${digits}` : `+${digits}`

		const { error } = await signInWithPhone(normalized)
		setLoading(false)
		if (error) {
			setError(error)
		} else {
			router.push({
				pathname: '/(auth)/verify',
				params: { phone: normalized },
			})
		}
	}

	return (
		<SafeAreaView style={styles.safe}>
			<KeyboardAvoidingView
				style={styles.flex}
				behavior={Platform.OS === 'ios' ? 'padding' : undefined}
			>
				<View style={styles.container}>
					<View style={styles.intro}>
						<Text style={styles.title}>Welcome</Text>
						<Text style={styles.subtitle}>
							Enter your phone number to sign in or create an
							account.
						</Text>
					</View>

					<View style={styles.form}>
						<TextInput
							style={styles.input}
							placeholder="+1 (555) 000-0000"
							placeholderTextColor={colors.textMuted}
							keyboardType="phone-pad"
							textContentType="telephoneNumber"
							value={phone}
							onChangeText={(t) => {
								setPhone(t)
								setError(null)
							}}
							autoFocus
						/>
						{error ? (
							<Text style={styles.error}>{error}</Text>
						) : null}
						<Pressable
							style={({ pressed }) => [
								styles.button,
								(!canContinue || loading) &&
									styles.buttonDisabled,
								pressed && styles.buttonPressed,
							]}
							disabled={!canContinue || loading}
							onPress={handleContinue}
						>
							<Text style={styles.buttonText}>
								{loading ? 'Sending…' : 'Continue'}
							</Text>
						</Pressable>
					</View>

					<Text style={styles.footer}>
						By continuing you agree to our Terms of Service and
						Privacy Policy.
					</Text>

					{__DEV__ && (
						<View style={styles.devGroup}>
							{DEV_TEST_USERNAMES.map((u) => (
								<Pressable
									key={u}
									style={({ pressed }) => [
										styles.devButton,
										pressed && styles.buttonPressed,
									]}
									onPress={() => handleDevSignIn(u)}
									disabled={loading}
								>
									<Text style={styles.devButtonText}>
										Dev: sign in as {u}
									</Text>
								</Pressable>
							))}
						</View>
					)}
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
			gap: spacing.sm,
		},
		input: {
			minHeight: 52,
			borderWidth: 1,
			borderColor: colors.border,
			borderRadius: radius.md,
			paddingHorizontal: spacing.md,
			paddingVertical: 14,
			fontSize: font.md,
			color: colors.text,
			backgroundColor: colors.card,
		},
		error: {
			color: colors.error,
			fontSize: font.sm,
		},
		button: {
			minHeight: 52,
			borderRadius: radius.md,
			backgroundColor: colors.brand,
			alignItems: 'center',
			justifyContent: 'center',
		},
		buttonDisabled: {
			opacity: 0.4,
		},
		buttonPressed: {
			opacity: 0.85,
		},
		buttonText: {
			color: colors.white,
			fontSize: font.md,
			fontWeight: '600',
		},
		footer: {
			fontSize: font.xs,
			color: colors.textMuted,
			textAlign: 'center',
		},
		devGroup: {
			marginTop: spacing.md,
			gap: spacing.sm,
		},
		devButton: {
			paddingVertical: 10,
			borderRadius: radius.sm,
			borderWidth: 1,
			borderColor: colors.border,
			backgroundColor: colors.card,
			alignItems: 'center',
		},
		devButtonText: {
			fontSize: font.sm,
			color: colors.textSecondary,
			fontWeight: '600',
		},
	})
}
