"use strict";

const { matchSignature } = require("./signature");
const { matchStructure } = require("./structure");
const { matchAst } = require("./ast");
const { matchControlFlow } = require("./control-flow");

// For a partial candidate (a block inside a function body), restrict the
// canonical side to the comparable sub-signals so the part is not penalized
// for the canonical function's surrounding scaffolding.
const restrictTo = (candidate, canon) => {
	if (!candidate.partial) return canon;
	const calls = new Set(candidate.calls || []);
	const sharedCalls = (canon.calls || []).filter((c) => calls.has(c));

	return {
		...canon,
		calls: sharedCalls,
		sideEffectKeys: canon.sideEffectKeys.filter((k) => candidate.sideEffectKeys.includes(k)),
	};
};

const matchSignals = (candidate, canon) => {
	const target = restrictTo(candidate, canon);

	return {
		signature: matchSignature(candidate, target),
		structure: matchStructure(candidate, target),
		ast: matchAst(candidate, target),
		controlFlow: matchControlFlow(candidate, target),
	};
};

module.exports = { matchSignals };
