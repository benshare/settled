import { createClient } from '@supabase/supabase-js'

const projectId = process.env.SUPABASE_PROJECT_ID
const serviceKey = process.env.SUPABASE_PRIVATE_KEY

if (!projectId || !serviceKey) {
	console.error(
		'Missing SUPABASE_PROJECT_ID or SUPABASE_PRIVATE_KEY in env. ' +
			'Run with: node --env-file=.env dev/set-test-passwords.mjs'
	)
	process.exit(1)
}

const TEST_PASSWORD = 'testpassword'

const supabase = createClient(`https://${projectId}.supabase.co`, serviceKey, {
	auth: { persistSession: false, autoRefreshToken: false },
})

const { data: profiles, error } = await supabase
	.from('profiles')
	.select('id, username')
	.ilike('username', 'testuser%')

if (error) {
	console.error(`list profiles failed: ${error.message}`)
	process.exit(1)
}

if (!profiles || profiles.length === 0) {
	console.log('no test users found')
	process.exit(0)
}

for (const p of profiles) {
	const { error: updErr } = await supabase.auth.admin.updateUserById(p.id, {
		password: TEST_PASSWORD,
	})
	if (updErr) {
		console.error(`set password ${p.username} failed: ${updErr.message}`)
		continue
	}
	console.log(`set password for ${p.username}`)
}
