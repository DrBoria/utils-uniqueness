"use strict";

const { multisetJaccard, sequenceSimilarity } = require("../normalize/ast.js");

// ---------------------------------------------------------------------------
// Group 3 — AST structure.
// Two sub-signals over the normalized (name-renamed, inlined) tree:
//   subtree  — Jaccard over the multiset of subtree hashes (shared structure)
//   sequence — normalized Levenshtein ratio over the pre-order kind sequence
// ---------------------------------------------------------------------------

const matchAst = (candidate, canon) => {
	const { score, shared, union } = multisetJaccard(candidate.ast.subtreeHashes, canon.ast.subtreeHashes);
	const seqScore = sequenceSimilarity(candidate.ast.sequence, canon.ast.sequence);

	const scoreFinal = 0.55 * score + 0.45 * seqScore;

	return {
		score: scoreFinal,
		evidence: {
			subtreeScore: Math.round(score * 100) / 100,
			sequenceScore: Math.round(seqScore * 100) / 100,
			sharedSubtrees: shared,
			unionSubtrees: union,
			candidateSubtrees: candidate.ast.subtreeCount,
			canonicalSubtrees: canon.ast.subtreeCount,
		},
	};
};

module.exports = { matchAst };
