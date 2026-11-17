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

import { signatureOf } from "../normalize/subtree";
import { alignForms, alignWeighed, formOf, weightOf } from "./ast-align";

const walk = (node, at) => {
	if (!node) return;
	at(node);
	for (const kid of node.children ?? []) walk(kid, at);
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
 * What a reader calls a PIECE of a body: a declaration, a branch, a loop, a call, a
 * return. Leaves (`ident`, `lit`), glue (`block`, `seq`) and operator nodes are matched
 * and counted, but they are never a row: an `Identifier` is part of the piece it sits in,
 * not a piece of its own.
 */
// Statements AND expressions: a body that IS one expression (a template one-liner,
// a binary guard, a member chain) is a piece too — without these kinds an identical
// template produced no blocks at all and scored as if nothing matched. Leaves
// (`ident`, `lit`) and glue (`block`, `seq`) stay non-pieces: they are counted inside
// the piece they sit in, never a row of their own.
const PIECE_KINDS = new Set(["var", "var-destr", "if", "for", "for-of", "while", "do-while", "switch", "case", "try", "catch", "return", "throw", "await", "yield", "call", "new", "assign", "func", "jsx", "cond", "template", "bin", "member", "index", "unary", "unary-post", "prop", "object", "array"]);

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

	// A bodyless declaration (an overload signature, an ambient `declare`, a type-only
	// export) has no tree to compare. There is nothing to match, so the answer is the
	// empty correspondence — the same shape a real match returns, with no blocks. Both
	// the score (matchAst) and the report (ast/model) read this; neither may crash on it.
	if (!leftTree || !rightTree) {
		return { blocks, leftBlock, rightBlock, leftMatched, rightMatched, matched, matchedMass };
	}

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

	// The roots are pieces too. A body that IS one expression (`s.trim()…`) has its
	// whole copy at the root: aligning only the children left the outermost construct
	// outside every block, and a byte-identical body scored as a partial match. Same
	// forms at the root → one block that grows through the whole tree; different forms
	// → the children are aligned as before, so a statement-level copy still matches.
	if (formOf(leftTree) === formOf(rightTree)) {
		grow(leftTree, rightTree);
	} else {
		for (const [i, j] of alignWeighed(leftTree.children ?? [], rightTree.children ?? [])) {
			grow(leftTree.children[i], rightTree.children[j]);
		}
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

export { matchBlocks, massOf };
export { alignForms, alignWeighed, formOf, weightOf } from "./ast-align";
