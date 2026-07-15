// Runtime sanity checks on the hex/vertex/edge data for BOTH board variants
// (standard 19-hex, expanded 30-hex). Run with `npx tsx dev/check-catan-board.ts`.
//
// Catches typos in adjacentVertices / EDGES / coastal / port data. Prints OK
// and exits 0 on success; throws with a specific error on the first mismatch.

import {
	BOARDS,
	RESOURCES,
	edgeBetween,
	edgeEndpoints,
	type Board,
	type Edge,
	type Hex,
	type Vertex,
} from '../lib/catan/board'
import type { Variant } from '../lib/catan/types'

type Expected = {
	hexes: number
	vertices: number
	edges: number
	coastal: number
	ports: number
	resourceHexes: number
	deserts: number
}

const EXPECTED: Record<Variant, Expected> = {
	standard: {
		hexes: 19,
		vertices: 54,
		edges: 72,
		coastal: 30,
		ports: 9,
		resourceHexes: 18,
		deserts: 1,
	},
	expanded: {
		hexes: 30,
		vertices: 80,
		edges: 109,
		coastal: 38,
		ports: 11,
		resourceHexes: 28,
		deserts: 2,
	},
}

function validateBoard(variant: Variant, board: Board): void {
	const exp = EXPECTED[variant]
	const label = `[${variant}]`
	const {
		hexes,
		vertices,
		edges,
		adjacentVertices,
		adjacentHexes,
		neighborVertices,
		adjacentEdges,
		coastalEdges,
		portSlots,
		resourceCounts,
		numbers,
		portKinds,
	} = board

	if (hexes.length !== exp.hexes)
		throw new Error(`${label} HEXES: ${hexes.length} !== ${exp.hexes}`)
	if (vertices.length !== exp.vertices)
		throw new Error(
			`${label} VERTICES: ${vertices.length} !== ${exp.vertices}`
		)
	if (edges.length !== exp.edges)
		throw new Error(`${label} EDGES: ${edges.length} !== ${exp.edges}`)

	const vertexSet = new Set<Vertex>(vertices)
	const hexSet = new Set<Hex>(hexes)
	const edgeSet = new Set<string>(edges)

	// hexRows covers every hex exactly once.
	const rowHexes = board.hexRows.flat()
	if (rowHexes.length !== hexes.length)
		throw new Error(
			`${label} hexRows count ${rowHexes.length} !== ${hexes.length}`
		)
	for (const h of rowHexes)
		if (!hexSet.has(h))
			throw new Error(`${label} hexRows has unknown hex ${h}`)

	// Every adjacentVertices value is a valid vertex; each hex has 6 unique ones.
	for (const h of hexes) {
		const vs = adjacentVertices[h]
		if (vs.length !== 6)
			throw new Error(
				`${label} ${h}: expected 6 vertices, got ${vs.length}`
			)
		const seen = new Set<Vertex>()
		for (const v of vs) {
			if (!vertexSet.has(v))
				throw new Error(`${label} ${h}: unknown vertex ${v}`)
			if (seen.has(v))
				throw new Error(`${label} ${h}: duplicate vertex ${v}`)
			seen.add(v)
		}
	}

	// Every edge parses into two known vertices, sorted lexically.
	for (const e of edges) {
		const parts = e.split(' - ')
		if (parts.length !== 2) throw new Error(`${label} malformed edge: ${e}`)
		const [a, b] = parts
		if (!vertexSet.has(a)) throw new Error(`${label} edge ${e}: bad a`)
		if (!vertexSet.has(b)) throw new Error(`${label} edge ${e}: bad b`)
		if (a >= b) throw new Error(`${label} edge ${e}: not sorted (a < b)`)
	}

	// Edge list derived from hex rings equals the authored edges.
	const derived = new Set<string>()
	for (const h of hexes) {
		const vs = adjacentVertices[h]
		for (let i = 0; i < 6; i++) {
			const a = vs[i]
			const b = vs[(i + 1) % 6]
			derived.add(a < b ? `${a} - ${b}` : `${b} - ${a}`)
		}
	}
	if (derived.size !== edgeSet.size)
		throw new Error(
			`${label} derived edges ${derived.size} !== authored ${edgeSet.size}`
		)
	for (const id of derived)
		if (!edgeSet.has(id))
			throw new Error(`${label} derived edge ${id} missing from EDGES`)

	// Mutual adjacency: v in adjacentVertices[h] iff h in adjacentHexes[v].
	for (const h of hexes)
		for (const v of adjacentVertices[h])
			if (!adjacentHexes[v].includes(h))
				throw new Error(`${label} mutual adj broken: ${h} <-> ${v}`)
	for (const v of vertices)
		for (const h of adjacentHexes[v]) {
			if (!hexSet.has(h))
				throw new Error(`${label} unknown hex in ${v}: ${h}`)
			if (!adjacentVertices[h].includes(v))
				throw new Error(`${label} mutual adj broken: ${v} <-> ${h}`)
		}

	// neighborVertices is symmetric and every pair matches a real edge.
	for (const v of vertices)
		for (const n of neighborVertices[v]) {
			if (!neighborVertices[n].includes(v))
				throw new Error(
					`${label} neighbors not symmetric: ${v} <-> ${n}`
				)
			if (edgeBetween(v, n, edges) === undefined)
				throw new Error(`${label} no edge for neighbors ${v}, ${n}`)
		}

	// adjacentEdges: each edge appears for both endpoints and nowhere else.
	for (const e of edges) {
		const [a, b] = edgeEndpoints(e)
		if (!adjacentEdges[a].includes(e as Edge))
			throw new Error(`${label} adjacentEdges[${a}] missing ${e}`)
		if (!adjacentEdges[b].includes(e as Edge))
			throw new Error(`${label} adjacentEdges[${b}] missing ${e}`)
	}
	for (const v of vertices)
		for (const e of adjacentEdges[v]) {
			const [a, b] = edgeEndpoints(e)
			if (a !== v && b !== v)
				throw new Error(
					`${label} adjacentEdges[${v}] has ${e} (not endpoint)`
				)
		}

	// Coastal edges: each borders exactly one hex, and they form a single
	// closed ring (every boundary vertex touches exactly 2 coastal edges).
	if (coastalEdges.length !== exp.coastal)
		throw new Error(
			`${label} coastal ${coastalEdges.length} !== ${exp.coastal}`
		)
	const hexCountByEdge = new Map<string, number>()
	for (const h of hexes) {
		const vs = adjacentVertices[h]
		for (let i = 0; i < 6; i++) {
			const a = vs[i]
			const b = vs[(i + 1) % 6]
			const id = a < b ? `${a} - ${b}` : `${b} - ${a}`
			hexCountByEdge.set(id, (hexCountByEdge.get(id) ?? 0) + 1)
		}
	}
	const coastalVertexDegree = new Map<string, number>()
	for (const e of coastalEdges) {
		if (!edgeSet.has(e))
			throw new Error(`${label} coastal edge ${e} not a real edge`)
		if (hexCountByEdge.get(e) !== 1)
			throw new Error(
				`${label} coastal edge ${e} borders ${hexCountByEdge.get(e)} hexes`
			)
		const [a, b] = edgeEndpoints(e)
		coastalVertexDegree.set(a, (coastalVertexDegree.get(a) ?? 0) + 1)
		coastalVertexDegree.set(b, (coastalVertexDegree.get(b) ?? 0) + 1)
	}
	for (const [v, deg] of coastalVertexDegree)
		if (deg !== 2)
			throw new Error(
				`${label} coastal ring: vertex ${v} has degree ${deg}`
			)

	// Port slots: correct count, all coastal, no two sharing a vertex.
	if (portSlots.length !== exp.ports)
		throw new Error(
			`${label} portSlots ${portSlots.length} !== ${exp.ports}`
		)
	const coastalSet = new Set<string>(coastalEdges)
	const portVertices = new Set<string>()
	for (const e of portSlots) {
		if (!coastalSet.has(e))
			throw new Error(`${label} port slot ${e} not coastal`)
		const [a, b] = edgeEndpoints(e)
		if (portVertices.has(a) || portVertices.has(b))
			throw new Error(
				`${label} port slot ${e} shares a vertex with another`
			)
		portVertices.add(a)
		portVertices.add(b)
	}
	if (portKinds.length !== exp.ports)
		throw new Error(
			`${label} portKinds ${portKinds.length} !== ${exp.ports}`
		)

	// Resource + number counts fill the non-desert hexes exactly.
	const resourceHexes = RESOURCES.reduce((n, r) => n + resourceCounts[r], 0)
	if (resourceHexes !== exp.resourceHexes)
		throw new Error(
			`${label} resource hexes ${resourceHexes} !== ${exp.resourceHexes}`
		)
	if (hexes.length - resourceHexes !== exp.deserts)
		throw new Error(
			`${label} deserts ${hexes.length - resourceHexes} !== ${exp.deserts}`
		)
	if (numbers.length !== exp.resourceHexes)
		throw new Error(
			`${label} numbers ${numbers.length} !== ${exp.resourceHexes}`
		)
}

for (const variant of Object.keys(BOARDS) as Variant[]) {
	const b = BOARDS[variant]
	validateBoard(variant, b)
	console.log(
		`OK [${variant}]: ${b.hexes.length} hexes, ${b.vertices.length} vertices, ${b.edges.length} edges, ${b.coastalEdges.length} coastal, ${b.portSlots.length} ports.`
	)
}
