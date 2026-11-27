// Asserts the client banned-username list (lib/username.ts) matches the one
// embedded in the server trigger migration, which are necessarily duplicated.
// Run with `npx tsx dev/check-banned-usernames.ts`. Exits non-zero on drift.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { BANNED_USERNAMES } from '../lib/username'

const here = dirname(fileURLToPath(import.meta.url))
const migration = join(
	here,
	'../supabase/migrations/20261127120000_banned_usernames.sql'
)

const sql = readFileSync(migration, 'utf8')
const block = sql.match(
	/BANNED_USERNAMES_START[\s\S]*?array\[([\s\S]*?)\][\s\S]*?BANNED_USERNAMES_END/
)
if (!block) {
	console.error(
		'Could not find the BANNED_USERNAMES array between the START/END markers in the migration.'
	)
	process.exit(1)
}

// Strip SQL `--` comments, then pull every single-quoted literal.
const body = block[1].replace(/--[^\n]*/g, '')
const sqlList = [...body.matchAll(/'([^']*)'/g)].map((m) => m[1])

const client = [...BANNED_USERNAMES].sort()
const server = [...new Set(sqlList)].sort()

const missingOnServer = client.filter((w) => !server.includes(w))
const missingOnClient = server.filter((w) => !client.includes(w))

if (sqlList.length !== server.length) {
	console.error('Migration list has duplicate entries.')
	process.exit(1)
}
if (missingOnServer.length || missingOnClient.length) {
	console.error('Banned-username lists are out of sync:')
	if (missingOnServer.length)
		console.error('  in lib/username.ts but not the migration:', missingOnServer)
	if (missingOnClient.length)
		console.error('  in the migration but not lib/username.ts:', missingOnClient)
	process.exit(1)
}

console.log(`banned-usernames ok (${client.length} words, client == server)`)
