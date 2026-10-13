"use strict";

const path = require("node:path");

const { normalizeOptions, inUtilsFolder, canSeeCanon, isIgnored, loadRegistry, loadCatalog, RULE_NAME, RULE_SHORT } = require("./config");
const { parseFunctions } = require("./playgrounds/typescript.js");
const { buildCandidate } = require("./normalize/candidate.js");
const { matchSignals } = require("./matcher");
const { decide } = require("./decision-maker");
const { applyFilters, findParts } = require("./main");

const normalizedCanons = new WeakMap();

const normalizeCanon = (canon, config) => {
	if (!normalizedCanons.has(canon)) normalizedCanons.set(canon, buildCandidate(canon, config));

	return normalizedCanons.get(canon);
};

const createRule = () => {
	return {
		meta: {
			type: "problem",
			docs: {
				description: "Flag utility functions that duplicate a canonical util, and partial blocks that should reuse the canonical util.",
			},
			messages: {
				duplicateUtil: "Util \"{{name}}\" duplicates the canonical \"{{canonName}}\" ({{reason}}).",
				partOfUtil: "This block in {{owner}} duplicates `{{util}}` from {{path}} ({{reason}}).",
			},
			schema: [
				{
					type: "object",
					properties: {
						registry: { type: "string" },
						registryPath: { type: "string" },
						catalog: { type: "array" },
						catalogPath: { type: "string" },
						parts: { type: "boolean" },
						weights: { type: "object" },
						thresholds: { type: "object" },
						utilsFolder: { type: "array" },
						include: { type: "array" },
						exclude: { type: "array" },
						exts: { type: "array" },
						ignoreDirs: { type: "array" },
						rootMarkers: { type: "array" },

					},
					additionalProperties: false,
				},
			],
		},
		create(context) {
			const options = context.options && context.options[0] ? context.options[0] : {};
			const config = normalizeOptions(options);
			const filename = context.filename || (context.getFilename ? context.getFilename() : "");
			const relPath = path.relative(context.cwd || process.cwd(), filename).split(path.sep).join("/");

			const isInUtilsFolder = inUtilsFolder(relPath, config.utilsFolder);
			if (isIgnored(relPath, isInUtilsFolder ? [] : config.include, config.exclude)) return {};

			loadRegistry(config);
			const catalogUtils = ((loadCatalog(config) || {}).utils) || [];
			const canonNames = [...new Set(catalogUtils.map((c) => c.name))];

			const checkDuplicates = () => {
				let parsed;
				try {
					parsed = parseFunctions(filename);
				} catch {
					return;
				}

				for (const d of parsed) {
					const candidate = buildCandidate({ ...d, path: relPath }, config);
					const pairs = [];
					for (const canon of catalogUtils) {
						if (canon.name === candidate.name) continue;
						if (!canSeeCanon(relPath, canon.path, config.utilsFolder)) continue;
						const normCanon = normalizeCanon(canon, config);
						const signals = matchSignals(candidate, normCanon);
						const decision = decide(candidate, normCanon, { signals, weights: config.weights, thresholds: config.thresholds });
						pairs.push({ canon: normCanon, signals, decision });
					}
					pairs.sort((a, b) => b.decision.confidence - a.decision.confidence);
					for (const p of pairs) {
						if (!p.decision.isDuplicate) continue;
						const { kept } = applyFilters([{ app: candidate, canon: p.canon, decision: p.decision, tier: p.decision.tier, reason: p.decision.reason }]);
						if (kept.length === 0) continue;
						const line = d.line || 1;
						context.report({
							loc: { start: { line, column: 0 }, end: { line, column: 0 } },
							messageId: "duplicateUtil",
							data: { name: candidate.name, canonName: p.canon.name, reason: p.decision.reason },
						});
					}
				}
				if (config.parts) {
					const canons = catalogUtils.map((canon) => normalizeCanon(canon, config));
					for (const { part, best } of findParts(filename, relPath, canons, config)) {
						context.report({
							loc: { start: { line: part.line, column: part.column }, end: { line: part.endLine, column: 0 } },
							messageId: "partOfUtil",
							data: { owner: part.owner, util: best.canon.name, path: best.canon.path, reason: best.decision.reason },
						});
					}
				}
			};

			return {
				"Program:exit": checkDuplicates,
			};
		},
	};
};

const rule = createRule();
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
module.exports.RULE_NAME = RULE_NAME;
module.exports.RULE_SHORT = RULE_SHORT;
