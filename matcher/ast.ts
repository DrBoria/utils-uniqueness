"use strict";

import { matchBlocks, massOf } from "./ast-blocks.js";
import { signatureOf } from "../normalize/subtree.js";
import { GROUP_WEIGHT, RELIABILITY, saturate, combine, pieceEvidence } from "../evidence.js";

// Leaves and glue inside an otherwise matched block: `return iso` vs `return raw`,
// a different literal, a different property. They are not pieces of their own, but
// each aligned pair whose FULL subtree signature differs is counter-evidence — a
// block whose leaves disagree is not the same piece, however well its skeleton
// aligns. (The identical-subtree pass pairs same-FORM leaves like `ident:v` even
// when the names differ, so the check compares signatures, not matched-ness.)
//
// A LITERAL-ONLY difference is a parameterization, not a different operation:
// `new Client("A")` vs `new Client("B")` is the same code with a different argument
// (the factory pattern a shared util absorbs). It counts as half a mismatch, while
// an identifier/structure difference (`raw` vs `iso`, a different property) counts
// in full — those say the operations differ.
const NON_PIECE = new Set(["ident", "lit", "expr", "block", "seq"]);

const leafMismatches = (blocks) => {
	let mismatches = 0;
	for (const block of blocks) {
		const stack = [[block.left, block.right]];
		while (stack.length > 0) {
			const [l, r] = stack.pop();
			const lk = l.children ?? [];
			const rk = r.children ?? [];
			for (let i = 0; i < Math.max(lk.length, rk.length); i += 1) {
				const a = lk[i];
				const b = rk[i];
				if (!a || !b) continue;
				if (NON_PIECE.has(a.kind) && NON_PIECE.has(b.kind)) {
					if (signatureOf(a) !== signatureOf(b)) mismatches += (a.kind === "lit" && b.kind === "lit") ? 0.5 : 1;
					continue;
				}
				stack.push([a, b]);
			}
		}
	}

	return mismatches;
};

// ── THE AST GROUP ──────────────────────────────────────────────────────────
//
// What is compared: the PIECES the two bodies are built from — `if`, `call:log`,
// `var:const`, `return` — matched by FORM, in order, statement by statement. Not
// "the whole body is one tree": a body of 40 statements where 12 are the same 12
// statements is a body with 12 shared pieces, and that is what this group says.
//
// One rule, one implementation: `matchBlocks` also feeds the report, so a block the
// page draws a lane for is a block the score counted.
const matchAst = (candidate, canon, reliability: any = {}) => {
	const matched = matchBlocks(candidate.tree, canon.tree);
	const leftMass = massOf(candidate.tree);
	const rightMass = massOf(canon.tree);
	const total = Math.max(leftMass, rightMass);
	// HOW MUCH OF THE BODY the blocks cover, in weight — not a count of leaves.
	const coverage = total === 0 ? 0 : matched.matchedMass / total;

	const byKind: any = {};
	for (const block of matched.blocks) {
		const entry = byKind[block.kind] ?? { left: 0, right: 0, shared: 0, confidence: 0 };
		entry.left += 1;
		entry.right += 1;
		entry.shared += 1;
		byKind[block.kind] = entry;
	}
	for (const entry of Object.values(byKind) as any[]) {
		entry.confidence = Math.round(saturate(entry.shared, GROUP_WEIGHT.ast) * 100) / 100;
	}

	// Each BLOCK counts with the share of it that corresponds: a block that matched 2 of
	// its 6 nodes is a partial piece, and below the floor it is not a piece at all.
	const pieces = matched.blocks.map((block) => pieceEvidence(block.matched, Math.max(block.size.left, block.size.right), GROUP_WEIGHT.ast));

	// Counter-evidence: differing leaves inside matched blocks multiply the evidence
	// down. `Day.fromISO(raw)` vs `Day.fromISO(iso).formatDay` aligns skeleton-wise,
	// but the leaves that disagree say the operations are not the same.
	const mismatches = leafMismatches(matched.blocks);
	const leafPenalty = Math.pow(0.5, mismatches);

	// Evidence of the matched pieces themselves, combined with the share of the body
	// they cover: one shared `if` in a 40-statement body is not a copy, twelve of them
	// is a different answer.
	const score = combine([...pieces, coverage * (reliability.subtree ?? RELIABILITY.subtree)]) * leafPenalty;

	return {
		score,
		evidence: {
			byKind,
			blocks: matched.blocks.length,
			matchedNodes: matched.matched,
			candidateMass: Math.round(leftMass * 100) / 100,
			canonicalMass: Math.round(rightMass * 100) / 100,
			coverage: Math.round(coverage * 100) / 100,
			leafMismatches: mismatches,
		},
	};
};

export {  matchAst  };
