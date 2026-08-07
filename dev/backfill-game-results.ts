// Backfills `game_results` for games that completed before the edge function
// started writing them. Reads each finished game's `game_states` row and scores
// it with the real rules (`totalVP`), so the numbers match what a game
// completing today would record.
//
// `offered_bonuses` is left null: the bonus pair a player turned down was never
// stored for these games.
//
// Run with:
//   npx tsx --env-file=.env dev/backfill-game-results.ts [--dry-run]
//
// Service-role key — bypasses RLS. Check which project `.env` points at first.

import { createClient } from '@supabase/supabase-js'
import { totalVP } from '../lib/catan/dev'
import type { GameState } from '../lib/catan/types'

const projectId = process.env.SUPABASE_PROJECT_ID
const serviceKey = process.env.SUPABASE_PRIVATE_KEY

if (!projectId || !serviceKey) {
	console.error(
		'Missing SUPABASE_PROJECT_ID or SUPABASE_PRIVATE_KEY in env. Run with: ' +
			'npx tsx --env-file=.env dev/backfill-game-results.ts'
	)
	process.exit(1)
}

const dryRun = process.argv.includes('--dry-run')

const supabase = createClient(`https://${projectId}.supabase.co`, serviceKey, {
	auth: { persistSession: false, autoRefreshToken: false },
})

function rowToState(row: Record<string, unknown>): GameState {
	return {
		variant: row.variant as GameState['variant'],
		hexes: row.hexes as GameState['hexes'],
		vertices: row.vertices as GameState['vertices'],
		edges: row.edges as GameState['edges'],
		players: row.players as GameState['players'],
		phase: row.phase as GameState['phase'],
		currentTurn: (row.current_turn as number | null) ?? null,
		robber: row.robber as GameState['robber'],
		ports: (row.ports as GameState['ports']) ?? [],
		fenceTokens:
			(row.fence_tokens as GameState['fenceTokens']) ?? undefined,
		config: row.config as GameState['config'],
		// Nothing this script derives reads colors; it only needs the field to
		// satisfy GameState.
		colors: [],
		devDeck: (row.dev_deck as GameState['devDeck']) ?? [],
		largestArmy: (row.largest_army as GameState['largestArmy']) ?? null,
		longestRoad: (row.longest_road as GameState['longestRoad']) ?? null,
		round: row.round as number,
	}
}

// The `game_complete` event's timestamp is the real completion time; the games
// row only carries `created_at`.
function completedAt(events: unknown[], fallback: string): string {
	for (const e of events) {
		const ev = e as { kind?: string; at?: string }
		if (ev?.kind === 'game_complete' && typeof ev.at === 'string')
			return ev.at
	}
	return fallback
}

async function main() {
	const { data: games, error: gamesErr } = await supabase
		.from('games')
		.select('id, player_order, winner, events, created_at')
		.eq('status', 'complete')
	if (gamesErr) {
		console.error('Could not read games:', gamesErr.message)
		process.exit(1)
	}

	const { data: existing, error: existingErr } = await supabase
		.from('game_results')
		.select('game_id')
	if (existingErr) {
		console.error('Could not read game_results:', existingErr.message)
		process.exit(1)
	}
	const done = new Set((existing ?? []).map((r) => r.game_id))

	let written = 0
	let skipped = 0

	for (const game of games ?? []) {
		if (done.has(game.id)) {
			skipped++
			continue
		}
		if (game.winner === null) {
			console.warn(`skip ${game.id}: complete but no winner recorded`)
			skipped++
			continue
		}

		const { data: stateRow, error: stateErr } = await supabase
			.from('game_states')
			.select('*')
			.eq('game_id', game.id)
			.maybeSingle()
		if (stateErr || !stateRow) {
			console.warn(
				`skip ${game.id}: no game_states row${stateErr ? ` (${stateErr.message})` : ''}`
			)
			skipped++
			continue
		}

		const state = rowToState(stateRow as Record<string, unknown>)
		const points = state.players.map((_, i) => totalVP(state, i))
		const at = completedAt(game.events ?? [], game.created_at)
		const playerOrder = game.player_order as string[]
		const rows = playerOrder.map((userId, i) => ({
			game_id: game.id,
			user_id: userId,
			player_index: i,
			points: points[i],
			placement: 1 + points.filter((p) => p > points[i]).length,
			won: i === game.winner,
			turns: state.round,
			player_count: game.player_order.length,
			bonus: state.players[i]?.bonus ?? null,
			curse: state.players[i]?.curse ?? null,
			offered_bonuses: null,
			completed_at: at,
		}))

		if (dryRun) {
			console.log(
				`${game.id}: ${rows.map((r) => `${r.player_index}=${r.points}${r.won ? '*' : ''}`).join(' ')} (${state.round} turns)`
			)
			written++
			continue
		}

		const { error: writeErr } = await supabase
			.from('game_results')
			.upsert(rows, { onConflict: 'game_id,user_id' })
		if (writeErr) {
			console.error(`failed ${game.id}: ${writeErr.message}`)
			continue
		}
		written++
	}

	console.log(
		`${dryRun ? '[dry run] would write' : 'wrote'} ${written} game(s); skipped ${skipped}.`
	)
}

main()
