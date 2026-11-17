"use strict";

import { buildSignature } from "./signature.js";
import * as tree_ from "./tree.js";
import { buildControlFlow } from "./control-flow.js";
import { buildAst } from "./ast.js";

// One site per (name, line, column): the declaration half comes from the raw
// descriptor and the body half from the tree, and the two overlap by design —
// a `const` in the body is in both. A name written once must not be counted
// twice, or the name bag stops describing the code.
const uniqueSites = (sites) => {
	const seen = new Set();
	return sites.filter((site) => {
		const key = `${site.name}\u0000${site.line}\u0000${site.column}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
};

// ---------------------------------------------------------------------------
// buildCandidate(descriptor, config)
//
// A descriptor is the raw, framework-neutral function record produced by
// playgrounds/typescript.js. The candidate is the fully-normalized form that
// all four matcher groups consume. Comparison only happens on candidates,
// i.e. after normalization and unrolling — never on raw source.
// ---------------------------------------------------------------------------

const buildCandidate = (descriptor, config) => {
	const body = descriptor.bodyTree;

	return {
		...descriptor,
		partial: !!descriptor.partial,
		// The four normalized views the matchers read.
		signature: buildSignature(descriptor),
		tree: tree_.normalizeTree(body),
		controlFlow: buildControlFlow(descriptor),
		ast: buildAst(descriptor),
		// The structural answers — one value each, never a pair of halves:
		//   names        every name the function DECLARES, with line and column
		//                (its own name, its parameters, its body's declarations)
		//   sideEffects  what it does to the world, with the sentence per effect
		//   calls        the call targets it names
		//   nodes        how big it is
		//   structure    whether the shape is worth comparing, and on what evidence
		names: uniqueSites([...(descriptor.declaredSites ?? []), ...tree_.names(body)]),
		sideEffects: tree_.sideEffects(body, descriptor.flags),
		calls: tree_.callTargets(body),
		nodes: tree_.nodes(body),
		structure: tree_.structure(body),
	};
};

// A "part" candidate (a contiguous block inside a function body) is treated as
// a partial duplicate — the matchers restrict the canonical side to the part.
const buildPartCandidate = (part, config) => buildCandidate({ ...part, partial: true }, config);

export {  buildCandidate, buildPartCandidate  };
