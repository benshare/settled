# Catan — board UI v1 (background, hexes, numbers)

First rendering pass for the Catan board. Draws the water background, 19 resource-colored hexes in the 3-4-5-4-3 pointy-top layout, and classic Catan number tokens. Pieces (settlements, cities, roads) are a follow-up.

## Scope

In scope:

- Add `react-native-svg` dependency (Expo-supported, cross-platform: iOS, Android, web).
- `lib/catan/layout.ts` — pure geometry helpers: pointy-top hex corner math, hex-center positions for each of the 19 hex IDs given a board size, number-token pip counts.
- `lib/catan/BoardView.tsx` — the rendering component. Takes a `GameState` and renders water background + 19 hexes + number tokens. Sizes itself to fit its parent (width-driven, aspect-ratio-locked).
- `lib/catan/HexTile.tsx` — a single resource-colored hexagon with an optional number token. Internal to Board for now; extracted so the piece follow-up has a clear seam.
- `lib/catan/NumberToken.tsx` — the classic white circle with number + pip row. Red digit/pips for 6 and 8.
- Update `app/game/[id].tsx` to render `<Board />` from `gameState` centered vertically in the available space. Removes the placeholder player circle and phase/hint text.

Out of scope:

- Settlements, cities, roads (vertex/edge rendering).
- Hit-testing / interactive placement.
- Robber token.
- Ports.
- Pan/zoom/gestures.
- Theming the palette to match the rest of the app — classic Catan colors stand alone.

## Locked decisions

1. **`react-native-svg` for all board drawing.** Cross-platform (iOS/Android/web) via Expo. Same component tree renders everywhere; gives us real polygons, clean hit regions later, and easy scaling.
2. **Pointy-top hexagons.** Rows of 3-4-5-4-3 stacked vertically; flat sides on east/west, points on north/south.
3. **Size: fit to parent.** Board fills 90% of the narrower of parent width/height, maintains its natural aspect ratio, centers within that box. Achieved by the parent passing a width/height into `<Board />`, or by Board using `onLayout` on a wrapper; final call in implementation — whichever is simpler. No zoom/pan.
4. **Classic Catan palette.** Board renders with its own palette, independent of `lib/theme`. All palette constants live in `lib/catan/palette.ts`.
    - Water: `#3B7FBF` (medium ocean blue)
    - Wood (forest): `#1F7A3A`
    - Wheat (fields): `#E3B23C`
    - Sheep (pasture): `#9BD16B`
    - Brick (hills): `#B94A2A`
    - Ore (mountains): `#7A7F86`
    - Desert (sand): `#E2C98A`
    - Hex border: `#2B2B2B` at ~1.5px stroke
    - Token face: `#F4EAD0` (off-white parchment)
    - Token ring: `#2B2B2B`
    - Token text/pip normal: `#1A1A1A`
    - Token text/pip hot (6 & 8): `#B02020`
5. **Classic number tokens.** White-ish parchment circle inscribed in the hex (radius ≈ 0.42 × hex size). Number centered; pip dots in a row below the number. 6 and 8 use red text and red pips. Pip counts by number (standard Catan "dot" distribution):
    - 2, 12 → 1 pip
    - 3, 11 → 2 pips
    - 4, 10 → 3 pips
    - 5, 9 → 4 pips
    - 6, 8 → 5 pips
6. **Geometry.** Pointy-top hex with "size" = circumradius `s`. Hex width = `√3 · s`; hex height = `2s`. Horizontal spacing between centers in a row = `√3 · s`; vertical spacing between adjacent rows = `1.5 · s`. Row offsets for the 3-4-5-4-3 layout:
    - Rows are indexed 1–5 (top to bottom); widths 3/4/5/4/3.
    - Row 3 (the 5-wide row) is horizontally centered; rows of width `w` are indented by `(5 - w)/2 · (√3 · s)` so the whole layout is symmetric.
    - Center of hex in row `r`, column `c` (0-indexed within row): `x = (5 - w)/2 · W + c · W + W/2`, `y = r · 1.5s + s` where `W = √3 · s`. Full board size = `5W × (4 · 1.5s + 2s)` = `5W × 8s`.
7. **Board fills its box.** Given a target width `T`, choose `s = T / (5 · √3)` so the content fits; height falls out at `8s = 8T/(5√3)`. If the target height is the binding constraint (tall narrow parents), invert.
8. **No desert token.** Desert hex draws only the hex fill; no number circle.
9. **Hex layout comes from `GameState.hexes`.** Board reads `hexes[hexId]` to know which resource/number to draw. Missing entries render as water (safety for partial states; in practice `generate.ts` populates all 19).
10. **Player circle / phase text removed.** `GameBody` in `app/game/[id].tsx` renders `<Board state={gameState} />` centered. Loading + not-found branches unchanged.

## Palette file

`lib/catan/palette.ts`:

```ts
import type { Resource } from './board'

export const waterColor = '#3B7FBF'
export const hexStroke = '#2B2B2B'
export const hexStrokeWidth = 1.5

export const resourceColor: Record<Resource | 'desert', string> = {
	wood: '#1F7A3A',
	wheat: '#E3B23C',
	sheep: '#9BD16B',
	brick: '#B94A2A',
	ore: '#7A7F86',
	desert: '#E2C98A',
}

export const tokenFace = '#F4EAD0'
export const tokenRing = '#2B2B2B'
export const tokenTextCool = '#1A1A1A'
export const tokenTextHot = '#B02020'

export const HOT_NUMBERS = new Set([6, 8])
```

## Layout file

`lib/catan/layout.ts`:

```ts
import { HEXES, type Hex, type HexNumber } from './board'

// Pointy-top hex with circumradius s:
//   width = √3 · s, height = 2s
//   neighbor center spacing: horizontal √3·s, vertical 1.5·s

export const HEX_ROWS: Record<1 | 2 | 3 | 4 | 5, readonly Hex[]> = {
    1: ['1A', '1B', '1C'],
    2: ['2A', '2B', '2C', '2D'],
    3: ['3A', '3B', '3C', '3D', '3E'],
    4: ['4A', '4B', '4C', '4D'],
    5: ['5A', '5B', '5C'],
}

export type HexLayout = { id: Hex; cx: number; cy: number }

export type BoardLayout = {
    s: number          // hex circumradius
    width: number      // total board width
    height: number     // total board height
    hexes: HexLayout[] // centers for all 19 hexes
}

// Fit the board into a target box, preserving aspect.
// aspect = 5√3 : 8  (width : height)
export function computeBoardLayout(
    targetW: number,
    targetH: number
): BoardLayout { ... }

// Six vertex corners for a pointy-top hex centered at (cx, cy) with size s.
// Order: N, NE, SE, S, SW, NW (clockwise from top).
export function hexCorners(
    cx: number,
    cy: number,
    s: number
): [number, number][] { ... }

export const PIP_COUNT: Record<HexNumber, number> = {
    2: 1, 12: 1,
    3: 2, 11: 2,
    4: 3, 10: 3,
    5: 4, 9: 4,
    6: 5, 8: 5,
}
```

## Components

### `lib/catan/BoardView.tsx`

```tsx
import Svg, { Rect } from 'react-native-svg'
import { View, type LayoutChangeEvent } from 'react-native'
import { useState } from 'react'
import type { GameState } from './types'
import { HEXES } from './board'
import { computeBoardLayout } from './layout'
import { HexTile } from './HexTile'
import { waterColor } from './palette'

export function Board({ state }: { state: GameState }) {
	const [box, setBox] = useState<{ w: number; h: number } | null>(null)
	const onLayout = (e: LayoutChangeEvent) => {
		const { width, height } = e.nativeEvent.layout
		setBox({ w: width, h: height })
	}
	return (
		<View style={{ flex: 1, width: '100%' }} onLayout={onLayout}>
			{box && <BoardSvg state={state} boxW={box.w} boxH={box.h} />}
		</View>
	)
}

function BoardSvg({
	state,
	boxW,
	boxH,
}: {
	state: GameState
	boxW: number
	boxH: number
}) {
	const layout = computeBoardLayout(boxW * 0.9, boxH * 0.9)
	const offsetX = (boxW - layout.width) / 2
	const offsetY = (boxH - layout.height) / 2
	return (
		<Svg width={boxW} height={boxH}>
			<Rect x={0} y={0} width={boxW} height={boxH} fill={waterColor} />
			<G x={offsetX} y={offsetY}>
				{layout.hexes.map((h) => (
					<HexTile
						key={h.id}
						layout={h}
						size={layout.s}
						data={state.hexes[h.id]}
					/>
				))}
			</G>
		</Svg>
	)
}
```

### `lib/catan/HexTile.tsx`

Draws one hex (resource fill + border) and, for non-desert hexes, the number token. Uses `hexCorners` to build the polygon points string.

### `lib/catan/NumberToken.tsx`

Renders:

- A `Circle` filled with `tokenFace`, stroked with `tokenRing`.
- A centered `SvgText` with the number. Fill red for 6/8 else dark.
- A row of pip dots below the text (count from `PIP_COUNT`); spaced evenly, centered horizontally. Red for 6/8.

## `app/game/[id].tsx` — changes

Replace the body's `PlayerCircle` + hint text with the board. The header and loading/not-found branches stay.

```tsx
function GameBody() {
	const { game, gameState, ready } = useGame()

	if (!ready && !game) {
		return (
			<View style={[styles.body, styles.center]}>
				<ActivityIndicator color={colors.brand} />
			</View>
		)
	}
	if (!game) {
		return (
			<View style={styles.body}>
				<Text style={styles.hint}>Game not found.</Text>
			</View>
		)
	}

	return (
		<View style={styles.boardContainer}>
			{gameState ? (
				<Board state={gameState} />
			) : (
				<ActivityIndicator color={colors.brand} />
			)}
		</View>
	)
}
```

Styles:

```ts
boardContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
}
```

Delete now-unused styles (`circleWrap`, `circle`, `slot`, `slotActive`, `avatarPlaceholder`, `slotName`, `winner`, `winnerText`, `hint`, `body`) — keep `safe`, `header`, `back`, `pressed`, `title`, `center`, and add `boardContainer`. Drop the `WinnerCallout`/`PlayerCircle` helpers and their imports (`Avatar`, `useAuth`, `useGamesStore`, `Profile`, `type Game`).

Keep: back button, "Game" title, loading state.

## Verification checklist

- [ ] `react-native-svg` added to `package.json` at an Expo-compatible version (use `npx expo install react-native-svg`).
- [ ] `lib/catan/palette.ts` exports the listed constants.
- [ ] `lib/catan/layout.ts` exports `HEX_ROWS`, `computeBoardLayout`, `hexCorners`, `PIP_COUNT`.
- [ ] `lib/catan/BoardView.tsx` renders a water rectangle + 19 hexes + number tokens from a `GameState`.
- [ ] `lib/catan/HexTile.tsx` renders one hex's polygon + token.
- [ ] `lib/catan/NumberToken.tsx` renders circle + number + pip row; red for 6/8.
- [ ] `app/game/[id].tsx` renders `<Board />` centered, no player circle / phase text.
- [ ] On a real game row (via accepted invite → generated `game_states`), all 19 hexes visible, 18 tokens visible (desert has none), no overlap, no cutoff.
- [ ] `npm run check` passes.
- [ ] `npm run format` run.

## Open issues for follow-up specs

- Rendering settlements/cities at vertices.
- Rendering roads at edges.
- Hit-testing for placement.
- Robber token.
- Responsive behavior on very wide web viewports (may want a max width).
- Ports along the water edge.
