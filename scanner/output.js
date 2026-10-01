"use strict";

/**
 * scanner/output.js
 *
 * Catalog serialization: dedupe, sort, and write the utils catalog JSON.
 *
 * Catalog shape:
 *   {
 *     version: 1,
 *     generatedAt: "<iso>",
 *     roots: ["<root>", ...],
 *     functions: [FunctionRecord...],      // every extracted utility
 *     clusters: [{ canonical, members, tier }...]  // duplicate groups
 *   }
 */

const fs = require("node:fs");
const path = require("node:path");

/**
 * Strip non-serializable / bulky fields from a record for the catalog.
 * bodyTokens stay out of the catalog (the rule re-extracts per file). The
 * path is rewritten to be repo-relative so the catalog is portable across
 * machines / checkouts (the rule resolves it back to an absolute path).
 *
 * @param {object} rec FunctionRecord
 * @param {string} repoRoot repo root the path should be relative to
 * @returns {object}
 */
function slimRecord(rec, repoRoot) {
	const { bodyTokens, ...rest } = rec;
	const p = path.isAbsolute(rec.path) && repoRoot ? path.relative(repoRoot, rec.path) : rec.path;
	return { ...rest, path: p.split(path.sep).join("/") };
}

/**
 * Dedupe by (path, line) and sort deterministically (path, line, name).
 *
 * @param {Array<object>} records
 * @returns {Array<object>}
 */
function dedupeAndSort(records) {
	const seen = new Set();
	const out = [];
	for (const rec of records) {
		const key = `${rec.path}|${rec.line}|${rec.name}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(rec);
	}
	out.sort((a, b) => {
		if (a.path !== b.path) return a.path < b.path ? -1 : 1;
		if (a.line !== b.line) return a.line - b.line;
		return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
	});
	return out;
}

/**
 * Write the catalog JSON, creating parent directories.
 *
 * @param {string} outPath absolute path
 * @param {object} catalog
 */
function writeCatalog(outPath, catalog) {
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2) + "\n", "utf8");
}

module.exports = { slimRecord, dedupeAndSort, writeCatalog };
