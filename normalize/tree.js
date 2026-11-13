"use strict";

const { pipe, map } = require("remeda");
const { STRUCTURAL_KINDS, DECLARING_KINDS, RENAMED_KINDS, SIDE_EFFECTS, STRUCTURE_BY_SIZE_NODES } = require("../constants");

// ── THE TREE, READ FOUR WAYS ───────────────────────────────────────────────
//
// The normalizer answers four questions about one body, and each answer is ONE
// value — not a pair of halves the caller has to glue together:
//
//   names(tree)        which names the body DECLARES, with lines and columns
//   kinds(tree)        how many nodes of each kind it contains
//   calls(tree)        which call targets it names
//   sideEffects(tree)  what it does to the outside world, with the description
//
// plus two derived answers:
//
//   nodes(tree)        how many nodes it has
//   structure(tree)    whether it has a shape worth comparing, and on what evidence

const nodeCount = (tree) => (tree ? 1 + (tree.children || []).reduce((sum, child) => sum + nodeCount(child), 0) : 0);

const kinds = (tree, bag = new Map()) => {
	if (!tree) return bag;
	bag.set(tree.kind, (bag.get(tree.kind) || 0) + 1);
	for (const child of tree.children || []) kinds(child, bag);

	return bag;
};

const calls = (tree, bag = new Map()) => {
	if (!tree) return bag;
	if (tree.kind === "call" || tree.kind === "new") bag.set(String(tree.label), (bag.get(String(tree.label)) || 0) + 1);
	for (const child of tree.children || []) calls(child, bag);

	return bag;
};

const callTargets = (tree) => [...calls(tree).keys()];

// A body has "structure" when it contains a branch, a loop, or an interaction
// with the outside world — or when it is simply big enough that its shape is not
// a coincidence. The answer carries its evidence, so a reader can see WHY.
const structure = (tree) => {
	const bag = kinds(tree);
	const found = [...STRUCTURAL_KINDS].filter((kind) => bag.has(kind));

	return {
		present: found.length > 0 || nodeCount(tree) >= STRUCTURE_BY_SIZE_NODES,
		kinds: found,
		nodes: nodeCount(tree),
	};
};

// ---------------------------------------------------------------------------
// Side effects: what the body does to the outside world. Purely structural —
// no callee or receiver names are consulted — so there is nothing to keep in
// sync with the codebase. The list of effects and their wording is vocabulary
// (`constants.js → SIDE_EFFECTS`); this only decides which of them occur.
// ---------------------------------------------------------------------------

const sideEffects = (tree, flags) => {
	const found = new Set();
	const visit = (node) => {
		if (!node) return;
		for (const effect of SIDE_EFFECTS) if (effect.kinds.includes(node.kind)) found.add(effect.key);
		for (const child of node.children || []) visit(child);
	};
	visit(tree);
	// An async body is an await boundary even when it never writes `await`.
	if (flags && flags.async) found.add("await");

	return SIDE_EFFECTS.filter((effect) => found.has(effect.key));
};

// ---------------------------------------------------------------------------
// Tree normalization: rename local identifiers to positional placeholders so
// `a + b` and `x + y` compare equal, while preserving call targets and
// structure.
// ---------------------------------------------------------------------------

const normalizeTree = (tree) => {
	if (!tree) return null;
	const { kind, label, children } = tree;

	// Local names are positionally renamed; call targets and member property
	// names are kept (they carry meaning).
	const outLabel = RENAMED_KINDS.has(kind) ? "v" : label;

	return {
		kind,
		label: outLabel,
		children: pipe(children || [], map((child) => normalizeTree(child))),
		start: tree.start,
		end: tree.end,
		// The 1-based column the node starts at, and — for a binding pattern — where it
		// ends. A position is data the parser produced once, and every layer after it
		// reads that one value instead of looking a word up in the text again.
		column: tree.column,
		columnEnd: tree.columnEnd,
		// The name a declaration binds, when the kind binds one: a `var` and a `var-destr`
		// are compared by what they introduce, not only by where they sit.
		name: tree.name,
		// The declaration KEYWORD (`const` / `let` / `var`), when the kind has one: the
		// three are different facts for control flow, so the step carries it.
		keyword: tree.keyword,
		// Where a MULTI-LINE construct closes (`const {` … `} = x`): the closing brace is
		// part of the mark, and it lives on another row.
		endLine: tree.endLine,
		// How many arguments a call passes — the number the counter column shows.
		arity: tree.arity,
		// The syntax name travels with the node: the page prints `VariableDeclaration`
		// instead of the short `var-decl`.
		syntax: tree.syntax ?? kind,
	};
};

// ---------------------------------------------------------------------------
// Names. The tree is normalized with every local identifier replaced by `v`, so
// the SHAPE of `a + b` and `x + y` is the same — but the names themselves are a
// duplicate signal in their own right: a copy keeps `result`, `content`, `text`.
//
// Only names that are INTRODUCED count (`DECLARING_KINDS`). A reference is not a
// name: `result` in `{ text: result }` is a VALUE, and a string literal is a
// value too. Each site carries its line and column, because a name belongs to
// the place that declares it, not to every place that mentions it.
// ---------------------------------------------------------------------------

// A syntax kind that a reader does not name separately: `direction,` is written as a
// shorthand, but what it IS is a property assignment — the same category as
// `direction: value`, and one lane, not two captions for one fact.
const CATEGORY_OF_SYNTAX = Object.freeze({
	ShorthandPropertyAssignment: "PropertyAssignment",
});

// The READER'S words for a declaration, from the syntax name the parser already
// carried: `PropertyAssignment` → `property assignments`. The same words the
// declaration half writes, so a property inside a body and a property inside a head
// are ONE category — `prop` next to `property assignments` named the same thing twice.
const wordsOf = (syntax) => {
	const name = CATEGORY_OF_SYNTAX[syntax] ?? syntax;
	const text = String(name ?? "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().trim();
	if (text === "") return null;

	return text.endsWith("s") ? text : `${text}s`;
};

const names = (tree, out = []) => {
	if (!tree) return out;
	const label = typeof tree.label === "string" ? tree.label.trim() : "";
	if (label && DECLARING_KINDS.has(tree.kind)) {
		out.push({ name: label, kind: tree.kind, label: wordsOf(tree.syntax) ?? tree.kind, line: tree.start ?? null, column: tree.column ?? null });
	}
	for (const child of tree.children || []) names(child, out);

	return out;
};

// Which LINES of a body carry nodes of a kind: the raw material for a board that
// connects rows instead of only scoring them. `kinds` narrows it (control flow
// passes its own vocabulary); null means every kind.
const linesByKind = (tree, kinds = null, out = new Map()) => {
	if (!tree) return out;
	const line = tree.start;
	if (typeof line === "number" && line > 0 && (kinds === null || kinds.has(tree.kind))) {
		const lines = out.get(tree.kind) ?? new Set();
		lines.add(line);
		out.set(tree.kind, lines);
	}

	for (const child of tree.children || []) linesByKind(child, kinds, out);

	return out;
};

// The same walk, keeping BOTH coordinates the parser already knows: the line a
// node starts on and the 1-based column it starts at. A reader needs the column
// to see WHERE on the line a construct is written — looking the word up in the
// text would be a second, weaker answer to a question the tree already answered.
const sitesByKind = (tree, kinds = null, out = new Map()) => {
	if (!tree) return out;
	const line = tree.start;
	const column = tree.column;
	if (typeof line === "number" && line > 0 && (kinds === null || kinds.has(tree.kind))) {
		// A DECLARATION is addressed by its keyword: `const`, `let` and `var` are three
		// different constructs, so their lanes are three different lanes.
		const key = typeof tree.keyword === "string" ? `${tree.kind}:${tree.keyword}` : tree.kind;
		const sites = out.get(key) ?? [];
		sites.push({
			line,
			column: typeof column === "number" ? column : null,
			columnEnd: typeof tree.columnEnd === "number" ? tree.columnEnd : null,
			endLine: typeof tree.endLine === "number" ? tree.endLine : null,
			arity: typeof tree.arity === "number" ? tree.arity : null,
			name: tree.name ?? null,
			keyword: tree.keyword ?? null,
		});
		out.set(key, sites);
	}

	for (const child of tree.children || []) sitesByKind(child, kinds, out);

	return out;
};

module.exports = { normalizeTree, names, kinds, calls, callTargets, sideEffects, nodes: nodeCount, structure, linesByKind, sitesByKind };
