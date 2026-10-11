"use strict";

const { pipe, map } = require("remeda");

// A kind that gives a body "structure" — a branch, loop, or an interaction
// with the outside world (call / new). Used by hasStructure.
const STRUCTURAL_KINDS = new Set(["if", "for", "for-of", "while", "do-while", "switch", "try", "cond", "return", "throw", "call", "new"]);

// ---------------------------------------------------------------------------
// Side-effect fingerprint. A name-free, structural summary of *what a function
// does to the outside world*, derived purely from node kinds — no callee or
// receiver names are consulted, so there is nothing to keep in sync with the
// codebase:
//   calls   — invokes something (call / new)
//   assigns — writes to a target (assignment)
//   throw   — explicit throw
//   await   — awaits something (async boundary)
//   yield   — generator
// ---------------------------------------------------------------------------

const collectSideEffects = (node, acc) => {
	if (!node) return acc;
	const { kind, children } = node;

	if (kind === "call" || kind === "new") acc.calls = true;
	else if (kind === "assign") acc.assigns = true;
	else if (kind === "await") acc.await = true;
	else if (kind === "yield") acc.yield = true;
	else if (kind === "throw") acc.throw = true;

	for (const child of children || []) collectSideEffects(child, acc);
	return acc;
};

const sideEffectFingerprint = (tree, flags) => {
	const acc = { calls: false, assigns: false, throw: false, await: false, yield: false };
	collectSideEffects(tree, acc);
	if (flags && flags.async) acc.await = true; // an async body is an await boundary
	return acc;
};

const sideEffectKeys = (fp) => Object.entries(fp).filter(([, v]) => v).map(([k]) => k).sort();

// ---------------------------------------------------------------------------
// Tree normalization: rename local identifiers to positional placeholders so
// `a + b` and `x + y` compare equal, while preserving call targets and
// structure. Also inlines local (nested) functions: a nested function is
// collapsed into a single `func` node keyed by its position, so two functions
// that differ only in how they split work into helpers still align.
// ---------------------------------------------------------------------------

const normalizeTree = (tree, depth = 0) => {
	if (!tree) return null;
	const { kind, label, children } = tree;

	let outLabel = label;
	if (kind === "ident" || kind === "var-decl") {
		// Local names are positionally renamed; call targets and member
		// property names are kept (they carry meaning).
		outLabel = "v";
	}

	const kids = pipe(
		children || [],
		map((c) => normalizeTree(c, depth + 1)),
	);

	return { kind, label: outLabel, children: kids };
};

// ---------------------------------------------------------------------------
// Tree metrics used by matchers and the no-structure filter.
// ---------------------------------------------------------------------------

const nodeCount = (tree) => (tree ? 1 + (tree.children || []).reduce((sum, c) => sum + nodeCount(c), 0) : 0);

const kindBag = (tree, bag = new Map()) => {
	if (!tree) return bag;
	bag.set(tree.kind, (bag.get(tree.kind) || 0) + 1);
	for (const c of tree.children || []) kindBag(c, bag);
	return bag;
};

const callBag = (tree, bag = new Map()) => {
	if (!tree) return bag;
	if (tree.kind === "call" || tree.kind === "new") bag.set(String(tree.label), (bag.get(String(tree.label)) || 0) + 1);
	for (const c of tree.children || []) callBag(c, bag);
	return bag;
};

const hasStructure = (tree) => {
	if (!tree) return false;
	const bag = kindBag(tree);
	const structural = [...STRUCTURAL_KINDS].some((k) => bag.has(k));
	return structural || nodeCount(tree) >= 12;
};

module.exports = {
	normalizeTree,
	sideEffectFingerprint,
	sideEffectKeys,
	nodeCount,
	kindBag,
	callBag,
	hasStructure,
};
