"use strict";

// Every message that is NOT about a verdict: what the run says when it cannot
// start (`no scan roots`), cannot read (`could not parse …`), cannot write
// (`catalog is out of date`) or genuinely broke (`the run failed for a reason
// that is not in the code`).
//
// They live beside the verdict wording for the same reason: the CLI must not
// hold a private copy of a sentence, and a message that appears both in the log
// and in the report has to read identically in both.
//
// `{placeholders}` are filled by the caller — the renderer never guesses.

const MESSAGES = Object.freeze({
	// ── Command line ────────────────────────────────────────────────────────
	optionValue: "{flag} requires a value{suffix}",
	optionInvalid: "{flag} {requirement}",
	unknownArgument: "unknown argument: {arg} (see --help)",

	// ── Preconditions ───────────────────────────────────────────────────────
	noScanRoots: "no scan roots: pass --roots <dir1>:<dir2> or set utilsFolder in the rule options (eslint.config.js / md-code-utils-uniqueness.config.js)",
	catalogStale: "catalog is out of date ({count} util(s) expected at {path}); regenerate it (node main.js)",

	// ── Files the run could not read ────────────────────────────────────────
	configUnreadable: "could not read {path}",
	parseFailed: "could not parse {path}: {reason}",
	parsePartsFailed: "could not parse parts of {path}: {reason}",
	noticeDetail: "{message}: {reason}",

	// ── Caches the run could not finish ─────────────────────────────────────
	catalogWriteFailed: "self-catalog: could not write {path}: {reason}",
	catalogBudget: "self-catalog: budget exhausted, catalog may be partially stale",
	libRegistryUnavailable: "lib-registry: ts-morph/typescript unavailable: {reason}",
	libRegistryBudget: "lib-registry: budget exhausted, remaining libs will be parsed on the next lint",

	// ── The engine itself ───────────────────────────────────────────────────
	crash: "utils-uniqueness: the run failed for a reason that is not in the code\n{detail}",
});

module.exports = { MESSAGES };
