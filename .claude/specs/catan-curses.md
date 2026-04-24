# Catan curses

Wires gameplay effects for the 11 curses in `lib/catan/bonuses/curses.ts`. Until now curses have been dealt and stored on `PlayerState.curse` but had no mechanical effect. Bonuses remain cosmetic — this spec is curses only.

Depends on: `catan-longest-road-and-victory.md` (Longest Road, Largest Army, `findWinner` at 10 VP).

## Scope — all 11 base-set curses

- `age` — max 6 cards spent per turn on traditional builds (road / settlement / city / dev-card buy)
- `decadence` — max 2 cities
- `ambition` — need 11 VP to win
- `elitism` — max 3 settlements currently on board before first city, max 2 after
- `asceticism` — effective −2 for Longest Road, −1 for Largest Army
- `nomadism` — must have ≥11 of your own roads on the board to win
- `avarice` — on a rolled 7, if hand >7, discard everything
- `power` — ≤3 pips per hex, ≤2 hexes at exactly 3 pips (settlement = 1, city = 2)
- `compaction` — max 7 roads
- `provinciality` — cannot use ports; bank rate 5:1
- `youth` — your buildings may not touch all 5 resource types

## Architecture

- Source of truth in `lib/catan/`. New `lib/catan/curses.ts` for rules, alongside the existing data-only `lib/catan/bonuses/curses.ts`. (Pattern matches `dev.ts` vs. `devCards.ts`.)
- Each rule takes the player's curse id (or undefined) as input — no global effect registry. One curse per player, no stacking.
- Existing helpers get curse-aware variants or an optional curse arg: `isValidBuildRoadEdge`, `isValidBuildSettlementVertex`, `isValidBuildCityVertex`, `availableBankOptions`, `isValidBankTradeShape`, `requiredDiscards`, `recomputeLongestRoad`, `recomputeLargestArmy`, `findWinner`, plus the active-tool gating in `BuildTradeBar` / BuildLayer / PlacementLayer.
- Edge function mirrors. New check script `dev/check-catan-curses.ts`.

## Question resolutions (locked)

1. **Age** — only traditional building counts (road, settlement, city, dev-card buy). Bank trades, port trades, player trades, 7-roll discards, resource grants from dev cards are all excluded.
2. Same: 7-roll discards don't count.
3. **Elitism** — count current cities (live check), not a sticky "ever built" flag. A player with 0 cities has the max-3 cap; with ≥1 city they have the max-2 cap. No `hasBuiltCity` field.
4. **Power** — pips: settlement = 1, city = 2; sum per hex per player. Robber presence is irrelevant.
5. **Youth** — cities count toward the touched-resource set (they're upgraded settlements). Desert doesn't count.
6. **Provinciality** — only ports + bank. Player trades unaffected.
7. **Avarice** — trigger hand > 7 on a rolled 7; cursed player discards everything.
8. **Curses gate initial placement** too. In practice only youth bites (power can't violate with 2 settlements on non-adjacent vertices).
9. **Nomadism road count** = all of the player's roads on the board (includes the 2 initial-placement roads).
10. **UI**: disabled button + curse icon badge in the top-right corner of the button (reusing the `cancelBadge` position from `BuildTradeBar`). Press on mobile / hover on web shows a tooltip with the curse name + reason. New `Tooltip` primitive in `lib/modules/Tooltip.tsx` (cross-platform: `Pressable` + `onHoverIn`/`onHoverOut` on web, long-press on mobile, dismisses on release).
11. **Events**: log a curse-triggered event when a curse changed an outcome (avarice discard amount, asceticism Longest Road / Largest Army grant or miss). Skip the log when a build was simply blocked (the disabled button is the signal).
12. Ship all 11.

## Shared helpers (new `lib/catan/curses.ts`)

- `curseOf(state, playerIdx): CurseId | undefined`
- `hasCurse(state, playerIdx, id: CurseId): boolean`
- Effective counts for asceticism:
    - `effectiveLongestRoadLength(state, playerIdx): number` — `max(0, longestRoadFor - 2)` if cursed else raw
    - `effectiveKnights(p: PlayerState, curse): number` — `max(0, knightsPlayed - 1)` if cursed else raw
- Caps:
    - `maxCitiesFor(curse): number` — 2 if decadence else 4 (supply cap preserved)
    - `maxRoadsFor(curse): number` — 7 if compaction else 15
    - `maxSettlementsFor(curse, currentCities): number` — if elitism: `currentCities >= 1 ? 2 : 3`; else 5
    - `winVPThresholdFor(curse): number` — 11 if ambition, else 10
    - `winRoadsRequiredFor(curse): number` — 11 if nomadism, else 0
- Power:
    - `hexPowerForPlayer(state, playerIdx, hex): number`
    - `countHexesAtMaxPower(state, playerIdx): number` — hexes where the player sits at exactly 3
    - `canPlaceBuildingUnderPower(state, playerIdx, vertex, kind: 'settlement' | 'city'): boolean`
- Youth:
    - `touchedResources(state, playerIdx): Set<Resource>`
    - `settlementKeepsYouthOK(state, playerIdx, vertex): boolean`
- Age:
    - `canSpendUnderAge(p: PlayerState, curse, costSize: number): boolean` — checks `(cardsSpentThisTurn ?? 0) + costSize ≤ 6`

## Per-curse implementation notes

### age

- `PlayerState.cardsSpentThisTurn?: number` (sparse; only written on cursed players). Incremented by the total `ResourceHand` sum paid at build-time (road = 2, settlement = 4, city = 5, dev card = 3).
- Reset on `end_turn` for the outgoing active player.
- Every build handler gates on `canSpendUnderAge` before applying cost. UI mirrors.

### decadence

- Block `city` build when player already has 2 cities.

### ambition

- `findWinner` uses `winVPThresholdFor(curse)` instead of the literal 10.

### elitism

- Live count of current settlements vs. `maxSettlementsFor(curse, currentCities)`. Block `settlement` build when at cap.

### asceticism

- `recomputeLongestRoad` and `recomputeLargestArmy` use the effective-count helpers for cursed players.

### nomadism

- `findWinner`: in addition to VP threshold, require road count ≥ `winRoadsRequiredFor(curse)`.

### avarice

- `requiredDiscards` returns `handSize` (full hand) for cursed players whose hand > 7.

### power

- Settlement build on vertex V: for every hex H adjacent to V, compute `hexPowerForPlayer(..., H) + 1`. Must be ≤ 3. If any adjacent hex would become exactly 3 via this placement, and `countHexesAtMaxPower(...)` is already 2 (and none of the flipping hexes is already at 3), reject.
- City build on vertex V: same, but the delta is +1 on each hex adjacent to V (a settlement becomes a city there).
- Applies during initial placement too.

### compaction

- Block `road` build when player already has 7 roads placed.

### provinciality

- `availableBankOptions` for cursed players returns `['5:1']` only.
- `BankKind` gains `'5:1'`; `ratioOf('5:1') = 5`. `isValidBankTradeShape` handles the new ratio.
- Cursed players' port access is ignored for the purposes of bank-option generation.
- Player trades unaffected.

### youth

- Block a settlement build if the post-placement touched-resource set has size 5.
- Desert hexes don't contribute. Cities count (upgraded settlements).
- Applies during initial placement too.

## Cross-cutting edits

- `lib/catan/types.ts`: `PlayerState.cardsSpentThisTurn?: number`; `BankKind` += `'5:1'`.
- `lib/catan/ports.ts`: handle `5:1`, wire `availableBankOptions` to curse.
- `lib/catan/build.ts`: curse gates inside validity helpers (take `meCurse: CurseId | undefined`).
- `lib/catan/placement.ts`: same curse gates for initial settlement/road placement.
- `lib/catan/robber.ts`: `requiredDiscards` curse override.
- `lib/catan/longestRoad.ts` + `lib/catan/dev.ts`: effective counts in `recompute*` functions.
- `lib/catan/dev.ts` (or new `lib/catan/victory.ts`): `findWinner` curse-aware. Current `findWinner` lives in the edge function only; lift a `findWinner` into lib for parity and test coverage. Update `applyEndOfActionChecks` to use it.
- `lib/catan/curses.ts`: new — all the helpers above.
- Edge function: mirror every change above. Reset `cardsSpentThisTurn` in `end_turn`. Mirror curse-aware `findWinner`. Mirror avarice `requiredDiscards`. Mirror effective-count paths in Longest Road + Largest Army recomputes. Mirror bank option + `5:1` ratio.
- UI:
    - `lib/modules/Tooltip.tsx` — new cross-platform tooltip primitive (hover + long-press).
    - `BuildTradeBar.tsx` — when a build option is disabled _because of the player's curse_ (not resources / phase), render the curse icon as a top-right badge (reusing the `cancelBadge` slot with a curse-themed style) and wrap the button in the tooltip. Surface a prop `curseReason?: string` per option.
    - `BuildLayer.tsx` — same treatment on any "no valid target" UI state induced by a curse (e.g. power blocks, youth blocks) so tappable hints are visible.
    - `PlacementLayer.tsx` — same, for initial placement under youth / power.
    - `TradePanel.tsx` — the port/bank row shows only `5:1` for provinciality cursed players; other rows carry the badge + tooltip when hidden.

## Event log

No curse-specific event kinds. The disabled-button UX and the standard
`bank_trade` / Longest Road / Largest Army events already carry the outcome —
there's nothing silent worth labelling separately.

## Check script

`dev/check-catan-curses.ts`: one section per curse with table-driven cases. Wired into the `npx tsx` pattern used across the other nine check scripts. Run after every change here before `npm run edge`.

## Implementation order (one curse per step)

1. Shared `curses.ts` + `PlayerState.cardsSpentThisTurn` + `BankKind '5:1'` + `Tooltip` primitive.
2. `avarice` (smallest effect surface).
3. `compaction`.
4. `decadence`.
5. `elitism`.
6. `age` (new field + build gates).
7. `provinciality`.
8. `ambition`.
9. `nomadism`.
10. `asceticism`.
11. `power`.
12. `youth`.
13. Edge function mirror pass.
14. `dev/check-catan-curses.ts` coverage + `npm run check` + `npm run edge` + `npm run format`.
