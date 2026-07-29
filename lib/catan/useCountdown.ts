// The ticking half of the move-timeout countdown. Kept out of `timeout.ts`,
// which is pure rules mirrored into the edge function and must stay free of
// React.

import { useEffect, useState } from 'react'
import { COUNTDOWN_VISIBLE_MS, remainingMs } from './timeout'

/**
 * Milliseconds left on `deadlineAt`, or null when there is no clock or it is
 * still further out than `COUNTDOWN_VISIBLE_MS` — a 7-day game shouldn't be
 * running an interval, or showing a number, for six and a half of those days.
 *
 * One interval per caller, so mount this once high enough to serve every seat
 * rather than per row. It ticks every second inside the final minute (where the
 * one-minute penalty window lives) and every ten otherwise.
 */
export function useCountdown(
	deadlineAt: string | null | undefined
): number | null {
	const [now, setNow] = useState(() => Date.now())
	const remaining = remainingMs(deadlineAt, now)
	const visible = remaining !== null && remaining <= COUNTDOWN_VISIBLE_MS
	const fine = visible && remaining < 60_000

	useEffect(() => {
		if (!deadlineAt) return
		// Poll slowly while the deadline is far off: the only thing that
		// changes is whether we've crossed into the visible window.
		const period = !visible ? 30_000 : fine ? 1_000 : 10_000
		const id = setInterval(() => setNow(Date.now()), period)
		return () => clearInterval(id)
	}, [deadlineAt, visible, fine])

	return visible ? remaining : null
}
