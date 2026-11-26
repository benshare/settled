// Pure: no React Native imports, so `dev/check-patch-notes.ts` can run it
// under tsx. See `.claude/specs/patch-notes.md`.

import raw from './patch-notes.json'

export type PatchNoteEntry = { id: string; notes: string[] }

// `YYYY-MM-DD.N`: the date of the push to `main`, then a per-day counter from
// 1. Compared by parts, never as strings ("x.10" sorts before "x.9").
const ID_RE = /^(\d{4}-\d{2}-\d{2})\.([1-9]\d*)$/

export const PATCH_NOTES = raw as PatchNoteEntry[]

export function parseId(id: string): { date: string; n: number } | null {
	const m = ID_RE.exec(id)
	return m ? { date: m[1], n: Number(m[2]) } : null
}

/** Negative if `a` is older than `b`. Both must parse. */
export function compareIds(a: string, b: string): number {
	const pa = parseId(a)
	const pb = parseId(b)
	if (!pa || !pb) throw new Error(`bad patch-note id: ${pa ? b : a}`)
	if (pa.date !== pb.date) return pa.date < pb.date ? -1 : 1
	return pa.n - pb.n
}

// A device with no record (patch notes are new to it) shows every entry since
// the last update that shipped before patch notes existed, so the launch batch
// reads as one changelog. The window keeps a new device on an old account from
// receiving months of history once that baseline is long past.
export const NO_RECORD_BASELINE_DATE = '2026-11-25'
const NO_RECORD_WINDOW_DAYS = 7

function daysBefore(date: string, days: number): string {
	const d = new Date(`${date}T00:00:00Z`)
	d.setUTCDate(d.getUTCDate() - days)
	return d.toISOString().slice(0, 10)
}

/**
 * The entries to show, newest first. `lastSeen` is this device's stored id
 * (null if none or unparseable). With no record, show the entries dated on or
 * after the later of the baseline and a week before the newest entry —
 * unless the account was created on or after the newest entry's date, i.e. a
 * new player for whom nothing has changed.
 */
export function entriesToShow(
	entries: PatchNoteEntry[],
	lastSeen: string | null,
	accountCreatedAt: string | null
): PatchNoteEntry[] {
	if (entries.length === 0) return []
	const newest = entries[entries.length - 1]
	if (lastSeen == null || !parseId(lastSeen)) {
		const newestDate = parseId(newest.id)!.date
		const created = accountCreatedAt?.slice(0, 10)
		if (created && created >= newestDate) return []
		const window = daysBefore(newestDate, NO_RECORD_WINDOW_DAYS)
		const floor =
			window > NO_RECORD_BASELINE_DATE ? window : NO_RECORD_BASELINE_DATE
		const shown = entries.filter((e) => parseId(e.id)!.date >= floor)
		return (shown.length ? shown : [newest]).reverse()
	}
	return entries.filter((e) => compareIds(e.id, lastSeen) > 0).reverse()
}

/** Problems with the file, for the dev check. Empty means valid. */
export function validatePatchNotes(entries: unknown): string[] {
	if (!Array.isArray(entries)) return ['top level must be an array']
	const errors: string[] = []
	let prev: string | null = null
	entries.forEach((e: unknown, i) => {
		const at = `entry ${i}`
		if (typeof e !== 'object' || e == null) {
			errors.push(`${at}: not an object`)
			return
		}
		const { id, notes, ...extra } = e as Record<string, unknown>
		const extraKeys = Object.keys(extra)
		if (extraKeys.length)
			errors.push(`${at}: unknown keys ${extraKeys.join(', ')}`)
		if (typeof id !== 'string' || !parseId(id)) {
			errors.push(`${at}: id must look like YYYY-MM-DD.N`)
			return
		}
		if (prev && compareIds(id, prev) <= 0)
			errors.push(`${at}: id ${id} is not after ${prev}`)
		prev = id
		if (
			!Array.isArray(notes) ||
			notes.length === 0 ||
			notes.some((n) => typeof n !== 'string' || !n.trim())
		)
			errors.push(`${at} (${id}): notes must be non-empty strings`)
	})
	return errors
}

/**
 * Entries (newest first) merged into one group per day, newest day first.
 * Within a day, newer entries come first; each entry's notes keep their order.
 */
export function groupByDay(
	entries: PatchNoteEntry[]
): { date: string; notes: string[] }[] {
	const days: { date: string; notes: string[] }[] = []
	for (const e of entries) {
		const date = parseId(e.id)?.date
		if (!date) continue
		const last = days[days.length - 1]
		if (last?.date === date) last.notes.push(...e.notes)
		else days.push({ date, notes: [...e.notes] })
	}
	return days
}

const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')

/** "Nov 26": a day group's label on the screen, from `YYYY-MM-DD`. */
export function dayLabel(date: string): string {
	const [, m, d] = date.split('-').map(Number)
	return m && d ? `${MONTHS[m - 1]} ${d}` : ''
}
