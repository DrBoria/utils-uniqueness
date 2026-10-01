"use strict";

/**
 * config.js
 *
 * The single place that knows the rule's defaults and normalizes the
 * ESLint options into a runtime config object. Every error type and the
 * scanner read from this object, so changing a default is a one-file edit.
 *
 * Paths are GENERIC: the catalog location is an option that defaults to the
 * conventional reports/ file under the repository root (the repo root is
 * discovered by walking up for a workspace marker).
 */

const path = require("node:path");
const { minimatch } = require("minimatch");
const { findRepoRoot } = require("./debt");

/** Default file exclusions (repo-relative paths): build artifacts and deps. */
const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/dist/**", "**/build/**", ".git/**", "**/_medplum/**", "**/_db/**", "**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx", "**/*.stories.tsx", "**/*.stories.ts"];

/**
 * Resolve a data-file option to an absolute path. A relative value is
 * resolved against the repository root (or cwd as a last resort).
 */
function resolveDataPath(value, root) {
	if (path.isAbsolute(value)) return value;
	const base = root || process.cwd();
	return path.resolve(base, value);
}

/**
 * Normalize the ESLint options into a runtime config object.
 *
 * @param {object} [opts] the first rule option (may be undefined)
 * @returns {object} config
 */
function normalizeOptions(opts) {
	const o = opts && typeof opts === "object" ? opts : {};
	const root = findRepoRoot(process.cwd());

	return {
		// The catalog of canonical utility functions (scanner output).
		catalog: o.catalog || null,
		catalogPath: resolveDataPath(o.catalogPath || "reports/utils-catalog.json", root),

		// Canonical utility folders: the canonical home of every shared
		// utility. The catalog is generated from them and the duplicate
		// report clusters them. Trailing slashes are optional. NO DEFAULT:
		// the canonical layout is the consumer's knowledge.
		utilsFolder: normalizeFolders(o.utilsFolder || []),

		// File filters: include (empty = everything) / exclude (build artifacts).
		include: o.include || [],
		exclude: o.exclude || DEFAULT_EXCLUDE,

		// jscpd raw-clone source: when enabled the scanner shells out to
		// jscpd and merges its clone pairs as an unfiltered duplicate source.
		useJscpd: o.useJscpd !== false,
		jscpdMinTokens: typeof o.jscpdMinTokens === "number" ? o.jscpdMinTokens : 20,
		jscpdSimilarity: typeof o.jscpdSimilarity === "number" ? o.jscpdSimilarity : 0.7,

		// Debt ledger section (relpath::ruleId -> count).
		debt: o.debt || null,

		// Repo root (for repo-relative paths in messages).
		root,
	};
}

/**
 * Normalize a list of folder prefixes: posix separators, no leading "./",
 * exactly one trailing slash.
 *
 * @param {Array<string|{path:string}>} folders
 * @returns {string[]}
 */
function normalizeFolders(folders) {
	return (folders || []).map((f) => {
		const raw = f && typeof f === "object" ? f.path : f;
		let s = String(raw).trim().split(path.sep).join("/");
		while (s.startsWith("./")) s = s.slice(2);
		if (!s.endsWith("/")) s += "/";
		return s;
	});
}

/**
 * Does a repo-relative path fall inside one of the given folder prefixes?
 *
 * @param {string} relPath repo-relative path (posix separators)
 * @param {string[]} folders normalized folder prefixes (trailing slash)
 * @returns {boolean}
 */
function inFolder(relPath, folders) {
	const p = relPath.split(path.sep).join("/");
	for (const dir of folders) {
		if (p.startsWith(dir) || p === dir.slice(0, -1)) return true;
	}
	return false;
}

/**
 * Is a repo-relative path ignored by the include/exclude filters?
 * include empty = everything not excluded. Each entry is a minimatch glob.
 *
 * @param {string} relPath repo-relative path (posix separators)
 * @param {string[]} include globs (empty = no include filter)
 * @param {string[]} exclude globs
 * @returns {boolean} true when the path should be skipped
 */
function isIgnored(relPath, include, exclude) {
	const p = relPath.split(path.sep).join("/");
	for (const pat of exclude || []) {
		if (minimatch(p, pat)) return true;
	}
	if (include && include.length) {
		return !include.some((pat) => minimatch(p, pat));
	}
	return false;
}

module.exports = {
	normalizeOptions,
	normalizeFolders,
	inFolder,
	isIgnored,
	resolveDataPath,
	DEFAULT_EXCLUDE,
};
