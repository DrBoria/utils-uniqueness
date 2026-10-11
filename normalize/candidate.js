"use strict";

const { buildSignature } = require("./signature.js");
const { normalizeTree, sideEffectFingerprint, sideEffectKeys, nodeCount, hasStructure, callBag } = require("./tree.js");
const { buildControlFlow } = require("./control-flow.js");
const { buildAst } = require("./ast.js");

// ---------------------------------------------------------------------------
// buildCandidate(descriptor, config)
//
// A descriptor is the raw, framework-neutral function record produced by
// playgrounds/typescript.js. The candidate is the fully-normalized form that
// all four matcher groups consume. Comparison only happens on candidates,
// i.e. after normalization and unrolling — never on raw source.
// ---------------------------------------------------------------------------

const buildCandidate = (descriptor, config) => {
	const signature = buildSignature(descriptor);
	const tree = normalizeTree(descriptor.bodyTree);
	const sideEffects = sideEffectFingerprint(descriptor.bodyTree, descriptor.flags);
	const controlFlow = buildControlFlow(descriptor);
	const ast = buildAst(descriptor);
	const calls = [...callBag(descriptor.bodyTree).keys()];

	return {
		...descriptor,
		partial: !!descriptor.partial,
		signature,
		tree,
		sideEffects,
		sideEffectKeys: sideEffectKeys(sideEffects),
		controlFlow,
		ast,
		calls,
		nodeCount: nodeCount(descriptor.bodyTree),
		hasStructure: hasStructure(descriptor.bodyTree),
	};
};

// A "part" candidate (a contiguous block inside a function body) is treated as
// a partial duplicate — the matchers restrict the canonical side to the part.
const buildPartCandidate = (part, config) => buildCandidate({ ...part, partial: true }, config);

module.exports = { buildCandidate, buildPartCandidate };
