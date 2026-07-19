# Honk

A joke feature: when the game is stalled waiting on someone to roll, other players
get a **Honk** button that nudges them with a push notification and a line in the
action log.

## Behaviour

While `phase.kind === 'roll'` and it is **not** your turn, a `Honk` button appears
next to the `[user] to roll` status in `MainLoopBar` — but only once the game has
been idle for **≥ 5 minutes**. Tapping it:

- appends a `honked` event → the action log reads `[user] has been Honked`
- sends the current player a push: `HONK. It's your turn. (Sent by [sender])`

Each waiting player gets **one honk per stalled turn**. After you honk, your button
disappears until the turn advances; other players keep theirs.

## Decisions

| Question                           | Answer                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| When does the button show?         | `roll` phase only — the literal "[user] to roll" stall. Not `main`, placement, discard, robber, or `special_build`. |
| What does the 5-min timer measure? | Time since the newest **non-honk** `games.events[].at` — i.e. since any real game activity. No new column.          |
| Honk limit                         | One per **sender**, per stalled turn. A 4-player game can produce 3 honks on one turn.                              |
| Notification gate                  | **Ungated.** Honks always send; there is no `honk` pref toggle.                                                     |

Honk events are excluded from the idle clock deliberately: a honk is not game
activity, and counting it would let the first honker's ping reset the 5-minute
window and lock everyone else out.

## New state

None. No migration. The rule is **derived from `games.events`**, which the client
already loads and the server already appends to:

```ts
| { kind: 'honked'; player: number; from: number; at: string }
```

`player` = the honked (current) player's seat index, `from` = the sender's seat.
`from` is what makes the one-per-sender check possible; the log line only renders
`player`.

**The current turn's window** = every event after the most recent `turn_ended`
event (the whole array if none exists yet — i.e. the first turn out of placement).
Honks are counted within that window only, so the allowance resets on every turn
advance with no bookkeeping or reset logic.

## `lib/catan/honk.ts` (new)

Pure rules, no I/O — same shape as `roll.ts` / `build.ts`, and **mirrored into the
edge function** per the duplication rule in `lib/catan/CLAUDE.md`.

```ts
export const HONK_IDLE_MS = 5 * 60 * 1000

// Newest non-honk event timestamp, or null if there are no events.
export function lastActivityAt(events: GameEvent[]): number | null

// Seat indices that have already honked during the current turn window.
export function honkersThisTurn(events: GameEvent[]): Set<number>

export function canHonk(args: {
	events: GameEvent[]
	phase: Phase
	meIdx: number
	currentTurn: number
	now: number
}): boolean
```

`canHonk` is true iff **all** of:

- `phase.kind === 'roll'`
- `meIdx >= 0` (viewer is seated — not a spectator)
- `meIdx !== currentTurn` (you cannot honk yourself)
- `!honkersThisTurn(events).has(meIdx)`
- `lastActivityAt(events) !== null && now - lastActivityAt(events) >= HONK_IDLE_MS`

The same predicate gates the button client-side and authorizes the write
server-side, so the two can never disagree. `now` is a parameter rather than a
`Date.now()` call so the function stays pure and testable.

`dev/check-catan-honk.ts` covers: idle threshold boundary, honk events not
resetting the clock, one-per-sender, the reset on `turn_ended`, self-honk
rejection, and the no-`turn_ended`-yet first turn.

## Client

**`lib/stores/useGamesStore.ts`** — add the `honked` variant to `GameEvent`; add

```ts
async honk(gameId) {
  return callGameService({ action: 'honk', game_id: gameId }, "Couldn't honk")
}
```

**`lib/catan/ActionLog.tsx`** — `describeEvent`:

```ts
case 'honked':
  return {
    text: e.player === ctx.meIdx
      ? 'You have been Honked'
      : `${who(e.player)} has been Honked`,
    player: e.player,
  }
```

The self case is spelled out because `nameFor` returns `'You'`, and
`"You has been Honked"` is broken grammar.

**`app/game/[id].tsx`** — a `HonkButton` subcomponent in the same file (it is not
generalizable beyond this bar), rendered inside `MainLoopBar` next to the status
text, in the slot where the `Roll` / `End turn` buttons sit for the active player.

It must be **its own component, not inline in `MainLoopBar`**: the button needs a
ticking clock to notice the 5-minute mark, and `MainLoopBar` early-returns on
`phase.kind` at the top of the body — adding a hook after that would violate the
rules of hooks. `HonkButton` mounts only when it is relevant, so its interval only
runs when someone is actually waiting.

- holds `const [now, setNow] = useState(Date.now())`, ticking on a **10 s**
  `setInterval` (a 5-minute threshold does not need finer resolution), cleared on
  unmount
- renders `null` unless `canHonk({...})`
- `variant="secondary"` so it reads as a side affordance next to the primary
  actions, and `loading={submitting}` consistent with the other buttons in the bar

`MainLoopBar` takes a new `onHonk: () => void` prop; the screen wires it to
`honk(game.id)` through the existing submit-guard pattern used by `onRoll` /
`onEndTurn`.

## Server

**`supabase/functions/_notify/index.ts`**

- `NotificationKind` += `'honk'`
- `gate` becomes **optional** on `NotifyTarget`, and the pref check becomes
  `if (t.gate && prefs[t.gate] === false) continue`. This is what makes "ungated"
  explicit rather than smuggling it through a pref key that happens not to exist.
- `renderBody`: `case 'honk': return \`HONK. It's your turn. (Sent by ${sender ?? 'someone'})\``

**`supabase/functions/game-service/index.ts`**

- `type HonkBody = { action: 'honk'; game_id: string }` into the `Body` union
- `case 'honk': return handleHonk(admin, me, body)` in the dispatch switch
- `handleHonk`: load `games` + `game_states`, resolve `meIdx` from `player_order`,
  reject if the game is not in progress, then re-check `canHonk` against
  **server** time and the stored events (mirrored copy of `honk.ts`). On success
  append the `honked` event to `games.events` and

```ts
EdgeRuntime.waitUntil(
	sendNotifications(admin, [
		{
			userId: game.player_order[currentTurn],
			kind: 'honk',
			gameId: game.id,
			senderProfileId: me,
		},
	])
)
```

The client's `canHonk` is a UI affordance only — a stale clock, a replayed
request, or a hand-rolled call must fail the same predicate on the server.

## Out of scope

- No honking during `main`, `special_build`, placement, or any robber/discard
  sub-phase.
- No honk pref toggle in account settings.
- No sound, haptic, or animation on receipt — the push notification is the payoff.
