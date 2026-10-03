"use strict";

const DEFAULTS = {
	minBodyTokens: 8,
	signatureExact: true,
	signatureMinParams: 1,
	bodyMinRatio: 0.6,
	bodyMinParams: 1,
	jscpd: {
		enabled: false,
		mode: "strict",
		minTokens: 35,
		minLines: 4,
		similarity: 0.7,
		timeoutMs: 120000,
		whole: {
			minCoverage: 0.5,
			minDistinctiveRatio: 0.35,
		},
		fragment: {
			minTokens: 35,
			minLines: 4,
			minDistinctiveRatio: 0.35,
		},
	},
	requireExported: false,
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

const resolveThresholds = (opts) => {
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
};

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
