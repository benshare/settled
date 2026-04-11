import { createClient } from '@supabase/supabase-js'

const projectId = process.env.SUPABASE_PROJECT_ID
const serviceKey = process.env.SUPABASE_PRIVATE_KEY

if (!projectId || !serviceKey) {
	console.error(
		'Missing SUPABASE_PROJECT_ID or SUPABASE_PRIVATE_KEY in env. ' +
			'Run with: node --env-file=.env dev/seed-test-users.mjs'
	)
	process.exit(1)
}

const TEST_PASSWORD = 'testpassword'

const supabase = createClient(`https://${projectId}.supabase.co`, serviceKey, {
	auth: { persistSession: false, autoRefreshToken: false },
})

const args = process.argv.slice(2)
const count = (() => {
	const first = args.find((a) => !a.startsWith('--'))
	return first ? parseInt(first, 10) : 5
})()
const requestToArg = args.find((a) => a.startsWith('--request-to='))
const requestToUsername = requestToArg
	? requestToArg.slice('--request-to='.length)
	: null

if (Number.isNaN(count) || count < 1) {
	console.error('Invalid count. Usage: seed-test-users.mjs [count]')
	process.exit(1)
}

let targetId = null
if (requestToUsername) {
	const { data, error } = await supabase
		.from('profiles')
		.select('id, username')
		.ilike('username', requestToUsername)
		.maybeSingle()
	if (error || !data) {
		console.error(
			`--request-to target "${requestToUsername}" not found:`,
			error?.message ?? 'no row'
		)
		process.exit(1)
	}
	targetId = data.id
	console.log(`will send requests to ${data.username} (${targetId})`)
}

const users = Array.from({ length: count }, (_, i) => {
	const n = i + 1
	return {
		username: `testuser${n}`,
		phone: `+1555${String(n).padStart(7, '0')}`,
	}
})

for (const u of users) {
	const { data, error } = await supabase.auth.admin.createUser({
		phone: u.phone,
		password: TEST_PASSWORD,
		phone_confirm: true,
	})
	if (error) {
		console.error(`create ${u.username} failed: ${error.message}`)
		continue
	}
	const id = data.user.id

	const { error: pErr } = await supabase
		.from('profiles')
		.insert({ id, username: u.username, dev: true })
	if (pErr) {
		console.error(`profile ${u.username} failed: ${pErr.message}`)
		continue
	}
	console.log(`created ${u.username} (${id}) phone=${u.phone}`)

	if (targetId) {
		const { error: rErr } = await supabase
			.from('friend_requests')
			.insert({ sender_id: id, receiver_id: targetId })
		if (rErr) {
			console.error(
				`friend_request ${u.username} -> target failed: ${rErr.message}`
			)
		} else {
			console.log(`  → pending friend request sent to target`)
		}
	}
}
