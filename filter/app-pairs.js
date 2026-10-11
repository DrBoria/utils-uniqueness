"use strict";

const { pascalWords } = require("../normalize/words.js");

// The app↔app mode surfaces functions that are near-identical copies of *each
// other*, with no canonical anchor — the cross-file duplication the canonical
// scan (app → canon) cannot see. Ground truth from the real run:
//   toReviewedAsOf (allergy.rm.ts)  ≈  toReviewedAsOf (review.rm.ts)
//   openChart (meds.e2e.ts)         ≈  openChart (problems.e2e.ts)
//
// A "worth moving to utils" group is a set of app functions that are ALL
// near-identical to each other. We require the group to be a clique: every
// member must sit above the confidence floor with every other member. A chain
// (A~B~C but A⊥C) is not a set of mutual copies and is rejected — this is the
// same mutual-similarity discipline missing-util.js applies, but with no
// canonical to anchor on.

const DEFAULT_PAIR_FLOOR = 0.6;
const MIN_APP_CLUSTER = 2;

// A "copy" is a stronger claim than a "similar" match. Two functions are a
// mutual copy only when their bodies share near-identical subtree structure
// (high AST score) AND both take at least one parameter. The AST gate drops
// coarse-shape matches — a one-liner looks "similar" to hundreds of unrelated
// helpers (toReviewedAsOf scored 0.7–0.93 against 107 of them, ast 0.5–0.73,
// while its true twin scored ast 1.0). The params gate drops the 0-param
// factory pattern — one per resource (`() => new Client<T>("T")`) — which is a
// repeated *pattern*, not a copy worth extracting (48 of them clustered at
// conf 1.0). Both gates are necessary: AST alone still surfaces the factory
// cluster, and params alone still surfaces the coarse-shape noise.
const AST_COPY_FLOOR = 0.9;
const MIN_COPY_PARAMS = 1;

// The policy applies to *measured* pairs (the real matcher always emits
// signals). Confidence-only pairs — used to unit-test the clique/floor
// machinery in isolation — have no measurement, so the policy passes them
// through untouched.
const isCopyCandidate = (m) => {
	const signals = m.decision && m.decision.signals;
	if (!signals) return true;
	if ((signals.ast ? signals.ast.score : 0) < AST_COPY_FLOOR) return false;
	const appParams = (m.app && m.app.params) || [];
	const peerParams = (m.peer && m.peer.params) || [];
	return appParams.length >= MIN_COPY_PARAMS && peerParams.length >= MIN_COPY_PARAMS;
};

const keyOf = (c) => `${c.path}#${c.name}`;
const edgeKey = (a, b) => [a, b].sort().join("::");

const suggestName = (members) => {
	const counts = new Map();
	const order = [];
	for (const m of members) {
		for (const w of pascalWords(m.name)) {
			const k = w.toLowerCase();
			if (!counts.has(k)) {
				counts.set(k, 0);
				order.push(k);
			}
			counts.set(k, counts.get(k) + 1);
		}
	}
	const common = order.filter((k) => counts.get(k) >= Math.ceil(members.length * 0.6));
	if (common.length > 0) return common[0].charAt(0).toUpperCase() + common[0].slice(1);
	return "SharedUtil";
};

const clusterAppPairs = (matches, { pairFloor = DEFAULT_PAIR_FLOOR, minCluster = MIN_APP_CLUSTER } = {}) => {
	const valid = matches.filter((m) => m && m.app && m.peer && m.decision);

	const adjacency = new Map(); // key -> Map(peerKey -> true)
	const conf = new Map(); // edgeKey -> best confidence
	const candByKey = new Map(); // key -> candidate
	for (const m of valid) {
		candByKey.set(keyOf(m.app), m.app);
		candByKey.set(keyOf(m.peer), m.peer);
		const c = m.decision.confidence;
		if (c < pairFloor) continue;
		if (!isCopyCandidate(m)) continue;
		const ka = keyOf(m.app);
		const kb = keyOf(m.peer);
		if (ka === kb) continue;
		if (!adjacency.has(ka)) adjacency.set(ka, new Map());
		if (!adjacency.has(kb)) adjacency.set(kb, new Map());
		adjacency.get(ka).set(kb, true);
		adjacency.get(kb).set(ka, true);
		const ek = edgeKey(ka, kb);
		const prev = conf.get(ek);
		if (prev === undefined || c > prev) conf.set(ek, c);
	}

	const seen = new Set();
	const clusters = [];
	for (const startKey of adjacency.keys()) {
		if (seen.has(startKey)) continue;
		const component = [];
		const queue = [startKey];
		seen.add(startKey);
		while (queue.length > 0) {
			const k = queue.shift();
			component.push(k);
			for (const pk of adjacency.get(k).keys()) {
				if (!seen.has(pk)) {
					seen.add(pk);
					queue.push(pk);
				}
			}
		}
		if (component.length < minCluster) continue;

		// Clique check: every pair in the component must be an edge above the
		// floor. The group's confidence is the weakest link (min edge).
		let isClique = true;
		let minConf = 1;
		for (let i = 0; i < component.length && isClique; i++) {
			for (let j = i + 1; j < component.length; j++) {
				const c = conf.get(edgeKey(component[i], component[j]));
				if (c === undefined) {
					isClique = false;
					break;
				}
				if (c < minConf) minConf = c;
			}
		}
		if (!isClique) continue;

		const members = component.map((k) => candByKey.get(k));
		clusters.push({ name: suggestName(members), members, confidence: minConf });
	}
	return clusters;
};

module.exports = { clusterAppPairs, DEFAULT_PAIR_FLOOR, MIN_APP_CLUSTER, AST_COPY_FLOOR, MIN_COPY_PARAMS, isCopyCandidate };
