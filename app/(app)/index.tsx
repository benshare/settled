import { useAuth } from '@/lib/auth'
import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function HomeScreen() {
	const { user, signOut } = useAuth()
	const router = useRouter()

	async function handleSignOut() {
		await signOut()
		router.replace('/')
	}

	return (
		<SafeAreaView style={styles.safe}>
			<View style={styles.container}>
				<View style={styles.intro}>
					<Text style={styles.title}>You&apos;re in</Text>
					<Text style={styles.subtitle}>
						Signed in as {user?.phone ?? 'unknown'}
					</Text>
				</View>

				<Pressable
					style={({ pressed }) => [
						styles.button,
						pressed && styles.buttonPressed,
					]}
					onPress={handleSignOut}
				>
					<Text style={styles.buttonText}>Sign out</Text>
				</Pressable>
			</View>
		</SafeAreaView>
	)
}

const styles = StyleSheet.create({
	safe: {
		flex: 1,
		backgroundColor: '#fff',
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
	button: {
		height: 48,
		borderRadius: 8,
		backgroundColor: '#111',
		alignItems: 'center',
		justifyContent: 'center',
	},
	buttonPressed: {
		opacity: 0.85,
	},
	buttonText: {
		color: '#fff',
		fontSize: 16,
		fontWeight: '600',
	},
})
