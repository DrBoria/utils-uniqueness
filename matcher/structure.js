"use strict";

const { STRUCTURAL_KINDS } = require("../constants");
const { RELIABILITY, GROUP_WEIGHT, clamp01, saturate, combine, pieceEvidence } = require("../evidence");

// ---------------------------------------------------------------------------
// Group 2 — Structure.
//
// The question is HOW MANY, not "does it have": five calls against eight is a
// weaker match than five against five, and a body with one branch is not the
// shape of a body with three. Nothing here looks at the order (that is control
// flow), at the names, or at what the calls do.
//
// Counted per ROW: two calls written on one line are one structural block, the
// same block the page draws a lane for.
// ---------------------------------------------------------------------------

const countsOf = (tree, out = new Map(), seen = new Set()) => {
	if (!tree) return out;
	if (STRUCTURAL_KINDS.has(tree.kind) && tree.start != null) {
		const key = `${tree.kind}\u0000${tree.start}`;
		if (!seen.has(key)) {
			seen.add(key);
			out.set(tree.kind, (out.get(tree.kind) ?? 0) + 1);
		}
	}
	for (const child of tree.children ?? []) countsOf(child, out, seen);

	return out;
};

// `sum(min) / sum(max)`: the share of the larger side the smaller one covers.
const countAgreement = (left, right) => {
	let shared = 0;
	let total = 0;
	for (const kind of new Set([...left.keys(), ...right.keys()])) {
		shared += Math.min(left.get(kind) ?? 0, right.get(kind) ?? 0);
		total += Math.max(left.get(kind) ?? 0, right.get(kind) ?? 0);
	}

	return { shared, total, score: total === 0 ? 0 : shared / total };
};

const matchStructure = (candidate, canon, reliability = {}) => {
	const left = countsOf(candidate.tree);
	const right = countsOf(canon.tree);
	const effects = (list) => new Set((list ?? []).map((effect) => effect.key));
	const leftEffects = effects(candidate.sideEffects);
	const rightEffects = effects(canon.sideEffects);
	const effectKeys = new Set([...leftEffects, ...rightEffects]);
	const effectsShared = [...leftEffects].filter((key) => rightEffects.has(key)).length;

	// ── EVIDENCE PER KIND, WEIGHED BY HOW RARE THE KIND IS ──────────────────
	//
	// The question stays HOW MANY, but the answer is observations, not a share. Each
	// kind contributes `1 - (1 - w)^matched`: two `try/catch` blocks are a rarity and
	// prove a lot, two `var`s are in every body and prove almost nothing — so the
	// weight of a kind is its reliability scaled by how rarely it occurs HERE.
	const kinds = [...new Set([...left.keys(), ...right.keys()])].sort();
	const total = kinds.reduce((sum, kind) => sum + (left.get(kind) ?? 0) + (right.get(kind) ?? 0), 0);
	const counts = {};
	const pieces = [];
	let shared = 0;
	for (const kind of kinds) {
		const l = left.get(kind) ?? 0;
		const r = right.get(kind) ?? 0;
		counts[kind] = [l, r];
		const frequency = l + r;
		if (frequency === 0) continue;
		shared += Math.min(l, r);
		// `total / frequency` is how rare the kind is in this pair: a `var` occurs often
		// and scores low, a `try` occurs once and scores up to the 2.5× ceiling.
		const rarity = clamp01((total / frequency) / 4) * 2.5;
		const weight = clamp01((reliability[kind] ?? RELIABILITY[kind] ?? GROUP_WEIGHT.structure) * Math.max(0.5, rarity));
		// A kind counts with the SHARE of it that corresponds: five calls against thirteen is
		// 38% of a call, and below the floor it is not evidence at all.
		pieces.push(pieceEvidence(Math.min(l, r), Math.max(l, r), weight));
	}

	return {
		score: combine(pieces),
		evidence: {
			structShared: shared,
			structTotal: total,
			counts,
			// Side effects are stated, not scored: this group answers "same shape?".
			candidateSideEffects: [...leftEffects],
			canonicalSideEffects: [...rightEffects],
			effectsShared,
			effectsTotal: effectKeys.size,
		},
	};
};

module.exports = { matchStructure, countsOf, countAgreement };
