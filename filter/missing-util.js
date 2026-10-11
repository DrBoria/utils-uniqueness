"use strict";

const { pascalWords } = require("../normalize/words.js");
const { matchStructure } = require("../matcher/structure.js");
const { matchAst } = require("../matcher/ast.js");

const DEFAULT_MIN_CLUSTER = 3;
// Two functions are "mutually similar" (and thus evidence of a missing shared
// util) only when the composite of structure AND AST is high. Structure alone
// is too coarse — a `.map` vs a `.reduce` both produce a call+literal+ref bag
// and score ~0.9 — so without the AST term, dozens of unrelated functions get
// dumped into one bogus cluster. AST (subtree multiset + sequence) is what
// actually tells a map from a reduce, so it is weighted equally.
//
// The floor is deliberately high (0.9): a missing-util cluster is a family of
// near-identical copies (renamed params, ~1.0), not a bag of same-shape
// functions. A lower floor (0.6) let distinct operations that merely share a
// pattern skeleton cluster together — e.g. the real run's "SharedR" merged a
// FHIR reference builder, a seed-id builder, and the Snowflake F/E/R
// table-name builders, whose cross-operation pair similarity ran 0.47-0.86
// because for template one-liners the AST sequence sub-score saturates.
const MIN_PAIR_FLOOR = 0.9;
const CANON_CONF_FLOOR = 0.4;

// Composite of the two body-shape signals. Both candidates carry a normalized
// tree + ast (they are full candidates), so this is cheap to compute pairwise.
const pairSimilarity = (a, b) => {
	const struct = a.tree && b.tree ? matchStructure(a, b).score : 0;
	const ast = a.ast && b.ast ? matchAst(a, b).score : 0;
	return 0.5 * struct + 0.5 * ast;
};

const pascalCase = (words) => words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");

const suggestName = (appNames, canonName = null) => {
	if (canonName) {
		const counts = new Map();
		const order = [];
		for (const name of appNames) {
			for (const w of pascalWords(name)) {
				const k = w.toLowerCase();
				if (!counts.has(k)) {
					counts.set(k, 0);
					order.push(k);
				}
				counts.set(k, counts.get(k) + 1);
			}
		}
		const common = order.filter((k) => counts.get(k) >= Math.ceil(appNames.length * 0.6));
		const meaningful = common;
		if (meaningful.length > 0) return pascalCase([meaningful[0], ...pascalWords(canonName).slice(0, 2)]);
		return `Shared${canonName}`;
	}
	return "SharedUtil";
};

const pairwiseAllAbove = (apps, floor) => {
	for (let i = 0; i < apps.length; i += 1)
		for (let j = i + 1; j < apps.length; j += 1) if (pairSimilarity(apps[i], apps[j]) < floor) return false;
	return true;
};

// A cluster is only meaningful if the canonical it is anchored to actually
// resembles the members. When a group of app functions merely *coincidentally*
// matched a trivial canonical (e.g. a deprecated throw-stub like `date() {
// throw ... }`), the mutual similarity of the app fns is real but the
// "shared canonical" evidence is vacuous — and naming the cluster after the
// stub ("Shareddate") is misleading. Require the canonical to be similar to the
// members so such coincidental anchors are rejected.
const canonResemblesMembers = (canon, apps, floor) => {
	for (const app of apps) {
		if (!canon.tree || !app.tree) return false;
		if (pairSimilarity(canon, app) < floor) return false;
	}
	return true;
};

const resolveClusterMembers = (group) => {
	const strong = group.filter((m) => m.decision.confidence >= CANON_CONF_FLOOR);
	const apps = [...new Map(strong.map((m) => [m.app.name, m.app])).values()];
	if (apps.length >= 2 && pairwiseAllAbove(apps, MIN_PAIR_FLOOR) && canonResemblesMembers(strong[0].canon, apps, MIN_PAIR_FLOOR)) {
		return strong;
	}
	const dups = strong.filter((m) => m.decision.tier === "duplicate");
	const dupApps = [...new Map(dups.map((m) => [m.app.name, m.app])).values()];
	if (dups.length >= 2 && pairwiseAllAbove(dupApps, MIN_PAIR_FLOOR) && canonResemblesMembers(dups[0].canon, dupApps, MIN_PAIR_FLOOR)) {
		return dups;
	}
	return null;
};

// Groups app functions that all point at the same canonical and are mutually
// similar — a signal that a shared util is missing and the logic is copy-pasted.
const findMissingUtils = (matches, { minCluster = DEFAULT_MIN_CLUSTER } = {}) => {
	// A "missing util" means the shared logic has NO canonical yet. A match
	// already in the duplicate tier is a copy of an *existing* canonical — the
	// util is not missing, and consuming that match into a cluster would make
	// the genuine duplicate vanish from the report. Cluster only similar-tier
	// matches; duplicates stay in `remaining`.
	const clusterable = matches.filter((m) => m.decision.tier !== "duplicate");
	const byCanon = new Map();
	for (const match of clusterable) {
		const key = match.canon.name;
		if (!byCanon.has(key)) byCanon.set(key, []);
		byCanon.get(key).push(match);
	}
	const clusters = [];
	for (const [canonName, group] of byCanon) {
		const members = resolveClusterMembers(group);
		if (!members) continue;
		if (new Set(members.map((m) => m.app.name)).size < minCluster) continue;
		const appNames = [...new Set(members.map((m) => m.app.name))];
		clusters.push({
			name: suggestName(appNames, canonName),
			canon: { name: canonName, path: members[0].canon.path },
			matches: members,
		});
	}
	// Only matches absorbed into an *accepted* cluster leave the flat list.
	// A rejected (below-minCluster) group's members must stay visible, or a
	// genuine duplicate would silently vanish from the report.
	const absorbed = new Set(clusters.flatMap((c) => c.matches));
	const remaining = matches.filter((m) => !absorbed.has(m));
	return { clusters, remaining };
};

module.exports = { findMissingUtils, pairSimilarity };
