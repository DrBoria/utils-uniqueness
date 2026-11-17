"use strict";

import { matchSignature } from "./signature";
import { matchStructure } from "./structure";
import { matchAst } from "./ast";
import { matchControlFlow } from "./control-flow";

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
		sharedSideEffects: canon.sideEffects.filter((effect) => candidate.sideEffects.some((own) => own.key === effect.key)),
	};
};

const matchSignals = (candidate, canon, opts) => {
	const target = restrictTo(candidate, canon);
	// WHICH WEIGHT ONE MATCH IS WORTH is the engine's default (`RELIABILITY`), and the
	// owner can set any of them from the ESLint config: `weights.evidence: { type: 0.3 }`.
	// Passed down as an OVERRIDE MAP, so a matcher never reaches for configuration.
	const reliability = opts?.reliability ?? {};

	return {
		signature: matchSignature(candidate, target, reliability),
		structure: matchStructure(candidate, target, reliability),
		ast: matchAst(candidate, target, reliability),
		controlFlow: matchControlFlow(candidate, target, reliability),
	};
};

export {  matchSignals  };
