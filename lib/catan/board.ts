// Standard Catan board — fixed structure. IDs, adjacency, and constants.
// Per-game state (which resource/number lands on which hex, placed pieces,
// hands, phase) lives in GameState (see ./types.ts), not here.

// --- IDs -------------------------------------------------------------------

// 19 hexes, top-to-bottom row-by-row, left-to-right within each row.
export const HEXES = [
	'1A',
	'1B',
	'1C',
	'2A',
	'2B',
	'2C',
	'2D',
	'3A',
	'3B',
	'3C',
	'3D',
	'3E',
	'4A',
	'4B',
	'4C',
	'4D',
	'5A',
	'5B',
	'5C',
] as const
export type Hex = (typeof HEXES)[number]

// 54 vertices, six rows of widths 7, 9, 11, 11, 9, 7.
export const VERTICES = [
	'1A',
	'1B',
	'1C',
	'1D',
	'1E',
	'1F',
	'1G',
	'2A',
	'2B',
	'2C',
	'2D',
	'2E',
	'2F',
	'2G',
	'2H',
	'2I',
	'3A',
	'3B',
	'3C',
	'3D',
	'3E',
	'3F',
	'3G',
	'3H',
	'3I',
	'3J',
	'3K',
	'4A',
	'4B',
	'4C',
	'4D',
	'4E',
	'4F',
	'4G',
	'4H',
	'4I',
	'4J',
	'4K',
	'5A',
	'5B',
	'5C',
	'5D',
	'5E',
	'5F',
	'5G',
	'5H',
	'5I',
	'6A',
	'6B',
	'6C',
	'6D',
	'6E',
	'6F',
	'6G',
] as const
export type Vertex = (typeof VERTICES)[number]

// 72 edges. Canonical form is `"${a} - ${b}"` with a < b lexically.
export const EDGES = [
	'1A - 1B',
	'1A - 2B',
	'1B - 1C',
	'1C - 1D',
	'1C - 2D',
	'1D - 1E',
	'1E - 1F',
	'1E - 2F',
	'1F - 1G',
	'1G - 2H',
	'2A - 2B',
	'2A - 3B',
	'2B - 2C',
	'2C - 2D',
	'2C - 3D',
	'2D - 2E',
	'2E - 2F',
	'2E - 3F',
	'2F - 2G',
	'2G - 2H',
	'2G - 3H',
	'2H - 2I',
	'2I - 3J',
	'3A - 3B',
	'3A - 4A',
	'3B - 3C',
	'3C - 3D',
	'3C - 4C',
	'3D - 3E',
	'3E - 3F',
	'3E - 4E',
	'3F - 3G',
	'3G - 3H',
	'3G - 4G',
	'3H - 3I',
	'3I - 3J',
	'3I - 4I',
	'3J - 3K',
	'3K - 4K',
	'4A - 4B',
	'4B - 4C',
	'4B - 5A',
	'4C - 4D',
	'4D - 4E',
	'4D - 5C',
	'4E - 4F',
	'4F - 4G',
	'4F - 5E',
	'4G - 4H',
	'4H - 4I',
	'4H - 5G',
	'4I - 4J',
	'4J - 4K',
	'4J - 5I',
	'5A - 5B',
	'5B - 5C',
	'5B - 6A',
	'5C - 5D',
	'5D - 5E',
	'5D - 6C',
	'5E - 5F',
	'5F - 5G',
	'5F - 6E',
	'5G - 5H',
	'5H - 5I',
	'5H - 6G',
	'6A - 6B',
	'6B - 6C',
	'6C - 6D',
	'6D - 6E',
	'6E - 6F',
	'6F - 6G',
] as const
export type Edge = (typeof EDGES)[number]

// --- Resources, numbers, buildings -----------------------------------------

// Canonical display order: brick, wood, sheep, wheat, ore. Iteration order is
// not semantically meaningful (bags are shuffled, hands are summed), but UI
// that renders resources in sequence should rely on this order.
export const RESOURCES = ['brick', 'wood', 'sheep', 'wheat', 'ore'] as const
export type Resource = (typeof RESOURCES)[number]

// Standard board: 3/4/4/4/3 + 1 desert = 19 hexes.
export const STANDARD_RESOURCE_COUNTS: Record<Resource, number> = {
	brick: 3,
	wood: 4,
	sheep: 4,
	wheat: 4,
	ore: 3,
}

// 18 tokens spread across the 18 non-desert hexes.
export const STANDARD_NUMBERS = [
	2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12,
] as const
export type HexNumber = (typeof STANDARD_NUMBERS)[number]

// Vertex buildings only. An occupied edge is implicitly a road.
export const VERTEX_BUILDINGS = ['settlement', 'city'] as const
export type VertexBuilding = (typeof VERTEX_BUILDINGS)[number]

// --- Ports (harbors) -------------------------------------------------------

// Coastal ring: the 30 edges where only one land hex borders the edge. Listed
// in clockwise order starting from the top of hex 1A — order matters because
// PORT_SLOTS picks by index and `dev/check-catan-ports.ts` validates the
// 1-adjacent-hex property of every entry.
export const COASTAL_EDGES: readonly Edge[] = [
	'1B - 1C',
	'1C - 1D',
	'1D - 1E',
	'1E - 1F',
	'1F - 1G',
	'1G - 2H',
	'2H - 2I',
	'2I - 3J',
	'3J - 3K',
	'3K - 4K',
	'4J - 4K',
	'4J - 5I',
	'5H - 5I',
	'5H - 6G',
	'6F - 6G',
	'6E - 6F',
	'6D - 6E',
	'6C - 6D',
	'6B - 6C',
	'6A - 6B',
	'5B - 6A',
	'5A - 5B',
	'4B - 5A',
	'4A - 4B',
	'3A - 4A',
	'3A - 3B',
	'2A - 3B',
	'2A - 2B',
	'1A - 2B',
	'1A - 1B',
]

// The 9 canonical port slots. Picked from COASTAL_EDGES with a 3-3-4 spacing
// pattern (indices 0, 3, 7, 10, 13, 17, 20, 23, 27) so no two ports share a
// coastal vertex — matching how standard Catan keeps ports visually spaced.
// Port positions are fixed across games; only port kinds are shuffled.
export const PORT_SLOTS: readonly Edge[] = [
	'1B - 1C',
	'1E - 1F',
	'2I - 3J',
	'4J - 4K',
	'5H - 6G',
	'6C - 6D',
	'5B - 6A',
	'4A - 4B',
	'2A - 2B',
]

// '3:1' is a generic port (any resource at 3:1). Resource-kinded ports are
// 2:1 for that specific resource.
export const PORT_KINDS = [
	'3:1',
	'brick',
	'wood',
	'sheep',
	'wheat',
	'ore',
] as const
export type PortKind = (typeof PORT_KINDS)[number]

// Standard distribution: 4 generic + 1 per resource = 9.
export const STANDARD_PORT_KINDS: readonly PortKind[] = [
	'3:1',
	'3:1',
	'3:1',
	'3:1',
	'brick',
	'wood',
	'sheep',
	'wheat',
	'ore',
]

// --- Adjacency -------------------------------------------------------------

// Each hex's 6 corner vertices in clockwise order starting from N.
// This is the only hand-authored adjacency; everything else is derived.
// Runtime validator checks that each row is exactly 6 unique vertices.
export const adjacentVertices: Record<Hex, readonly Vertex[]> = {
	'1A': ['1B', '1C', '2D', '2C', '2B', '1A'],
	'1B': ['1D', '1E', '2F', '2E', '2D', '1C'],
	'1C': ['1F', '1G', '2H', '2G', '2F', '1E'],
	'2A': ['2B', '2C', '3D', '3C', '3B', '2A'],
	'2B': ['2D', '2E', '3F', '3E', '3D', '2C'],
	'2C': ['2F', '2G', '3H', '3G', '3F', '2E'],
	'2D': ['2H', '2I', '3J', '3I', '3H', '2G'],
	'3A': ['3B', '3C', '4C', '4B', '4A', '3A'],
	'3B': ['3D', '3E', '4E', '4D', '4C', '3C'],
	'3C': ['3F', '3G', '4G', '4F', '4E', '3E'],
	'3D': ['3H', '3I', '4I', '4H', '4G', '3G'],
	'3E': ['3J', '3K', '4K', '4J', '4I', '3I'],
	'4A': ['4C', '4D', '5C', '5B', '5A', '4B'],
	'4B': ['4E', '4F', '5E', '5D', '5C', '4D'],
	'4C': ['4G', '4H', '5G', '5F', '5E', '4F'],
	'4D': ['4I', '4J', '5I', '5H', '5G', '4H'],
	'5A': ['5C', '5D', '6C', '6B', '6A', '5B'],
	'5B': ['5E', '5F', '6E', '6D', '6C', '5D'],
	'5C': ['5G', '5H', '6G', '6F', '6E', '5F'],
}

export const adjacentHexes: Record<Vertex, readonly Hex[]> = (() => {
	const out: Record<Vertex, Hex[]> = Object.fromEntries(
		VERTICES.map((v) => [v, [] as Hex[]])
	) as Record<Vertex, Hex[]>
	for (const h of HEXES) {
		for (const v of adjacentVertices[h]) out[v].push(h)
	}
	return out
})()

export const neighborVertices: Record<Vertex, readonly Vertex[]> = (() => {
	const out: Record<Vertex, Vertex[]> = Object.fromEntries(
		VERTICES.map((v) => [v, [] as Vertex[]])
	) as Record<Vertex, Vertex[]>
	for (const e of EDGES) {
		const [a, b] = edgeEndpoints(e)
		out[a].push(b)
		out[b].push(a)
	}
	return out
})()

export const adjacentEdges: Record<Vertex, readonly Edge[]> = (() => {
	const out: Record<Vertex, Edge[]> = Object.fromEntries(
		VERTICES.map((v) => [v, [] as Edge[]])
	) as Record<Vertex, Edge[]>
	for (const e of EDGES) {
		const [a, b] = edgeEndpoints(e)
		out[a].push(e)
		out[b].push(e)
	}
	return out
})()

// --- Helpers ---------------------------------------------------------------

export function edgeEndpoints(e: Edge): [Vertex, Vertex] {
	const [a, b] = e.split(' - ') as [Vertex, Vertex]
	return [a, b]
}

export function edgeBetween(a: Vertex, b: Vertex): Edge | undefined {
	const [x, y] = a < b ? [a, b] : [b, a]
	const id = `${x} - ${y}`
	return (EDGES as readonly string[]).includes(id) ? (id as Edge) : undefined
}

// To verify the hand-authored adjacencies after edits, run
// `npx tsx dev/check-catan-board.ts`.
