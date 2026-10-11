"use strict";

const { pipe, map } = require("remeda");

// The kinds that form the control-flow sequence — the ordered skeleton of the
// body (branch / loop / return / throw / call / assign / await / yield).
const FLOW_KINDS = new Set(["if", "for", "for-of", "while", "do-while", "switch", "try", "catch", "cond", "return", "throw", "await", "yield", "call", "new", "assign", "var"]);

// ---------------------------------------------------------------------------
// Control-flow sequence: an ordered, name-independent trace of the structural
// skeleton of the body (branch / loop / return / throw / call / assign).
// Two functions whose control structures line up step-for-step score high even
// when the expressions inside differ.
// ---------------------------------------------------------------------------

const flowSequence = (tree, out = []) => {
	if (!tree) return out;
	if (FLOW_KINDS.has(tree.kind)) out.push(tree.kind);
	for (const c of tree.children || []) flowSequence(c, out);
	return out;
};

// ---------------------------------------------------------------------------
// Control-flow graph (CFG): basic-block-like nodes joined by edges.
// We build a lightweight CFG where each structural statement is a node and
// edges connect sequential statements plus branch targets. This is used for a
// structure-aware similarity (node set + edge shape) rather than exact path
// matching, which is robust to minor reordering.
// ---------------------------------------------------------------------------

const buildCfg = (tree) => {
	const nodes = [];
	const edges = [];
	let id = 0;

	const nextId = () => {
		id += 1;
		return `n${id}`;
	};

	const walk = (node, entry, exit) => {
		if (!node) return entry;
		const kids = node.children || [];

		if (node.kind === "block" || node.kind === "seq") {
			let prev = entry;
			for (const c of kids) prev = walk(c, prev, exit);
			return prev;
		}

		const nid = nextId();
		nodes.push({ id: nid, kind: node.kind, label: node.label });
		if (entry !== null) edges.push([entry, nid]);

		switch (node.kind) {
			case "if": {
				// cond → then ; cond → else (if present) ; both → exit
				const thenEnd = walk(kids[1] || null, nid, null);
				const elseEnd = kids[2] ? walk(kids[2], nid, null) : null;
				const tail = elseEnd ?? thenEnd;
				if (exit !== null) edges.push([tail, exit]);
				return tail;
			}
			case "for":
			case "for-of":
			case "while":
			case "do-while": {
				const bodyEnd = walk(kids[kids.length - 1] || null, nid, null);
				edges.push([bodyEnd, nid]); // back edge
				if (exit !== null) edges.push([bodyEnd, exit]);
				return bodyEnd;
			}
			case "return":
			case "throw": {
				if (exit !== null) edges.push([nid, exit]);
				return nid;
			}
			case "try": {
				const tryEnd = walk(kids[0] || null, nid, null);
				const catchEnd = kids[1] ? walk(kids[1], nid, null) : null;
				const tail = catchEnd ?? tryEnd;
				if (exit !== null) edges.push([tail, exit]);
				return tail;
			}
			default: {
				// leaf / expression statement
				if (exit !== null) edges.push([nid, exit]);
				return nid;
			}
		}
	};

	walk(tree, null, null);
	return { nodes, edges, count: nodes.length };
};

// ---------------------------------------------------------------------------
// Def-use summary: which identifiers are written (defs) vs read (uses),
// positionally renamed. Compared as a coarse data-flow shape: the *count* and
// *ratio* of defs vs uses, plus whether the function is a pure transformation
// (reads params, writes nothing outside, returns).
// ---------------------------------------------------------------------------

const defUseSummary = (tree) => {
	let defs = 0;
	let uses = 0;
	const walk = (node) => {
		if (!node) return;
		if (node.kind === "var-decl") defs += 1;
		if (node.kind === "assign") {
			defs += 1;
		}
		if (node.kind === "ident") uses += 1;
		for (const c of node.children || []) walk(c);
	};
	walk(tree);
	const total = defs + uses;
	return {
		defs,
		uses,
		ratio: total === 0 ? 0 : defs / total,
	};
};

// ---------------------------------------------------------------------------
// buildControlFlow(descriptor) → Groups 3-4 candidate fields
// ---------------------------------------------------------------------------

const buildControlFlow = (descriptor) => {
	const tree = descriptor.bodyTree;
	const seq = flowSequence(tree);
	const cfg = buildCfg(tree);
	const defUse = defUseSummary(tree);

	return {
		sequence: seq,
		cfg: {
			nodeCount: cfg.count,
			edgeCount: cfg.edges.length,
			kinds: pipe(
				cfg.nodes,
				map((n) => n.kind),
			),
		},
		defUse,
	};
};

module.exports = { buildControlFlow, flowSequence, buildCfg, defUseSummary };
