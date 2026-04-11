export default ({ config }) => ({
	...config,
	extra: {
		...config.extra,
		supabaseUrl: `https://${process.env.SUPABASE_PROJECT_ID}.supabase.co`,
		supabasePublicKey: process.env.SUPABASE_PUBLIC_KEY,
	},
})
