import { useAuth } from '@/lib/auth'
import { Redirect } from 'expo-router'

export default function Index() {
	const { isLoggedIn } = useAuth()
	return <Redirect href={isLoggedIn ? '/(app)/play' : '/(auth)/login'} />
}
