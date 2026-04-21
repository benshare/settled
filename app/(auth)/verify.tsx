import { useAuth } from '@/lib/auth'
import { useProfileStore } from '@/lib/stores/useProfileStore'
import { useTheme } from '@/lib/ThemeContext'
import { ColorScheme, font, radius, spacing } from '@/lib/theme'
import { useLocalSearchParams, useRouter } from 'expo-router'
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

export default function VerifyScreen() {
	const [code, setCode] = useState('')
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const { phone } = useLocalSearchParams<{ phone: string }>()
	const { verifyOtp, signInWithPhone } = useAuth()
	const router = useRouter()
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])

	const maskedPhone = phone
		? phone.replace(
				/(\+\d)(\d+)(\d{4})/,
				(_, a, b, c) => `${a}${'•'.repeat(b.length)}${c}`
			)
		: '•••••••••••'

	async function handleVerify() {
		setLoading(true)
		setError(null)
		const { error, session } = await verifyOtp(phone ?? '', code)
		if (error || !session?.user) {
			setLoading(false)
			setError(error ?? 'Verification failed')
			return
		}
		const profile = await useProfileStore
			.getState()
			.loadProfile(session.user.id)
		setLoading(false)
		if (profile) {
			router.replace('/(app)/play')
		} else {
			router.replace('/(auth)/set-username')
		}
	}

	useEffect(() => {
		if (code.length === 6 && !loading) handleVerify()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [code.length])

	async function handleResend() {
		if (!phone) return
		await signInWithPhone(phone)
	}

	return (
		<SafeAreaView style={styles.safe}>
			<KeyboardAvoidingView
				style={styles.flex}
				behavior={Platform.OS === 'ios' ? 'padding' : undefined}
			>
				<View style={styles.container}>
					<View style={styles.top}>
						<Pressable
							onPress={() => router.back()}
							style={styles.back}
						>
							<Text style={styles.backText}>← Back</Text>
						</Pressable>

						<View style={styles.intro}>
							<Text style={styles.title}>Check your texts</Text>
							<Text style={styles.subtitle}>
								We sent a 6-digit code to{' '}
								<Text style={styles.subtitleBold}>
									{maskedPhone}
								</Text>
							</Text>
						</View>
					</View>

					<View style={styles.form}>
						<TextInput
							style={styles.input}
							placeholder="000000"
							placeholderTextColor={colors.textMuted}
							keyboardType="number-pad"
							textContentType="oneTimeCode"
							maxLength={6}
							value={code}
							onChangeText={(t) => {
								setCode(t)
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
								(code.length < 6 || loading) &&
									styles.buttonDisabled,
								pressed && styles.buttonPressed,
							]}
							disabled={code.length < 6 || loading}
							onPress={handleVerify}
						>
							<Text style={styles.buttonText}>
								{loading ? 'Verifying…' : 'Verify'}
							</Text>
						</Pressable>
						<Pressable style={styles.resend} onPress={handleResend}>
							<Text style={styles.resendText}>
								Didn&apos;t get it?{' '}
								<Text style={styles.resendLink}>
									Resend code
								</Text>
							</Text>
						</Pressable>
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
		top: {
			gap: spacing.lg,
		},
		back: {
			alignSelf: 'flex-start',
		},
		backText: {
			fontSize: font.md,
			color: colors.brand,
		},
		intro: {
			gap: spacing.sm,
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
		subtitleBold: {
			fontWeight: '600',
			color: colors.text,
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
			fontSize: font.lg,
			letterSpacing: 4,
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
		resend: {
			paddingVertical: spacing.sm,
			alignItems: 'center',
		},
		resendText: {
			fontSize: font.sm,
			color: colors.textSecondary,
		},
		resendLink: {
			color: colors.brand,
		},
	})
}
