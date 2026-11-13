"use strict";

// ── MATCHERS · the one registry ─────────────────────────────────────────────
//
// The four comparison groups are no longer four blobs in one file: each lives in
// its own folder with its own MODEL, its own CLI TEXT and its own GRAPH.
//
//   matchers/signature/      { model.js, text.js, phrases.js, graph.jsx }
//   matchers/structure/
//   matchers/control-flow/
//   matchers/ast/
//
// This registry binds them by the SIGNAL key the engine uses, so the page, the
// markdown report and the decision can never disagree about which group is which.
//
// `graph.jsx` is ESM and is deliberately NOT required here: this file runs in
// Node (the report is generated before the page exists), while the graph is
// bundled for the browser through `src/components/matchers/index.js`.

const { SIGNAL, SIGNAL_ORDER } = require("../../constants");

const signature = { key: SIGNAL.Signature, model: require("./signature/model"), text: require("./signature/text") };
const structure = { key: SIGNAL.Structure, model: require("./structure/model"), text: require("./structure/text") };
const controlFlow = { key: SIGNAL.ControlFlow, model: require("./control-flow/model"), text: require("./control-flow/text") };
const ast = { key: SIGNAL.Ast, model: require("./ast/model"), text: require("./ast/text") };

const BY_KEY = new Map([
	[signature.key, signature],
	[structure.key, structure],
	[controlFlow.key, controlFlow],
	[ast.key, ast],
]);

// In the order the report reads the groups.
const MATCHERS = SIGNAL_ORDER.map((key) => BY_KEY.get(key)).filter(Boolean);

// Every graphic for one pair, keyed by SIGNAL: `{ signature: model, … }`.
const analyze = (leftCandidate, rightCandidate) => {
	const out = {};
	for (const matcher of MATCHERS) out[matcher.key] = matcher.model.build(leftCandidate, rightCandidate);

	return out;
};

// The text lines for one pair, in the same order — used by the CLI report.
const describe = (leftCandidate, rightCandidate) => {
	const out = [];
	for (const matcher of MATCHERS) {
		const model = matcher.model.build(leftCandidate, rightCandidate);
		if (!model) continue;
		const lines = matcher.text.text(model);
		if (lines.length > 0) out.push({ key: matcher.key, lines });
	}

	return out;
};

module.exports = { MATCHERS, matcherOf: (key) => BY_KEY.get(key) ?? null, analyze, describe };
