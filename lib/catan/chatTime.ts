// Chat timestamp rules, iMessage style. Pure; `now` is injectable so the
// day-relative labels can be checked without a clock.

// A silence at least this long opens a new time chunk: a centered time header,
// and the sender's name repeats even if they're the one who resumes.
export const CHAT_CHUNK_GAP_MS = 3 * 60 * 1000

export function startsTimeChunk(
	prev: { created_at: string } | undefined,
	msg: { created_at: string }
): boolean {
	if (!prev) return true
	return (
		Date.parse(msg.created_at) - Date.parse(prev.created_at) >=
		CHAT_CHUNK_GAP_MS
	)
}

const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(d: Date): number {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function clock(d: Date, seconds = false): string {
	return d.toLocaleTimeString(undefined, {
		hour: 'numeric',
		minute: '2-digit',
		...(seconds && { second: '2-digit' }),
	})
}

// Calendar days between `d` and `now`, by local midnight (so 11:59 PM
// yesterday is 1, not 0). Rounded because a DST day isn't 24 h.
function daysAgo(d: Date, now: Date): number {
	return Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS)
}

// "Today 3:42 PM", "Yesterday 9:10 AM", "Monday 3:42 PM" within the week,
// "Nov 3, 3:42 PM" (plus the year, when it isn't this one) beyond.
export function chunkHeaderLabel(iso: string, now = new Date()): string {
	const d = new Date(iso)
	const days = daysAgo(d, now)
	if (days <= 0) return `Today ${clock(d)}`
	if (days === 1) return `Yesterday ${clock(d)}`
	if (days < 7)
		return `${d.toLocaleDateString(undefined, { weekday: 'long' })} ${clock(d)}`
	const date = d.toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric',
		...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
	})
	return `${date}, ${clock(d)}`
}

// The tap-to-reveal detail under one message: the full date and the time to
// the second, regardless of how recent.
export function exactSentLabel(iso: string): string {
	const d = new Date(iso)
	const date = d.toLocaleDateString(undefined, {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		year: 'numeric',
	})
	return `Sent ${date} at ${clock(d, true)}`
}
