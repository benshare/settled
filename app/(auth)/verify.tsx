import { useAuth } from '@/lib/auth'
import { useProfileStore } from '@/lib/stores/useProfileStore'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
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
							placeholderTextColor="#999"
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

const styles = StyleSheet.create({
	safe: {
		flex: 1,
		backgroundColor: '#fff',
	},
	flex: {
		flex: 1,
	},
	container: {
		flex: 1,
		justifyContent: 'space-between',
		paddingHorizontal: 24,
		paddingVertical: 32,
	},
	top: {
		gap: 24,
	},
	back: {
		alignSelf: 'flex-start',
	},
	backText: {
		fontSize: 16,
		color: '#0066ff',
	},
	intro: {
		gap: 8,
	},
	title: {
		fontSize: 28,
		fontWeight: '700',
		color: '#111',
	},
	subtitle: {
		fontSize: 16,
		color: '#666',
	},
	subtitleBold: {
		fontWeight: '600',
		color: '#111',
	},
	form: {
		gap: 12,
	},
	input: {
		height: 48,
		borderWidth: 1,
		borderColor: '#ddd',
		borderRadius: 8,
		paddingHorizontal: 16,
		fontSize: 18,
		letterSpacing: 4,
		color: '#111',
	},
	error: {
		color: '#d00',
		fontSize: 14,
	},
	button: {
		height: 48,
		borderRadius: 8,
		backgroundColor: '#111',
		alignItems: 'center',
		justifyContent: 'center',
	},
	buttonDisabled: {
		backgroundColor: '#ccc',
	},
	buttonPressed: {
		opacity: 0.85,
	},
	buttonText: {
		color: '#fff',
		fontSize: 16,
		fontWeight: '600',
	},
	resend: {
		paddingVertical: 8,
		alignItems: 'center',
	},
	resendText: {
		fontSize: 14,
		color: '#666',
	},
	resendLink: {
		color: '#0066ff',
	},
})
