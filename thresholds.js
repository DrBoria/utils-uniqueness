"use strict";

/**
 * thresholds.js
 *
 * Tunable matching thresholds for the duplicate-utility detection. Three
 * tiers, strongest first:
 *
 *   1. SIGNATURE  — same parameter types AND same return type (normalized).
 *                   The function is a drop-in for the other.
 *   2. BODY       — same (or near-same) normalized body, different signature.
 *                   Same logic, different interface.
 *   3. JSCPD      — raw token/AST clone pairs from jscpd, unfiltered.
 *
 * A finding is reported only when its tier clears the relevant threshold.
 */

const DEFAULTS = {
	// Minimum normalized-body token count for a function to be considered at
	// all. Below this, a function is too trivial to be a meaningful dup.
	minBodyTokens: 8,

	// Tier 1: signature match. Two functions are signature-duplicates when
	// their normalized param-type list and return type are identical.
	signatureExact: true,

	// Tier 1 structural gate: a signature cluster is only meaningful when the
	// shared signature "carries information". A `() -> void` shape (zero
	// params, void return) is shared by every entry point (`main`), every
	// render callback, etc. — it is not a real duplicate. Require at least
	// this many params OR a non-void return type for a tier-1 finding.
	signatureMinParams: 1,

	// Tier 2: body match. Normalized bodies must share at least this fraction
	// of tokens (Jaccard over the token multisets).
	bodyMinRatio: 0.6,

	// Tier 2 structural gate: a body-duplicate finding is only reported when
	// at least one of the two functions "carries information" in its signature
	// — at least this many params OR a non-void-like return. Two zero-param,
	// void-returning functions (every `main`, every fire-and-forget callback)
	// can share a near-identical body without being a real utility duplicate.
	bodyMinParams: 1,

	// Tier 3: jscpd raw clones. jscpd reports token-level clones (name-
	// agnostic). Each clone is then classified into one of two sub-tiers:
	//   whole    — the clone covers most of BOTH functions -> they are the
	//              same function (a renamed copy).
	//   fragment — a substantial, content-specific chunk inside two larger
	//              functions -> a partial duplicate (shared error handler,
	//              mapper, paging loop) worth extracting.
	// minTokens / minLines / mode / similarity are passed to the jscpd CLI.
	// timeoutMs is a hard wall-clock cap so a large scan can never hang.
	jscpd: {
		enabled: false,
		mode: "strict",
		minTokens: 35,
		minLines: 4,
		similarity: 0.7,
		timeoutMs: 120000,
		whole: {
			// The clone's line span must cover at least this fraction of EACH
			// function's line span. Kills "5 tokens inside a 200-token fn".
			minCoverage: 0.5,
			// The shared chunk must still be content-specific (identifiers /
			// literals), not just shared boilerplate (useQuery/useMutation
			// scaffolding, if/return/else). Kills boilerplate mega-clusters.
			minDistinctiveRatio: 0.35,
		},
		fragment: {
			// A partial duplicate must be substantial (minTokens/minLines) AND
			// content-specific: at least this fraction of the clone's tokens
			// must be identifiers/numbers/strings, not just if/return/else.
			minTokens: 35,
			minLines: 4,
			minDistinctiveRatio: 0.35,
		},
	},

	// A function with zero exported usages outside its own file is still
	// reported (it is the canonical candidate); one that is already imported
	// from the canonical folder is not.
	requireExported: false,
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Resolve the thresholds from rule options.
 *
 * @param {object} [opts] the first rule option (may be undefined)
 * @returns {object} resolved thresholds
 */
function resolveThresholds(opts) {
	const o = opts && typeof opts === "object" ? opts : {};
	const t = o.thresholds && typeof o.thresholds === "object" ? o.thresholds : {};
	const num = (key) => (typeof t[key] === "number" && Number.isFinite(t[key]) ? t[key] : DEFAULTS[key]);
	const bool = (key) => (typeof t[key] === "boolean" ? t[key] : DEFAULTS[key]);

	const j = t.jscpd && typeof t.jscpd === "object" ? t.jscpd : {};
	const jnum = (key, dflt) => (typeof j[key] === "number" && Number.isFinite(j[key]) ? j[key] : dflt);
	const jbool = (key, dflt) => (typeof j[key] === "boolean" ? j[key] : dflt);
	const jstr = (key, dflt) => (typeof j[key] === "string" && j[key] ? j[key] : dflt);
	const whole = j.whole && typeof j.whole === "object" ? j.whole : {};
	const frag = j.fragment && typeof j.fragment === "object" ? j.fragment : {};
	const fnum = (key, dflt) => (typeof frag[key] === "number" && Number.isFinite(frag[key]) ? frag[key] : dflt);

	return {
		minBodyTokens: Math.max(1, Math.floor(num("minBodyTokens"))),
		signatureExact: bool("signatureExact"),
		signatureMinParams: Math.max(0, Math.floor(num("signatureMinParams"))),
		bodyMinRatio: clamp01(num("bodyMinRatio")),
		bodyMinParams: Math.max(0, Math.floor(num("bodyMinParams"))),
		requireExported: bool("requireExported"),
		jscpd: {
			enabled: jbool("enabled", DEFAULTS.jscpd.enabled),
			mode: jstr("mode", DEFAULTS.jscpd.mode),
			minTokens: Math.max(1, Math.floor(jnum("minTokens", DEFAULTS.jscpd.minTokens))),
			minLines: Math.max(0, Math.floor(jnum("minLines", DEFAULTS.jscpd.minLines))),
			similarity: clamp01(jnum("similarity", DEFAULTS.jscpd.similarity)),
			timeoutMs: Math.max(1000, Math.floor(jnum("timeoutMs", DEFAULTS.jscpd.timeoutMs))),
			whole: {
				minCoverage: clamp01(typeof whole.minCoverage === "number" ? whole.minCoverage : DEFAULTS.jscpd.whole.minCoverage),
				minDistinctiveRatio: clamp01(typeof whole.minDistinctiveRatio === "number" ? whole.minDistinctiveRatio : DEFAULTS.jscpd.whole.minDistinctiveRatio),
			},
			fragment: {
				minTokens: Math.max(1, Math.floor(fnum("minTokens", DEFAULTS.jscpd.fragment.minTokens))),
				minLines: Math.max(0, Math.floor(fnum("minLines", DEFAULTS.jscpd.fragment.minLines))),
				minDistinctiveRatio: clamp01(typeof frag.minDistinctiveRatio === "number" ? frag.minDistinctiveRatio : DEFAULTS.jscpd.fragment.minDistinctiveRatio),
			},
		},
	};
}

/** Strict profile used for canonical-vs-canonical matching in the scanner. */
const CANON_DUP_STRICT = {
	minBodyTokens: 8,
	signatureExact: true,
	signatureMinParams: 1,
	bodyMinRatio: 0.8,
	bodyMinParams: 1,
	requireExported: false,
	jscpd: {
		enabled: false,
		mode: "strict",
		minTokens: 40,
		minLines: 5,
		similarity: 0.85,
		timeoutMs: 120000,
		whole: { minCoverage: 0.6, minDistinctiveRatio: 0.4 },
		fragment: { minTokens: 40, minLines: 5, minDistinctiveRatio: 0.4 },
	},
};

module.exports = { resolveThresholds, DEFAULT_THRESHOLDS: DEFAULTS, CANON_DUP_STRICT };
