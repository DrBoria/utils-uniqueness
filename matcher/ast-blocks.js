"use strict";

// ── AST MATCHER · BLOCKS, NOT LEAVES ───────────────────────────────────────
//
// The question this group answers is "which PIECES of the two trees are the same
// piece", not "is the whole body one tree". A body is a sequence of statements, and
// a statement that exists on both sides is a piece — even when something inside it
// differs.
//
// So the unit is a BLOCK: a pair of subtrees that have the same FORM at their root
// (the same kind and the same label — `if:if`, `call:log`, `var:const`). Inside a
// block the children are aligned in order, and every matched child extends the
// SAME block. A sibling that does not match ends the block and starts nothing.
//
// Identical results are not required and not thrown away: a block that covers 5 of
// its 9 nodes is worth 5 matched nodes, not zero. Longer blocks and rarer kinds are
// worth more (`FLOW_RARITY`), so two `try` blocks outrank five `call`s.

const { flowRarity } = require("../constants");
const { signatureOf } = require("../normalize/subtree");

/** What makes two nodes the same CONSTRUCT. A declaration carries its KEYWORD (`var:const`), because `const` and `let` are different constructs; a declarator name is erased. */
const formOf = (node) => `${node.kind}:${node.keyword ?? node.label ?? ""}`;

const walk = (node, at) => {
	if (!node) return;
	at(node);
	for (const kid of node.children ?? []) walk(kid, at);
};

const weightOf = (node) => flowRarity(node.kind);

// The forms of a subtree in pre-order, cached per node: the sequence two pieces are
// compared by.
const formListOf = (node, cache = new Map()) => {
	const known = cache.get(node);
	if (known !== undefined) return known;
	const out = [];
	walk(node, (child) => out.push(formOf(child)));
	cache.set(node, out);

	return out;
};

/**
 * How much two pieces are the SAME piece, not merely the same KIND: the Dice
 * coefficient over their form sequences. Two `call:toLowerCase` nodes with different
 * receivers are the same kind and only partly the same piece; the identical one scores
 * 1 and must win the pairing.
 */
const similarityOf = (left, right, cache) => {
	const a = formListOf(left, cache);
	const b = formListOf(right, cache);
	if (a.length === 0 || b.length === 0) return 0;
	const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
	for (let i = 1; i <= a.length; i += 1) {
		for (let j = 1; j <= b.length; j += 1) {
			table[i][j] = a[i - 1] === b[j - 1] ? table[i - 1][j - 1] + 1 : Math.max(table[i - 1][j], table[i][j - 1]);
		}
	}

	return (2 * table[a.length][b.length]) / (a.length + b.length);
};

/** How many nodes a subtree has: the denominator of a block's correspondence. */
const countNodes = (node) => (node ? 1 + (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 0) : 0);

/** The mass of a subtree: how much its nodes weigh together. */
const massOf = (node) => {
	let mass = 0;
	walk(node, (child) => {
		mass += weightOf(child);
	});

	return mass;
};

/**
 * Which children correspond: the longest run of the same FORMS in order. One extra
 * statement on one side shifts nothing below it, and a statement the other side does
 * not have is simply not part of any block.
 */
const alignForms = (left, right) => {
	const rows = left.length + 1;
	const cols = right.length + 1;
	const forms = { left: left.map(formOf), right: right.map(formOf) };
	const value = Array.from({ length: rows }, () => new Array(cols).fill(0));

	for (let i = 1; i < rows; i += 1) {
		for (let j = 1; j < cols; j += 1) {
			value[i][j] =
				forms.left[i - 1] === forms.right[j - 1]
					? value[i - 1][j - 1] + 1
					: Math.max(value[i - 1][j], value[i][j - 1]);
		}
	}

	const pairs = [];
	let i = left.length;
	let j = right.length;
	while (i > 0 && j > 0) {
		if (forms.left[i - 1] === forms.right[j - 1]) {
			pairs.push([i - 1, j - 1]);
			i -= 1;
			j -= 1;
			continue;
		}
		if (value[i - 1][j] >= value[i][j - 1]) i -= 1;
		else j -= 1;
	}

	return pairs.reverse();
};

/**
 * The same pairing, but every matched node WEIGHS: among equally long alignments the
 * heavier one wins. A run over `try`/`if` is worth more than a run over `call`s, so
 * the alignment prefers the pieces that prove a copy.
 */
const alignWeighed = (left, right) => {
	const rows = left.length + 1;
	const cols = right.length + 1;
	const forms = { left: left.map(formOf), right: right.map(formOf) };
	// A pair is worth its rarity TIMES how much the two pieces actually share. Without
	// the second factor the alignment took the first same-form candidate in order, so an
	// identical `toLowerCase` was paired with a different receiver's one and scored 33%.
	const formCache = new Map();
	const worth = (i, j) => weightOf(left[i]) * similarityOf(left[i], right[j], formCache);
	const value = Array.from({ length: rows }, () => new Array(cols).fill(0));

	for (let i = 1; i < rows; i += 1) {
		for (let j = 1; j < cols; j += 1) {
			value[i][j] =
				forms.left[i - 1] === forms.right[j - 1]
					? value[i - 1][j - 1] + worth(i - 1, j - 1)
					: Math.max(value[i - 1][j], value[i][j - 1]);
		}
	}

	const pairs = [];
	let i = left.length;
	let j = right.length;
	while (i > 0 && j > 0) {
		if (forms.left[i - 1] === forms.right[j - 1]) {
			pairs.push([i - 1, j - 1]);
			i -= 1;
			j -= 1;
			continue;
		}
		if (value[i - 1][j] >= value[i][j - 1]) i -= 1;
		else j -= 1;
	}

	return pairs.reverse();
};

/**
 * What a reader calls a PIECE of a body: a declaration, a branch, a loop, a call, a
 * return. Leaves (`ident`, `lit`), glue (`block`, `seq`) and operator nodes are matched
 * and counted, but they are never a row: an `Identifier` is part of the piece it sits in,
 * not a piece of its own.
 */
const PIECE_KINDS = new Set(["var", "var-destr", "if", "for", "for-of", "while", "do-while", "switch", "case", "try", "catch", "return", "throw", "await", "yield", "call", "new", "assign", "func", "jsx", "cond"]);

const isPiece = (node) => PIECE_KINDS.has(node.kind);

const matchBlocks = (leftTree, rightTree) => {
	const leftBlock = new Map();
	const rightBlock = new Map();
	// WHICH nodes were matched at all: a block's ranges are its whole matched subtree,
	// not only the construct at its root, and containers (`block`) are matched too even
	// though they are not blocks of their own.
	const leftMatched = new Set();
	const rightMatched = new Set();
	const blocks = [];
	let matched = 0;
	let matchedMass = 0;

	// A pre-order signature per node, computed once: the price of the identical-subtree
	// pass is otherwise paid for every level of the recursion.
	const signatures = new Map();
	const signatureOfCached = (node) => {
		const known = signatures.get(node);
		if (known !== undefined) return known;
		const signature = signatureOf(node);
		signatures.set(node, signature);

		return signature;
	};

	// The first node under these roots that is not matched yet and whose subtree is
	// exactly this one. Searched THROUGH wrappers, because that is the whole point.
	const findUnmatched = (roots, matchedSet, signature) => {
		for (const root of roots) {
			let found = null;
			walk(root, (node) => {
				if (found === null && !matchedSet.has(node) && signatureOfCached(node) === signature) found = node;
			});
			if (found !== null) return found;
		}

		return null;
	};

	// How many nodes (and how much weight) a matched pair covers, itself included.
	const grow = (left, right) => {		matched += 1;
		matchedMass += weightOf(left);
		leftMatched.add(left);
		rightMatched.add(right);
		let block = null;
		if (isPiece(left)) {
			block = {
				index: blocks.length,
				kind: left.kind,
				label: left.label ?? "",
				form: formOf(left),
				left,
				right,
				matched: 1,
				mass: weightOf(left),
				size: { left: countNodes(left), right: countNodes(right) },
			};
			blocks.push(block);
		}
		leftBlock.set(left, block === null ? -1 : block.index);
		rightBlock.set(right, block === null ? -1 : block.index);

		let count = 1;
		let mass = weightOf(left);
		const leftKids = left.children ?? [];
		const rightKids = right.children ?? [];
		const paired = alignWeighed(leftKids, rightKids);
		for (const [i, j] of paired) {
			const inside = grow(leftKids[i], rightKids[j]);
			count += inside.count;
			mass += inside.mass;
		}
		// THE SAME PIECE, ONE WRAPPER DEEPER. An ordered alignment compares forms at the
		// same level, so a copy the other side wrapped in `||` (or in one more call) was
		// invisible — its nodes were never even candidates. Whatever is left over is looked
		// for by SUBTREE SIGNATURE through the wrapper, and an exact copy is a piece in full:
		// nothing is guessed, only identical subtrees are paired.
		for (const kid of leftKids) {
			if (leftMatched.has(kid)) continue;
			const node = findUnmatched(rightKids, rightMatched, signatureOfCached(kid));
			if (node === null) continue;
			const inside = grow(kid, node);
			count += inside.count;
			mass += inside.mass;
		}
		for (const kid of rightKids) {
			if (rightMatched.has(kid)) continue;
			const node = findUnmatched(leftKids, leftMatched, signatureOfCached(kid));
			if (node === null) continue;
			const inside = grow(node, kid);
			count += inside.count;
			mass += inside.mass;
		}
		if (block !== null) {
			block.matched = count;
			block.mass = mass;
		}

		return { count, mass };
	};

	for (const [i, j] of alignWeighed(leftTree.children ?? [], rightTree.children ?? [])) {
		grow(leftTree.children[i], rightTree.children[j]);
	}

	return {
		blocks: blocks.map((block) => {
			const total = Math.max(block.size.left, block.size.right);

			return { ...block, weight: Math.round(block.mass * 100) / 100, share: total === 0 ? 0 : block.matched / total };
		}),
		leftBlock,
		rightBlock,
		leftMatched,
		rightMatched,
		matched,
		matchedMass,
	};
};

module.exports = { matchBlocks, alignForms, alignWeighed, formOf, massOf, weightOf };
