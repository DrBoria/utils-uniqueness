"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { normalizeOptions, isIgnored, resolveDataPath, findRepoRoot } = require("./config");
const { resolveThresholds } = require("./thresholds");
const { applyDebt, loadLedger } = require("./debt");
const { extractFromFile } = require("./ast");
const { flatMap, filter } = require("remeda");

const RULE_ID = "utils-uniqueness";

const loadCatalog = (catalogPath) => {
	try {
		const raw = fs.readFileSync(catalogPath, "utf8");
		const parsed = JSON.parse(raw);
		if (!parsed || !Array.isArray(parsed.functions)) return null;
		return parsed;
	} catch {
		return null;
	}
};

const memberAbsPath = (catalog, member) => {
	const p = member.path || "";
	if (path.isAbsolute(p)) return p;
	const base = catalog.repoRoot ? path.resolve(catalog.repoRoot) : process.cwd();
	return path.resolve(base, p);
};

const findClusterFor = (catalog, rec) => {
	for (const cluster of catalog.clusters || []) {
		const hit = (cluster.members || []).find((m) => memberAbsPath(catalog, m) === rec.path && m.line === rec.line);
		if (hit) return { cluster, canonical: cluster.canonical };
	}
	return null;
};

const rule = {
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
				const hits = flatMap(
					filter(records, (rec) => rec.bodyTokenCount >= thresholds.minBodyTokens),
					(rec) => {
						const found = findClusterFor(catalog, rec);
						if (!found) return [];
						const { cluster, canonical } = found;
						const canonicalAbs = memberAbsPath(catalog, canonical);
						if (canonicalAbs === rec.path && canonical.line === rec.line) return [];
						const relCanonical = path.relative(root, canonicalAbs).split(path.sep).join("/");
						return [
							{
								node,
								messageId: "duplicateUtility",
								data: {
									name: rec.name,
									canonical: canonical.name,
									canonicalPath: `${relCanonical}:${canonical.line}`,
									tier: cluster.tier,
								},
							},
						];
					},
				);
				hits.forEach((h) => context.report(h));
			},
		};
	},
};

const pkg = require("./package.json");

module.exports = {
	meta: {
		name: pkg.name,
		version: pkg.version,
	},
	rules: {
		"utils-uniqueness": rule,
	},
};
