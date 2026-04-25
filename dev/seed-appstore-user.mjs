import { createClient } from '@supabase/supabase-js'

const projectId = process.env.SUPABASE_PROJECT_ID
const serviceKey = process.env.SUPABASE_PRIVATE_KEY

if (!projectId || !serviceKey) {
	console.error(
		'Missing SUPABASE_PROJECT_ID or SUPABASE_PRIVATE_KEY in env. ' +
			'Run with: node --env-file=.env dev/seed-appstore-user.mjs'
	)
	process.exit(1)
}

const PHONE = '+11234567890'
const PASSWORD = 'testpassword'

const supabase = createClient(`https://${projectId}.supabase.co`, serviceKey, {
	auth: { persistSession: false, autoRefreshToken: false },
})

const { data: list, error: listErr } = await supabase.auth.admin.listUsers()
if (listErr) {
	console.error(`list users failed: ${listErr.message}`)
	process.exit(1)
}
const existing = list.users.find((u) => u.phone === PHONE.replace('+', ''))

let userId
if (existing) {
	userId = existing.id
	const { error: updErr } = await supabase.auth.admin.updateUserById(userId, {
		password: PASSWORD,
		phone_confirm: true,
	})
	if (updErr) {
		console.error(`update user failed: ${updErr.message}`)
		process.exit(1)
	}
	console.log(`updated existing reviewer user ${userId} (${PHONE})`)
} else {
	const { data, error } = await supabase.auth.admin.createUser({
		phone: PHONE,
		password: PASSWORD,
		phone_confirm: true,
	})
	if (error) {
		console.error(`create user failed: ${error.message}`)
		process.exit(1)
	}
	userId = data.user.id
	console.log(`created reviewer user ${userId} (${PHONE})`)
}
