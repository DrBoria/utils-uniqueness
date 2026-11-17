"use strict";

import { pipe, map } from "remeda";

// The kinds that form the control-flow sequence — the ordered skeleton of the
// body (branch / loop / return / throw / call / assign / await / yield). The list
// is vocabulary: see ../constants section 5c.
import { FLOW_KINDS } from "../constants";

// ---------------------------------------------------------------------------
// Control-flow sequence: an ordered, name-independent trace of the structural
// skeleton of the body (branch / loop / return / throw / call / assign).
// Two functions whose control structures line up step-for-step score high even
// when the expressions inside differ.
// ---------------------------------------------------------------------------

// The skeleton keeps its CONTEXT: a call inside `try` is not the call outside it.
// Each step is written `try>if/call` — the enclosing flow blocks, then the block
// itself — so two steps are the same step only in the same place of the shape.
// A DECLARATION carries its KEYWORD: `const x` and `let x` are different steps,
// and the shape says so instead of calling both `var`.
const stepKindOf = (tree) => (typeof tree.keyword === "string" ? `${tree.kind}:${tree.keyword}` : tree.kind);

const flowSteps = (tree, stack = [], out = [], depth = 0) => {
	if (!tree) return out;
	// A NESTED function is a different flow: its `return` is not this body's return, and a
	// call inside a callback is not a step of the body that merely passes the callback.
	// The skeleton is the order of THIS body, so an inner function is not walked at all.
	if (tree.kind === "func" && depth > 0) return out;
	const isFlow = FLOW_KINDS.has(tree.kind);
	const kind = stepKindOf(tree);
	if (isFlow) out.push({ kind, path: stack.join(">"), line: tree.start ?? null, column: tree.column ?? null, columnEnd: tree.columnEnd ?? null, endLine: tree.endLine ?? null });
	const isScope = tree.kind === "func";
	const next = isFlow ? [...stack, kind] : isScope ? [...stack, "fn"] : stack;
	for (const child of tree.children ?? []) flowSteps(child, next, out, depth + 1);

	return out;
};

const flowSequence = (tree) => flowSteps(tree).map((step) => `${step.path}/${step.kind}`);

// The same walk, keeping WHERE each step is written. Same order, same lengths as
// `flowSequence`: the n-th token and the n-th site are the same step, so the text
// can name the line a step sits on without re-parsing anything.
const flowSites = (tree) => flowSteps(tree);

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
		sequenceSites: flowSites(tree),
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

export {  buildControlFlow, flowSteps, flowSequence, flowSites, buildCfg, defUseSummary  };
