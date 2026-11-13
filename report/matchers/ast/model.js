"use strict";

// ── AST MATCHER · the model ─────────────────────────────────────────────────
//
// What group 3 compares: the PIECES the two bodies are built from. A piece is a
// BLOCK — a pair of subtrees with the same FORM at their root (`if:if`, `call:log`,
// `var:const`) — and inside a block the children are aligned in order. A body of 40
// statements where 12 are the same 12 statements has twelve shared pieces, not zero.
//
// One implementation feeds both the score and the page (`matcher/ast-blocks.js`), so
// a block the board draws a lane for is a block the score counted.
//
// The model ships each tree as nested arrays
// `[kind, label, block, children, start, end, syntax, column, columnEnd]`, where
// `block` is the index of the block the node belongs to (-1 = no block). That index
// is the whole picture: rows, lanes and ranges are all derived from it — never from
// comparing rows or from an exact-subtree hash.

const { matchBlocks, formOf, massOf } = require("../../../matcher/ast-blocks.js");
const { correspondence, GROUP_WEIGHT, saturate, percentOf } = require("../../../evidence.js");

const countNodes = (node) => {
	if (!node) return 0;

	return 1 + (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 0);
};

const serialize = (node, blockOf, matched) => {
	if (!node) return null;
	const kids = [];
	for (const child of node.children ?? []) {
		const out = serialize(child, blockOf, matched);
		if (out) kids.push(out);
	}

	// [ kind, label, block, children, startLine, endLine, syntaxName, column, columnEnd, matched ]
	// — `block` says which piece the node belongs to (-1 = container/none) and `matched`
	// says whether it was paired at all, so a block can underline its WHOLE matched
	// subtree and not only the construct at its root.
	return [node.kind, node.label ?? "", blockOf.get(node) ?? -1, kids, node.start ?? 0, node.end ?? 0, node.syntax ?? node.kind, node.column ?? null, node.columnEnd ?? null, matched.has(node) ? 1 : 0];
};

const build = (leftCandidate, rightCandidate) => {
	if (!leftCandidate || !rightCandidate) return null;
	const leftTree = leftCandidate.tree ?? null;
	const rightTree = rightCandidate.tree ?? null;
	const matched = matchBlocks(leftTree, rightTree);
	const floor = correspondence(1, 2);
	const serialized = (block) => ({
		index: block.index,
		kind: block.kind,
		label: block.label,
		form: block.form,
		// The share of the piece that corresponds — the same number its caption prints
		// and the same one the score multiplies by.
		share: Math.round(block.share * 100) / 100,
		percent: block.share >= 1 ? null : percentOf(block.share),
		weight: block.weight,
		confidence: Math.round(saturate(block.matched, GROUP_WEIGHT.ast) * 100) / 100,
	});

	return {
		left: serialize(leftTree, matched.leftBlock, matched.leftMatched),
		right: serialize(rightTree, matched.rightBlock, matched.rightMatched),
		// Only the blocks that actually correspond are pieces of the picture: below the
		// floor a block is not a correspondence, so it is neither counted nor printed with
		// a number.
		blocks: matched.blocks.filter((block) => block.share >= floor).map(serialized),
		// THE PIECES THAT WERE COMPARED AND DID NOT CORRESPOND. They are in no percentage —
		// a block under the floor is not a correspondence — but their rows are on the board
		// (the code exists, the tree exists), so they get a lane that says `differs` and no
		// number. Without it a tree row hangs with nothing said about it.
		unmatched: matched.blocks.filter((block) => block.share < floor).map(serialized),
		// The nodes both trees actually share — the number the verdict counts.
		sharedCount: matched.matched,
		leftCount: countNodes(leftTree),
		rightCount: countNodes(rightTree),
		leftMass: Math.round(massOf(leftTree) * 100) / 100,
		rightMass: Math.round(massOf(rightTree) * 100) / 100,
		score: matched.matched === 0 ? 0 : saturate(matched.matched, GROUP_WEIGHT.ast),
	};
};

module.exports = { build, formOf };
