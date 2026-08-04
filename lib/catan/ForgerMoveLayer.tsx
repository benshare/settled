import { Fragment } from 'react'
import { Circle, G } from 'react-native-svg'
import { hexesAdjacentTo } from './bonus'
import { type Hex } from './board'
import type { HexLayout } from './layout'
import { seatColor, tokenFace, tokenRing } from './palette'
import { PulsingDot } from './PulsingDot'
import type { GameState } from './types'

// Overlay rendered inside BoardSvg's transformed group. Active at the start of
// a forger's turn, where moving the token one hex is compulsory before rolling
// — so the pulse fires on its own rather than behind an affordance. Renders
// nothing for anyone else.
export function ForgerMoveLayer({
	state,
	meIdx,
	from,
	layoutS,
	hexLayouts,
	onMove,
}: {
	state: GameState
	meIdx: number
	from: Hex
	layoutS: number
	hexLayouts: HexLayout[]
	onMove: (hex: Hex) => void
}) {
	const targets = new Set<Hex>(hexesAdjacentTo(from, state.variant))
	const color = seatColor(state, meIdx)
	// Same reason as RobberLayer: the desert has no NumberToken, so a pulse
	// there would read as a solid blob rather than a halo around an anchor.
	const tokenR = layoutS * 0.42
	const tokenSw = Math.max(1, layoutS * 0.03)
	return (
		<G>
			{hexLayouts
				.filter((h) => targets.has(h.id))
				.map((h) => {
					const isDesert = state.hexes[h.id]?.resource == null
					return (
						<Fragment key={h.id}>
							{isDesert && (
								<Circle
									cx={h.cx}
									cy={h.cy}
									r={tokenR}
									fill={tokenFace}
									stroke={tokenRing}
									strokeWidth={tokenSw}
								/>
							)}
							<PulsingDot
								cx={h.cx}
								cy={h.cy}
								r={layoutS * 0.34}
								color={color}
							/>
							<Circle
								cx={h.cx}
								cy={h.cy}
								r={layoutS * 0.55}
								fill="#000"
								fillOpacity={0.001}
								onPress={() => onMove(h.id)}
							/>
						</Fragment>
					)
				})}
		</G>
	)
}
