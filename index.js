"use strict";

/**
 * index.js
 *
 * The ESLint rule. On each file it:
 *   1. extracts the file's utility functions (extract.js),
 *   2. loads the catalog (reports/utils-catalog.json) built by the scanner,
 *   3. reports every function that belongs to a duplicate cluster,
 *      pointing at the canonical member ("use X from <path>"),
 *   4. drops findings covered by the debt ledger (debt.js).
 *
 * The rule is read-only with respect to the catalog: it never writes it.
 * Run the scanner (bin) to (re)build the catalog.
 */

const fs = require("node:fs");
const path = require("node:path");

const { normalizeOptions, isIgnored, resolveDataPath } = require("./config");
const { resolveThresholds } = require("./thresholds");
const { applyDebt, loadLedger, findRepoRoot } = require("./debt");
const { extractFromFile } = require("./extract");

const RULE_ID = "utils-uniqueness";

/**
 * Load the catalog JSON, or null when absent/unreadable.
 *
 * @param {string} catalogPath absolute path
 * @returns {object|null}
 */
function loadCatalog(catalogPath) {
	try {
		const raw = fs.readFileSync(catalogPath, "utf8");
		const parsed = JSON.parse(raw);
		if (!parsed || !Array.isArray(parsed.functions)) return null;
		return parsed;
	} catch {
		return null;
	}
}

/**
 * Resolve a catalog member (repo-relative path) to an absolute path using
 * the catalog's own recorded repoRoot.
 *
 * @param {object} catalog
 * @param {object} member catalog member {path, line}
 * @returns {string} absolute path
 */
function memberAbsPath(catalog, member) {
	const p = member.path || "";
	if (path.isAbsolute(p)) return p;
	const base = catalog.repoRoot ? path.resolve(catalog.repoRoot) : process.cwd();
	return path.resolve(base, p);
}

/**
 * Find the duplicate cluster (if any) that a record belongs to, and the
 * canonical member to point at.
 *
 * @param {object} catalog
 * @param {object} rec FunctionRecord from the current file
 * @returns {{cluster: object, canonical: object}|null}
 */
function findClusterFor(catalog, rec) {
	for (const cluster of catalog.clusters || []) {
		const hit = (cluster.members || []).find((m) => memberAbsPath(catalog, m) === rec.path && m.line === rec.line);
		if (hit) return { cluster, canonical: cluster.canonical };
	}
	return null;
}

module.exports = {
	meta: {
		type: "problem",
		docs: {
			description: "Report duplicate utility functions (non-component) against a scanned catalog",
			recommended: false,
		},
		messages: {
			duplicateUtility:
				"Duplicate utility: `{{name}}` duplicates `{{canonical}}` in {{canonicalPath}} ({{tier}}). Use the canonical version.",
			missingCatalog:
				"Utils catalog not found at {{catalogPath}}. Run the scanner first: `npx md-code-utils-uniqueness --roots <utils-folder>`.",
		},
		schema: [
			{
				type: "object",
				properties: {
					catalog: { type: "string" },
					catalogPath: { type: "string" },
					utilsFolder: {
						oneOf: [
							{ type: "string" },
							{
								type: "array",
								items: {
									oneOf: [
										{ type: "string" },
										{
											type: "object",
											properties: { path: { type: "string" } },
											required: ["path"],
										},
									],
								},
							},
						],
					},
					include: { type: "array", items: { type: "string" } },
					exclude: { type: "array", items: { type: "string" } },
					useJscpd: { type: "boolean" },
					debt: { oneOf: [{ type: "boolean" }, { type: "string" }] },
					root: { type: "string" },
					thresholds: {
						type: "object",
						properties: {
							minBodyTokens: { type: "number" },
							signatureExact: { type: "boolean" },
							bodyMinRatio: { type: "number" },
							jscpdMinTokens: { type: "number" },
							jscpdSimilarity: { type: "number" },
							requireExported: { type: "boolean" },
						},
						additionalProperties: false,
					},
				},
				additionalProperties: false,
			},
		],
	},

	create(rawContext) {
		const context0 = rawContext && rawContext.options !== undefined ? rawContext : { ...rawContext, options: [] };
		const rawOpts = context0.options && context0.options[0];
		const opts = normalizeOptions(rawOpts);
		const thresholds = resolveThresholds(rawOpts);

		const filename = context0.getFilename ? context0.getFilename() : context0.filename;
		const root = opts.root || (filename ? findRepoRoot(path.dirname(filename)) : null) || findRepoRoot(process.cwd());

		const ledgerPath =
			typeof opts.debt === "string" ? resolveDataPath(opts.debt, root) : path.join(root || process.cwd(), "reports", "lint-debt.json");
		const ledger = opts.debt === false ? {} : loadLedger(ledgerPath);
		const context = applyDebt(context0, ledger, RULE_ID);

		const catalogPath = opts.catalogPath;
		const catalog = loadCatalog(catalogPath);

		return {
			Program(node) {
				if (!filename) return;
				const rel = path.relative(root, filename).split(path.sep).join("/");
				if (isIgnored(rel, opts.include, opts.exclude)) return;

				if (!catalog) {
					context.report({
						node,
						messageId: "missingCatalog",
						data: { catalogPath: path.relative(root, catalogPath).split(path.sep).join("/") },
					});
					return;
				}

				const records = extractFromFile(filename, { requireExported: thresholds.requireExported });
				for (const rec of records) {
					if (rec.bodyTokenCount < thresholds.minBodyTokens) continue;
					const found = findClusterFor(catalog, rec);
					if (!found) continue;
					const { cluster, canonical } = found;
					const canonicalAbs = memberAbsPath(catalog, canonical);
					if (canonicalAbs === rec.path && canonical.line === rec.line) continue;
					const relCanonical = path.relative(root, canonicalAbs).split(path.sep).join("/");
					context.report({
						node,
						messageId: "duplicateUtility",
						data: {
							name: rec.name,
							canonical: canonical.name,
							canonicalPath: `${relCanonical}:${canonical.line}`,
							tier: cluster.tier,
						},
					});
				}
			},
		};
	},
};
