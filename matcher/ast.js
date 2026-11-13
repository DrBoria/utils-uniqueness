"use strict";

const { matchBlocks, massOf } = require("./ast-blocks.js");
const { GROUP_WEIGHT, RELIABILITY, saturate, combine, pieceEvidence } = require("../evidence.js");

// ── THE AST GROUP ──────────────────────────────────────────────────────────
//
// What is compared: the PIECES the two bodies are built from — `if`, `call:log`,
// `var:const`, `return` — matched by FORM, in order, statement by statement. Not
// "the whole body is one tree": a body of 40 statements where 12 are the same 12
// statements is a body with 12 shared pieces, and that is what this group says.
//
// One rule, one implementation: `matchBlocks` also feeds the report, so a block the
// page draws a lane for is a block the score counted.
const matchAst = (candidate, canon, reliability = {}) => {
	const matched = matchBlocks(candidate.tree, canon.tree);
	const leftMass = massOf(candidate.tree);
	const rightMass = massOf(canon.tree);
	const total = Math.max(leftMass, rightMass);
	// HOW MUCH OF THE BODY the blocks cover, in weight — not a count of leaves.
	const coverage = total === 0 ? 0 : matched.matchedMass / total;

	const byKind = {};
	for (const block of matched.blocks) {
		const entry = byKind[block.kind] ?? { left: 0, right: 0, shared: 0, confidence: 0 };
		entry.left += 1;
		entry.right += 1;
		entry.shared += 1;
		byKind[block.kind] = entry;
	}
	for (const entry of Object.values(byKind)) {
		entry.confidence = Math.round(saturate(entry.shared, GROUP_WEIGHT.ast) * 100) / 100;
	}

	// Each BLOCK counts with the share of it that corresponds: a block that matched 2 of
	// its 6 nodes is a partial piece, and below the floor it is not a piece at all.
	const pieces = matched.blocks.map((block) => pieceEvidence(block.matched, Math.max(block.size.left, block.size.right), GROUP_WEIGHT.ast));

	// Evidence of the matched pieces themselves, combined with the share of the body
	// they cover: one shared `if` in a 40-statement body is not a copy, twelve of them
	// is a different answer.
	const score = combine([...pieces, coverage * (reliability.subtree ?? RELIABILITY.subtree)]);

	return {
		score,
		evidence: {
			byKind,
			blocks: matched.blocks.length,
			matchedNodes: matched.matched,
			candidateMass: Math.round(leftMass * 100) / 100,
			canonicalMass: Math.round(rightMass * 100) / 100,
			coverage: Math.round(coverage * 100) / 100,
		},
	};
};

module.exports = { matchAst };
