"use strict";

const { sequenceSimilarity } = require("../normalize/ast.js");

// ---------------------------------------------------------------------------
// Group 4 — Control-flow + Data-flow.
// Sub-signals:
//   sequence — Levenshtein ratio over the ordered control-flow token sequence
//   cfgShape — Jaccard over the CFG node-kind bag (branch/loop/return topology)
//   defUse   — closeness of the def/use ratio (pure vs mutating data flow)
// ---------------------------------------------------------------------------

const bagJaccard = (a, b) => {
	// Two empty CFGs (trivial single-return functions) share no control-flow
	// topology. Treat that as "no evidence" (0), not a perfect match (1),
	// otherwise every pair of one-liners scores 1.00 on this sub-signal.
	if (a.size === 0 && b.size === 0) return 0;
	const keys = new Set([...a.keys(), ...b.keys()]);
	let shared = 0;
	let union = 0;
	for (const k of keys) {
		const av = a.get(k) || 0;
		const bv = b.get(k) || 0;
		shared += Math.min(av, bv);
		union += Math.max(av, bv);
	}
	return union === 0 ? 0 : shared / union;
};

const kindBagOf = (kinds) => {
	const bag = new Map();
	for (const k of kinds) bag.set(k, (bag.get(k) || 0) + 1);
	return bag;
};

const ratioCloseness = (a, b) => 1 - Math.abs(a - b);

const matchControlFlow = (candidate, canon) => {
	const seqScore = sequenceSimilarity(candidate.controlFlow.sequence, canon.controlFlow.sequence);
	const cfgScore = bagJaccard(kindBagOf(candidate.controlFlow.cfg.kinds), kindBagOf(canon.controlFlow.cfg.kinds));
	const defUseScore = ratioCloseness(candidate.controlFlow.defUse.ratio, canon.controlFlow.defUse.ratio);

	const score = 0.5 * seqScore + 0.3 * cfgScore + 0.2 * defUseScore;

	return {
		score,
		evidence: {
			sequenceScore: Math.round(seqScore * 100) / 100,
			cfgScore: Math.round(cfgScore * 100) / 100,
			defUseScore: Math.round(defUseScore * 100) / 100,
			candidateFlow: candidate.controlFlow.sequence,
			canonicalFlow: canon.controlFlow.sequence,
		},
	};
};

module.exports = { matchControlFlow, bagJaccard };
