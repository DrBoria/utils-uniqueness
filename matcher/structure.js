"use strict";

const { kindBag } = require("../normalize/tree.js");

// ---------------------------------------------------------------------------
// Group 2 — Structure + Side-effects.
// Two sub-signals:
//   structure  — Jaccard over the normalized kind-bag (how the body is built:
//                branches, loops, calls, assignments, literals…)
//   sideEffect — Jaccard over the side-effect fingerprint (io / mutate / throw
//                / await / random / global). A pure function and an IO function
//                are penalized even if their shapes match.
// ---------------------------------------------------------------------------

const bagJaccard = (a, b) => {
	// Two empty bags share no structure — that is "no evidence", not a
	// perfect match. Returning 1 here made every pair of trivial functions
	// score identically on this sub-signal.
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

const setJaccard = (a, b) => {
	if (a.size === 0 && b.size === 0) return 1;
	if (a.size === 0 || b.size === 0) return 0;
	const keys = new Set([...a, ...b]);
	let inter = 0;
	for (const k of keys) if (a.has(k) && b.has(k)) inter += 1;
	return inter / keys.size;
};

const matchStructure = (candidate, canon) => {
	const structScore = bagJaccard(kindBag(candidate.tree), kindBag(canon.tree));
	const seScore = setJaccard(new Set(candidate.sideEffectKeys), new Set(canon.sideEffectKeys));

	const score = 0.6 * structScore + 0.4 * seScore;

	return {
		score,
		evidence: {
			structScore: Math.round(structScore * 100) / 100,
			sideEffectScore: Math.round(seScore * 100) / 100,
			candidateSideEffects: candidate.sideEffectKeys,
			canonicalSideEffects: canon.sideEffectKeys,
		},
	};
};

module.exports = { matchStructure, bagJaccard };
