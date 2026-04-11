import { createClient } from '@supabase/supabase-js'

const projectId = process.env.SUPABASE_PROJECT_ID
const serviceKey = process.env.SUPABASE_PRIVATE_KEY

if (!projectId || !serviceKey) {
	console.error(
		'Missing SUPABASE_PROJECT_ID or SUPABASE_PRIVATE_KEY in env. ' +
			'Run with: node --env-file=.env dev/clear-test-users.mjs'
	)
	process.exit(1)
}

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
	console.log('no test users to delete')
	process.exit(0)
}

for (const p of profiles) {
	const { error: delErr } = await supabase.auth.admin.deleteUser(p.id)
	if (delErr) {
		console.error(`delete ${p.username} failed: ${delErr.message}`)
		continue
	}
	console.log(`deleted ${p.username} (${p.id})`)
}
