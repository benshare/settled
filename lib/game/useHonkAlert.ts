// The honked player's goose: fires once on opening a game in which the viewer
// was honked since they last looked, and live for a honk landing while they
// watch. "Last looked" is a per-user, per-game cursor (the `at` of the newest
// event acknowledged) kept on this device in `authStorage` — a honk only
// matters to the person who sees the board, so there is nothing to sync.
// The cursor advances even with the animation turned off, so switching it on
// later doesn't replay a backlog. See `.claude/specs/honk.md`.

import { useEffect, useRef, useState } from 'react'
import { honkAlertSince, honkAlertText } from '../catan/honk'
import type { GameEvent } from '../stores/useGamesStore'
import type { Profile } from '../stores/useProfileStore'
import { authStorage } from '../supabase'

export type HonkAlertView = { key: string; text: string }

type Cursor = { gameId: string; at: string | null; loaded: boolean }

export function useHonkAlert({
	gameId,
	events,
	playerOrder,
	meIdx,
	userId,
	profilesById,
	enabled,
}: {
	gameId: string | undefined
	events: GameEvent[] | undefined
	playerOrder: string[] | undefined
	meIdx: number
	userId: string | undefined
	profilesById: Record<string, Profile>
	enabled: boolean
}): { honkAlert: HonkAlertView | null; dismissHonkAlert: () => void } {
	const [alert, setAlert] = useState<HonkAlertView | null>(null)
	const cursorRef = useRef<Cursor | null>(null)
	// Bumped when a cursor read lands, so the scan below re-runs against it.
	const [loadTick, setLoadTick] = useState(0)

	// The provider survives a header tab switch, so a new game id re-reads.
	useEffect(() => {
		setAlert(null)
		if (!gameId || !userId) {
			cursorRef.current = null
			return
		}
		cursorRef.current = { gameId, at: null, loaded: false }
		let cancelled = false
		authStorage
			.getItem(storageKey(userId, gameId))
			.catch(() => null)
			.then((raw) => {
				if (cancelled) return
				cursorRef.current = { gameId, at: raw ?? null, loaded: true }
				setLoadTick((t) => t + 1)
			})
		return () => {
			cancelled = true
		}
	}, [gameId, userId])

	useEffect(() => {
		const cursor = cursorRef.current
		if (!cursor?.loaded || cursor.gameId !== gameId || !userId) return
		if (!events || !playerOrder || meIdx < 0) return
		const found = honkAlertSince(events, meIdx, cursor.at)
		// With no record yet, anchor at the newest event so the next open has
		// something to compare against; otherwise only a shown honk moves it.
		const next = found?.at ?? cursor.at ?? newestAt(events)
		if (next !== cursor.at) {
			cursorRef.current = { ...cursor, at: next }
			if (next !== null) {
				authStorage
					.setItem(storageKey(userId, cursor.gameId), next)
					.catch((err) => console.warn('[honk] write failed', err))
			}
		}
		if (!found || !enabled) return
		const name =
			profilesById[playerOrder[found.from]]?.username ?? 'Someone'
		setAlert({
			key: `${cursor.gameId}:${found.at}:${found.from}`,
			text: honkAlertText(name, found.others),
		})
		// `profilesById` only names the sender; a profile landing later must
		// not re-run the scan.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [gameId, events, playerOrder, meIdx, userId, enabled, loadTick])

	return { honkAlert: alert, dismissHonkAlert: () => setAlert(null) }
}

function storageKey(userId: string, gameId: string): string {
	return `settled.honkSeen.${userId}.${gameId}`
}

function newestAt(events: GameEvent[]): string | null {
	let best: string | null = null
	let bestT = -Infinity
	for (const e of events) {
		const t = Date.parse(e?.at)
		if (t > bestT) {
			bestT = t
			best = e.at
		}
	}
	return best
}
