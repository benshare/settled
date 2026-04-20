// Runtime sanity checks on the hand-authored hex/vertex/edge data in
// lib/catan/board.ts. Run with `npx tsx dev/check-catan-board.ts`.
//
// Catches typos in adjacentVertices or EDGES. Prints OK and exits 0 on
// success; throws with a specific error message on the first mismatch.

import {
	EDGES,
	HEXES,
	VERTICES,
	adjacentEdges,
	adjacentHexes,
	adjacentVertices,
	edgeBetween,
	neighborVertices,
	type Edge,
	type Hex,
	type Vertex,
} from '../lib/catan/board'

function validateBoard(): void {
	if (HEXES.length !== 19) throw new Error(`HEXES: ${HEXES.length} !== 19`)
	if (VERTICES.length !== 54)
		throw new Error(`VERTICES: ${VERTICES.length} !== 54`)
	if (EDGES.length !== 72) throw new Error(`EDGES: ${EDGES.length} !== 72`)

	const vertexSet = new Set<Vertex>(VERTICES)
	const hexSet = new Set<Hex>(HEXES)
	const edgeSet = new Set<string>(EDGES)

	// Every adjacentVertices value is a valid vertex and each hex has 6 unique ones.
	for (const h of HEXES) {
		const vs = adjacentVertices[h]
		if (vs.length !== 6)
			throw new Error(`${h}: expected 6 vertices, got ${vs.length}`)
		const seen = new Set<Vertex>()
		for (const v of vs) {
			if (!vertexSet.has(v)) throw new Error(`${h}: unknown vertex ${v}`)
			if (seen.has(v)) throw new Error(`${h}: duplicate vertex ${v}`)
			seen.add(v)
		}
	}

	// Every edge parses into two known vertices, sorted lexically.
	for (const e of EDGES) {
		const parts = e.split(' - ')
		if (parts.length !== 2) throw new Error(`malformed edge: ${e}`)
		const [a, b] = parts
		if (!vertexSet.has(a as Vertex)) throw new Error(`edge ${e}: bad a`)
		if (!vertexSet.has(b as Vertex)) throw new Error(`edge ${e}: bad b`)
		if (a >= b) throw new Error(`edge ${e}: not sorted (a < b)`)
	}

	// Edge list derived from hex rings equals the hand-authored EDGES.
	const derived = new Set<string>()
	for (const h of HEXES) {
		const vs = adjacentVertices[h]
		for (let i = 0; i < 6; i++) {
			const a = vs[i]
			const b = vs[(i + 1) % 6]
			const id = a < b ? `${a} - ${b}` : `${b} - ${a}`
			derived.add(id)
		}
	}
	if (derived.size !== edgeSet.size)
		throw new Error(
			`derived edges ${derived.size} !== authored ${edgeSet.size}`
		)
	for (const id of derived) {
		if (!edgeSet.has(id))
			throw new Error(`derived edge ${id} missing from EDGES`)
	}

	// Mutual adjacency: v in adjacentVertices[h] iff h in adjacentHexes[v].
	for (const h of HEXES) {
		for (const v of adjacentVertices[h]) {
			if (!adjacentHexes[v].includes(h))
				throw new Error(`mutual adj broken: ${h} <-> ${v}`)
		}
	}
	for (const v of VERTICES) {
		for (const h of adjacentHexes[v]) {
			if (!hexSet.has(h)) throw new Error(`unknown hex in ${v}: ${h}`)
			if (!adjacentVertices[h].includes(v))
				throw new Error(`mutual adj broken: ${v} <-> ${h}`)
		}
	}

	// neighborVertices is symmetric and every pair matches a real edge.
	for (const v of VERTICES) {
		for (const n of neighborVertices[v]) {
			if (!neighborVertices[n].includes(v))
				throw new Error(`neighbors not symmetric: ${v} <-> ${n}`)
			if (edgeBetween(v, n) === undefined)
				throw new Error(`no edge for neighbors ${v}, ${n}`)
		}
	}

	// adjacentEdges: each edge appears for both endpoints and nowhere else.
	for (const e of EDGES) {
		const [a, b] = e.split(' - ') as [Vertex, Vertex]
		if (!adjacentEdges[a].includes(e as Edge))
			throw new Error(`adjacentEdges[${a}] missing ${e}`)
		if (!adjacentEdges[b].includes(e as Edge))
			throw new Error(`adjacentEdges[${b}] missing ${e}`)
	}
	for (const v of VERTICES) {
		for (const e of adjacentEdges[v]) {
			const [a, b] = e.split(' - ')
			if (a !== v && b !== v)
				throw new Error(`adjacentEdges[${v}] has ${e} (not endpoint)`)
		}
	}
}

validateBoard()
console.log(
	`OK: ${HEXES.length} hexes, ${VERTICES.length} vertices, ${EDGES.length} edges.`
)
