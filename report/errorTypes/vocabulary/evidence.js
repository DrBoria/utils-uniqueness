"use strict";

// The READER's names for the matchers' evidence keys.
//
// The matchers emit numbers under machine-ish keys (`subtreeScore`,
// `returnRoleMatch`) because they are diagnostics, not prose. A person reading a
// finding needs the QUESTION the number answers, so the translation lives here
// with the rest of the wording — not in the decision engine, which only decides.
//
// A key that is missing here falls back to its own name, so a new matcher
// evidence field shows up (ugly but visible) instead of disappearing.

const EVIDENCE_LABELS = Object.freeze({
	subtreeScore: "shared subtrees",
	sequenceScore: "subtree order",
	sharedSubtrees: "subtrees in common",
	unionSubtrees: "subtrees in total",
	candidateSubtrees: "subtrees (local)",
	canonicalSubtrees: "subtrees (canonical)",
	cfgScore: "branch kinds",
	defUseScore: "define/use ratio",
	candidateFlow: "flow (local)",
	canonicalFlow: "flow (canonical)",
	exactKey: "exact parameter key",
	exactShape: "exact parameter shape",
	roleSeq: "parameter roles",
	returnRoleMatch: "same return kind",
	returnsSim: "returned values",
	nameSim: "name similarity",
	candidateKey: "params (local)",
	canonicalKey: "params (canonical)",
	matchType: "signature match",
	structScore: "constructs",
	sideEffectScore: "side effects",
	candidateSideEffects: "effects (local)",
	canonicalSideEffects: "effects (canonical)",
});

const labelOfEvidence = (key) => EVIDENCE_LABELS[key] ?? key;

module.exports = { EVIDENCE_LABELS, labelOfEvidence };
