import { useAuth } from '@/lib/auth'
import { useRouter } from 'expo-router'
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

export default function LoginScreen() {
	const [phone, setPhone] = useState('')
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const { signInWithPhone } = useAuth()
	const router = useRouter()

	const digits = phone.replace(/\D/g, '')
	const canContinue = digits.length >= 10

	useEffect(() => {
		if (canContinue && !loading) handleContinue()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [canContinue])

	async function handleContinue() {
		setLoading(true)
		setError(null)
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
							placeholderTextColor="#999"
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
	intro: {
		gap: 8,
		marginTop: 32,
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
	form: {
		gap: 12,
	},
	input: {
		height: 48,
		borderWidth: 1,
		borderColor: '#ddd',
		borderRadius: 8,
		paddingHorizontal: 16,
		fontSize: 16,
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
	footer: {
		fontSize: 12,
		color: '#999',
		textAlign: 'center',
	},
})
