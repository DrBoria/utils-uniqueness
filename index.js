"use strict";

const path = require("node:path");

const { normalizeOptions, inUtilsFolder, canSeeCanon, isIgnored, loadRegistry, loadCatalog, RULE_NAME, RULE_SHORT } = require("./config");
const { refreshCatalog } = require("./self-catalog");
const { parseFunctions, setLiveSource } = require("./playgrounds/typescript.js");
const { buildCandidate } = require("./normalize/candidate.js");
const { matchSignals } = require("./matcher");
const { decide } = require("./decision-maker");
const { applyFilters, findParts } = require("./main");
const { buildLibRegistry, fileImportSpecifiers, suggestFromLib } = require("./lib-registry");

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
				duplicateUtil: "Util \"{{name}}\" duplicates the canonical \"{{canonName}}\" ({{reason}}).{{libHint}}",
				partOfUtil: "This block in {{owner}} duplicates `{{util}}` from {{path}} ({{reason}}).{{libHint}}",
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
						compareAll: { type: "boolean" },
						proposeFromLib: {
							type: "boolean",
							description:
								"When a duplicate is found, also check the project's installed dependencies (read dynamically from package.json) for an export with the same name and suggest it in the message. Skipped for libs the file already imports (the local function is likely extending the lib, not duplicating it). Default false.",
						},
						cache: {
							type: "boolean",
							description:
								"Self-maintain the catalog: on each lint, walk the folder, re-parse only files that changed (mtime+size cache in a temp file) and rewrite the catalog. Default true. Set false to maintain the catalog externally.",
						},
						root: { type: "string" },
					},
					additionalProperties: false,
				},
			],
		},
		create(context) {
			const options = context.options && context.options[0] ? context.options[0] : {};
			const config = normalizeOptions(options);
			const filename = context.filename || (context.getFilename ? context.getFilename() : "");
			const relPath = path.relative(config.root, filename).split(path.sep).join("/");
			// The live parse is the source of truth for the file's own
			// functions: a catalog entry for this file that has no live
			// counterpart is stale (the function was deleted) and must not
			// be compared against.
			const liveLines = new Set();

			const isInUtilsFolder = inUtilsFolder(relPath, config.utilsFolder);
			if (isIgnored(relPath, isInUtilsFolder ? [] : config.include, config.exclude)) return {};

			loadRegistry(config);
			// Self-maintained catalog: walk the folder, re-parse only files that
			// changed since the last lint (per-file mtime+size cache in a temp
			// file), rewrite the catalog. ~0ms when nothing changed, ~100-300ms
			// for one changed file. The current file is always re-parsed from
			// its live editor buffer below, so unsaved edits are never missed.
			if (config.cache !== false) refreshCatalog(config);
			const catalogUtils = ((loadCatalog(config) || {}).utils) || [];
			const canonNames = [...new Set(catalogUtils.map((c) => c.name))];
			// proposeFromLib: inventory of the project's installed dependency
			// exports, so a duplicate report can suggest "use `sortBy` from
			// `lodash`". Built lazily once per lint; cached in os.tmpdir()
			// and invalidated when package.json changes.
			let libRegistry = null;
			const libHint = (name, sourceText) => {
				if (!config.proposeFromLib) return "";
				if (!libRegistry) libRegistry = buildLibRegistry(config.root);
				if (libRegistry.size === 0) return "";
				const imports = fileImportSpecifiers(sourceText);
				const suggestions = suggestFromLib(name, libRegistry, imports);
				if (suggestions.length === 0) return "";
				const list = suggestions.map((s) => `\`${s.name}\` from \`${s.lib}\``).join(", ");
				return ` Consider using ${list} instead of a local implementation.`;
			};

			const checkDuplicates = () => {
				let parsed;
				let liveText = null;
				try {
					// Parse the LIVE source (the editor buffer), not the disk
					// state: on save the ESLint extension lints the buffer via
					// lintText, and the file on disk may not match it yet.
					const sourceCode = context.sourceCode || (context.getSourceCode ? context.getSourceCode() : null);
					liveText = sourceCode === null ? null : typeof sourceCode === "string" ? sourceCode : typeof sourceCode.text === "string" ? sourceCode.text : null;
					if (liveText !== null) setLiveSource(filename, liveText);
					parsed = parseFunctions(filename);
				} catch {
					return;
				}
				liveLines.clear();
				for (const d of parsed) liveLines.add(d.line);

				for (const d of parsed) {
					const candidate = buildCandidate({ ...d, path: relPath }, config);
					const pairs = [];
					for (const canon of catalogUtils) {
						// Same file: compare only against catalog entries
						// that still exist in the live parse (stale entries
						// for deleted functions are skipped — otherwise a
						// deletion would keep flagging a ghost duplicate),
						// and never against the function itself.
						if (canon.path === relPath) {
							if (canon.line === d.line) continue;
							if (!liveLines.has(canon.line)) continue;
						}
						if (!canSeeCanon(relPath, canon.path, config.utilsFolder, config.compareAll)) continue;
						const normCanon = normalizeCanon(canon, config);
						const signals = matchSignals(candidate, normCanon);
						const decision = decide(candidate, normCanon, { signals, weights: config.weights, thresholds: config.thresholds });
						pairs.push({ canon: normCanon, signals, decision });
					}
					pairs.sort((a, b) => b.decision.confidence - a.decision.confidence);
					// Report only the single best match per candidate: a copy
					// pasted against several identical canons is one duplicate,
					// not one per canon. Pairs are sorted by confidence, so the
					// first duplicate is the canonical one to point at.
					for (const p of pairs) {
						if (!p.decision.isDuplicate) continue;
						const { kept } = applyFilters([{ app: candidate, canon: p.canon, decision: p.decision, tier: p.decision.tier, reason: p.decision.reason }]);
						if (kept.length === 0) continue;
						const line = d.line || 1;
						context.report({
							loc: { start: { line, column: 0 }, end: { line, column: 0 } },
							messageId: "duplicateUtil",
							data: { name: candidate.name, canonName: p.canon.name, reason: p.decision.reason, libHint: libHint(candidate.name, liveText) },
						});
						break;
					}
				}
				if (config.parts) {
					const canons = catalogUtils.map((canon) => normalizeCanon(canon, config));
					for (const { part, best } of findParts(filename, relPath, canons, config)) {
						context.report({
							loc: { start: { line: part.line, column: part.column }, end: { line: part.endLine, column: 0 } },
							messageId: "partOfUtil",
							data: { owner: part.owner, util: best.canon.name, path: best.canon.path, reason: best.decision.reason, libHint: libHint(best.canon.name, liveText) },
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
