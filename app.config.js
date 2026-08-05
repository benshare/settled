export default ({ config }) => ({
	...config,
	extra: {
		...config.extra,
		supabaseUrl: `https://${process.env.SUPABASE_PROJECT_ID}.supabase.co`,
		supabasePublicKey: process.env.SUPABASE_PUBLIC_KEY,
		// Admin impersonation ("act as user" in the user search). `devLoginKey`
		// authorizes the `dev-login` edge function, which mints a session for
		// ANY account — so unlike the keys above it must never reach a shipped
		// bundle. Both are only ever set in the local `.env`; EAS environments
		// deliberately don't define them, which leaves these undefined and
		// `IS_ADMIN` false. See `lib/admin.ts`.
		admin: process.env.ADMIN === 'true',
		devLoginKey: process.env.DEV_LOGIN_KEY,
	},
	plugins: [...(config.plugins ?? []), 'expo-image'],
})
