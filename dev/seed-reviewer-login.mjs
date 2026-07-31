import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const projectId = process.env.SUPABASE_PROJECT_ID
const serviceKey = process.env.SUPABASE_PRIVATE_KEY

if (!projectId || !serviceKey) {
	console.error(
		'Missing SUPABASE_PROJECT_ID or SUPABASE_PRIVATE_KEY in env. ' +
			'Run with: node --env-file=.env dev/seed-reviewer-login.mjs'
	)
	process.exit(1)
}

// Pairs the account the reviewer bypass signs into with the password the
// `reviewer-login` edge function uses. Both sides are set here so they can't
// drift. Running this signs the account out everywhere — GoTrue revokes every
// session on an admin password change — so only run it when the pairing is
// actually broken.
const USER_ID = 'a49421db-f053-412d-8916-75f85c1932a5'

const supabase = createClient(`https://${projectId}.supabase.co`, serviceKey, {
	auth: { persistSession: false, autoRefreshToken: false },
})

const { data: user, error: getErr } =
	await supabase.auth.admin.getUserById(USER_ID)
if (getErr) {
	console.error(`get user failed: ${getErr.message}`)
	process.exit(1)
}
if (!user.user.phone) {
	console.error('reviewer user has no phone identity')
	process.exit(1)
}

const password = `${crypto.randomUUID()}${crypto.randomUUID()}`
const { error: updErr } = await supabase.auth.admin.updateUserById(USER_ID, {
	password,
})
if (updErr) {
	console.error(`set password failed: ${updErr.message}`)
	process.exit(1)
}

execFileSync(
	'npx',
	['supabase', 'secrets', 'set', `REVIEWER_PASSWORD=${password}`],
	{ stdio: 'inherit' }
)

const { data: profile } = await supabase
	.from('profiles')
	.select('username')
	.eq('id', USER_ID)
	.single()

console.log(
	`reviewer-login now signs in as ${profile?.username ?? USER_ID}; ` +
		'that account was signed out on all devices'
)
