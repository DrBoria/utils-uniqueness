#!/usr/bin/env node
"use strict";

import * as fs from "node:fs";
import * as path from "node:path";

const {
	pickRepoRoot,
	isIgnored,
	inUtilsFolder,
	canSeeCanon,
	DEFAULT_EXTS,
	loadRuleOptions,
	normalizeOptions,
	loadRegistry,
	loadCatalog,
} = require("./config");
import { walk, writeCatalog, slimRecord, dedupeAndSort } from "./utils";
import { parseFunctions, parseParts, setTsConfig, whenReady } from "./playgrounds/typescript.js";
import { buildCandidate, buildPartCandidate } from "./normalize/candidate.js";
import { matchSignals } from "./matcher";
import { decide, isTrash, trashScore } from "./decision-maker";
import * as dropUsages from "./filter/drop-usages";
import * as dropNoStructure from "./filter/drop-no-structure";
import { findMissingUtils } from "./filter/missing-util";
import { clusterAppPairs } from "./filter/app-pairs";
import { splitTrashClusters, collectTrashClusters, trashClusterName } from "./filter/trash";
import { renderUtilsReport, renderNotices } from "./report";
import { USAGE } from "./report/usage";
import { describeComp } from "./report/errorTypes";
import { render } from "./report/errorTypes/codes";
import { OUTCOME, TIER, SIMILAR_FANOUT_CAP, SIZE_RATIO, MIN_PART_CANON_NODES, CODE } from "./constants";
import { collectOverviewData, writeOverview } from "./report/user-report";
import * as log from "./report/logger";
import { say, warn, fail, crash, writeText, setQuiet, kb } from "./report/output";
import { takeNotices, peekNotices } from "./report/notices";

const FILTERS = [dropUsages, dropNoStructure];

const parseArgs = (argv) => {
	const cfg: any = {
		roots: null,
		out: null,
		registry: null,
		repoRoot: null,
		check: false,
		report: null,
		appRoots: null,
		files: null,
		ignoreDirs: null,
		verbose: false,
		include: null,
		log: null,
		minCluster: 3,
		thresholds: null,
		parts: false,
		configFile: null,
		proposeUtils: false,
		overview: null,
		help: false,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i];
		if (a === "--check") {
			cfg.check = true;
		} else if (a === "--report") {
			const next = argv[i + 1];
			cfg.report = next && !next.startsWith("--") ? argv[++i] : "reports/utils-duplicates.md";
		} else if (a === "--overview") {
			// The HTML overview is OPT-IN: a plain `eslint src` run must not write
			// a big self-contained page into the repo. `--overview` alone writes
			// the default file; a path right after it overrides that.
			const next = argv[i + 1];
			cfg.overview = next && !next.startsWith("--") ? argv[++i] : "reports/utils-overview.html";
		} else if (a === "--quiet") {
			cfg.quiet = true;
		} else if (a === "--roots") {
			if (!argv[i + 1]) fail(render(CODE.OptionValue, { flag: "--roots", suffix: " (colon-separated list of directories)" }));
			cfg.roots = argv[++i].split(":").filter(Boolean);
		} else if (a === "--out") {
			if (!argv[i + 1]) fail(render(CODE.OptionValue, { flag: "--out", suffix: "" }));
			cfg.out = argv[++i];
		} else if (a === "--registry") {
			if (!argv[i + 1]) fail(render(CODE.OptionValue, { flag: "--registry", suffix: "" }));
			cfg.registry = argv[++i];
		} else if (a === "--repo-root") {
			if (!argv[i + 1]) fail(render(CODE.OptionValue, { flag: "--repo-root", suffix: "" }));
			cfg.repoRoot = argv[++i];
		} else if (a === "--app-roots") {
			if (!argv[i + 1]) fail(render(CODE.OptionValue, { flag: "--app-roots", suffix: " (colon-separated list of directories)" }));
			cfg.appRoots = argv[++i].split(":").filter(Boolean);
		} else if (a === "--files") {
			if (!argv[i + 1]) fail(render(CODE.OptionValue, { flag: "--files", suffix: " (colon-separated list of files)" }));
			cfg.files = argv[++i].split(":").filter(Boolean);
		} else if (a === "--ignore-dirs") {
			if (!argv[i + 1]) fail(render(CODE.OptionValue, { flag: "--ignore-dirs", suffix: " (colon-separated list of directory names)" }));
			cfg.ignoreDirs = argv[++i].split(":").filter(Boolean);
		} else if (a === "--parts") {
			cfg.parts = true;
		} else if (a === "--propose-utils") {
			cfg.proposeUtils = true;
		} else if (a === "--verbose") {
			cfg.verbose = true;
		} else if (a === "--include") {
			if (!argv[i + 1]) fail(render(CODE.OptionValue, { flag: "--include", suffix: " (colon-separated list of file globs)" }));
			cfg.include = argv[++i].split(":").filter(Boolean);
		} else if (a === "--log") {
			if (!argv[i + 1]) fail(render(CODE.OptionValue, { flag: "--log", suffix: " (path to the stage log file)" }));
			cfg.log = argv[++i];
		} else if (a === "--thresholds") {
			if (!argv[i + 1]) fail(render(CODE.OptionValue, { flag: "--thresholds", suffix: " (duplicate:similar, e.g. 0.7:0.5)" }));
			const [dup, sim] = argv[++i].split(":").map((s) => Number.parseFloat(s));
			if (!Number.isFinite(dup) || !Number.isFinite(sim)) fail(render(CODE.OptionInvalid, { flag: "--thresholds", requirement: "must be two numbers separated by a colon (duplicate:similar)" }));
			cfg.thresholds = { duplicate: dup, similar: sim };
		} else if (a === "--min-cluster") {
			if (!argv[i + 1]) fail(render(CODE.OptionValue, { flag: "--min-cluster", suffix: " (min app utils matching one canonical to flag it as a missing util)" }));
			const n = Number.parseInt(argv[i + 1], 10);
			if (!Number.isFinite(n) || n < 2) fail(render(CODE.OptionInvalid, { flag: "--min-cluster", requirement: "must be an integer >= 2" }));
			cfg.minCluster = n;
			i += 1;
		} else if (a === "--config") {
			if (!argv[i + 1]) fail(render(CODE.OptionValue, { flag: "--config", suffix: " (path to an eslint.config.js or a standalone options file)" }));
			cfg.configFile = argv[++i];
		} else if (a === "--help" || a === "-h") {
			cfg.help = true;
		} else {
			fail(render(CODE.UnknownArgument, { arg: a }));
		}
	}
	return cfg;
};

const resolveAgainst = (value, repoRoot) => (path.isAbsolute(value) ? value : path.resolve(repoRoot, value));

const relPosix = (repoRoot, abs) => path.relative(repoRoot, abs).split(path.sep).join("/");

const collectFiles = (roots, repoRoot, shouldSkip, exts, ignoreDirs) => {
	const files = [];
	let count = 0;
	for (const relRoot of roots) {
		const rootDir = resolveAgainst(relRoot, repoRoot);
		if (!fs.existsSync(rootDir)) continue;
		for (const file of walk(rootDir, exts, ignoreDirs)) {
			if (shouldSkip(file)) continue;
			const rel = relPosix(repoRoot, file);
			count += 1;
			files.push({ file, rel });
		}
	}
	return { files, count };
};

const parseUtils = (files, config, role = "CANONICAL") => {
	const utils = [];
	// Every function in every file is a comparable utility — there is no
	// exported-only contract for either role.
	void role;
	for (const { file, rel } of files) {
		let parsed;
		try {
			parsed = parseFunctions(file);
		} catch (err) {
			warn(render(CODE.ParseFailed, { path: rel, reason: err && err.message ? err.message : err }));
			continue;
		}
		for (const d of parsed) {
			if (log.enabled()) log.stage("normalizer:before", { role, file: rel, name: d.name });
			const candidate = buildCandidate(d, config);
			const withPath = { ...candidate, path: rel };
			if (log.enabled()) log.stage("normalizer:after", { role, file: rel, name: d.name, nodeCount: withPath.nodes, structure: withPath.structure.present });
			utils.push(withPath);
		}
	}
	return utils;
};

// An inline callback is named `owner#anon@line`. Comparing it with its owner (or
// the owner with it) is not a duplicate — it is the SAME function compared with a
// piece of itself. That pair must never reach the report.
const nestedName = (inner, outer) => String(inner) === String(outer) || String(inner).startsWith(`${String(outer)}#anon@`);
const sameNesting = (a, b) => nestedName(a, b) || nestedName(b, a);

// Two functions in the SAME file whose line ranges OVERLAP are one inside the
// other (or the same range) — a function compared with a piece of itself. The
// name check missed a NAMED inner function (`const handleAltClick = …` inside
// `LocatorBridge`); the ranges catch every nesting.
const rangeOf = (c) => {
	const start = c?.startLine ?? c?.line ?? null;
	if (start === null || start === undefined) return null;
	const end = c?.endLine ?? start;

	return [start, end ?? start];
};
const overlaps = (a, b) => {
	if (a?.path !== b?.path) return false;
	const ra = rangeOf(a);
	const rb = rangeOf(b);
	if (!ra || !rb) return false;

	return ra[0] <= rb[1] && rb[0] <= ra[1];
};

const matchPairs = (appUtils, canonUtils, config) => {
	const matches = [];
	for (const app of appUtils) {
		for (const canon of canonUtils) {
			if (canon.path === app.path && (sameNesting(app.name, canon.name) || overlaps(app, canon))) continue;
			if (!canSeeCanon(app.path, canon.path, config.utilsFolder, config.compareAll)) continue;
			if (log.enabled()) log.stage("matcher:before", { app: { name: app.name, path: app.path }, canon: { name: canon.name, path: canon.path } });
			const signals = matchSignals(app, canon, { reliability: config.weights?.evidence });
			if (log.enabled()) log.stage("matcher:after", { app: { name: app.name, path: app.path }, canon: { name: canon.name, path: canon.path }, signals });
			const decision = decide(app, canon, { signals, weights: config.weights, thresholds: config.thresholds });
			if (log.enabled()) log.stage("decision:after", { app: { name: app.name, path: app.path }, canon: { name: canon.name, path: canon.path }, confidence: decision.confidence, tier: decision.tier, isDuplicate: decision.isDuplicate });
			if (!decision.tier) continue;
			matches.push({ app, canon, decision, tier: decision.tier, reason: decision.reason });
		}
	}
	// A↔B and B↔A are the SAME pair: under --compare-all both directions are
	// compared, so collapse the unordered pair to one finding (keep the first).
	const seen = new Set();
	return matches.filter((match) => {
		const key = [`${match.app.path}#${match.app.name}`, `${match.canon.path}#${match.canon.name}`].sort().join(" => ");
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
};

// The app↔app mode: match app functions against *each other* (no canonical
// anchor). This is what the canonical scan cannot see — a copy-pasted helper
// that lives in two app files and has no canonical to duplicate. Each pair is
// decided with the same signals/decision-maker, but the canonical-side gates
// (canSeeCanon / drop-usages / drop-no-structure) do not apply, so no
// filtering is applied here; clusterAppPairs does the mutual-similarity work.
//
// The naive match is O(n²) over every app util, so a cheap structural pre-filter
// runs first: two near-identical copies have near-identical bodies, so a large
// nodeCount gap means the pair cannot be a mutual copy and the expensive
// signal match is skipped. The ratio is the same SIZE_RATIO findParts uses.
const appPairSizeComparable = (a, b) => {
	const sa = a.nodes || 0;
	const sb = b.nodes || 0;
	if (sa === 0 || sb === 0) return sa === sb;

	return sa <= sb * SIZE_RATIO && sb <= sa * SIZE_RATIO;
};

const matchAppPairs = (appUtils, config, trashSet) => {
	const pairs = [];
	for (let i = 0; i < appUtils.length; i += 1) {
		for (let j = i + 1; j < appUtils.length; j += 1) {
			const a = appUtils[i];
			const b = appUtils[j];
			if (a.path === b.path && (sameNesting(a.name, b.name) || overlaps(a, b))) continue;
			if (!appPairSizeComparable(a, b)) continue;
			// §6: a valueless one-liner (trash) is not a partial duplicate of a
			// real function — the right fix is to inline it, not to cluster it.
			// Two trash members still pair (they form a "trash cluster").
			if (trashSet && (trashSet.has(a) !== trashSet.has(b))) continue;
			if (log.enabled()) log.stage("matcher:before", { app: { name: a.name, path: a.path }, peer: { name: b.name, path: b.path } });
			const signals = matchSignals(a, b, { reliability: config.weights?.evidence });
			if (log.enabled()) log.stage("matcher:after", { app: { name: a.name, path: a.path }, peer: { name: b.name, path: b.path }, signals });
			const decision = decide(a, b, { signals, weights: config.weights, thresholds: config.thresholds });
			if (log.enabled()) log.stage("decision:after", { app: { name: a.name, path: a.path }, peer: { name: b.name, path: b.path }, confidence: decision.confidence, tier: decision.tier, isDuplicate: decision.isDuplicate });
			if (!decision.tier) continue;
			pairs.push({ app: a, peer: b, decision, tier: decision.tier, reason: decision.reason });
		}
	}
	return pairs;
};

const applyFilters = (matches) => {
	const kept = [];
	const dropped = [];
	for (const match of matches) {
		if (log.enabled()) log.stage("filter:before", { app: { name: match.app.name, path: match.app.path }, canon: { name: match.canon.name, path: match.canon.path }, confidence: match.decision.confidence });
		let hit = null;
		for (const f of FILTERS) {
			// A filter answers with a CODE and its parameters, never with a sentence:
			// the wording is rendered here, once, from the shared vocabulary — the
			// same string the report, the editor and the page show.
			const verdict = f.test(match);
			if (verdict) {
				hit = { match, filter: f.name, code: verdict.code, params: verdict.params, reason: render(verdict.code, verdict.params) };
				break;
			}
		}
		if (hit) {
			dropped.push(hit);
			if (log.enabled()) log.stage("filter:after", { app: { name: match.app.name, path: match.app.path }, canon: { name: match.canon.name, path: match.canon.path }, outcome: OUTCOME.Dropped, filter: hit.filter, reason: hit.reason });
		} else {
			kept.push(match);
			if (log.enabled()) log.stage("filter:after", { app: { name: match.app.name, path: match.app.path }, canon: { name: match.canon.name, path: match.canon.path }, outcome: OUTCOME.Kept, confidence: match.decision.confidence });
		}
	}
	return { kept, dropped };
};

// The key identifies a distinct app function (path + name) matching a distinct
// canonical (path + name). Name-only keys collapse distinct same-named
// functions in different files (e.g. two `parseDay` helpers each duplicating
// `parseDayParam`), hiding true duplicates; path + name still collapses
// overloads of the same function, which is the only legitimate repeat.
const pairKey = (match) => `${match.app.path}#${match.app.name}=>${match.canon.path}#${match.canon.name}`;

const dedupPairs = (matches) => {
	const best = new Map();
	for (const match of matches) {
		const key = pairKey(match);
		const prev = best.get(key);
		if (!prev || match.decision.confidence > prev.decision.confidence) best.set(key, match);
	}
	return [...best.values()];
};



// Fanout is capped per distinct app function (path + name), not per name:
// same-named helpers in different files are different functions and must not
// spend each other's fanout budget.
const capSimilarFanout = (matches) => {
	const byApp = new Map();
	for (const m of matches) {
		if (m.decision.tier !== TIER.Similar) continue;
		const key = `${m.app.path}#${m.app.name}`;
		if (!byApp.has(key)) byApp.set(key, []);
		byApp.get(key).push(m);
	}
	const keep = new Set(matches.filter((m) => m.decision.tier !== TIER.Similar));
	for (const group of byApp.values()) {
		group.sort((a, b) => b.decision.confidence - a.decision.confidence || a.canon.name.localeCompare(b.canon.name));
		for (const m of group.slice(0, SIMILAR_FANOUT_CAP)) keep.add(m);
	}
	return [...keep];
};



const sizeOf = (item) => item.nodes || 0;

const comparableCanons = (part, canonUtils) => {
	const partSize = sizeOf(part);

	return canonUtils.filter((canon) => {
		const size = sizeOf(canon);
		if (size < MIN_PART_CANON_NODES) return false;

		return size <= partSize * SIZE_RATIO && partSize <= size * SIZE_RATIO;
	});
};

const findParts = (file, rel, canonUtils, config) => {
	let parts;
	try {
		parts = parseParts(file);
	} catch (err) {
		warn(render(CODE.ParsePartsFailed, { path: rel, reason: err && err.message ? err.message : err }));

		return [];
	}
	const found = [];
	for (const part of parts) {
		// The candidate (not the raw part) carries nodeCount — the size
		// pre-filter must compare on it.
		const candidate = { ...buildPartCandidate(part, config), path: rel };
		// A part never duplicates its own file: matchPairs skips same
		// path+name, but a part's owner name can differ from the canon's
		// (e.g. an anonymous arrow), so filter the pool by path too.
		const pool = comparableCanons(candidate, canonUtils).filter((c) => c.path !== rel);
		if (pool.length === 0) continue;
		const { kept } = applyFilters(matchPairs([candidate], pool, config));
		const ranked = [...kept].sort((a, b) => b.decision.confidence - a.decision.confidence);
		if (ranked.length === 0) continue;
		found.push({ part, best: ranked[0], alt: ranked[1] || null });
	}
	return found;
};

const collectParts = (appFiles, canonUtils, config) => {
	if (!config.parts) return [];
	const rows = [];
	for (const { file, rel } of appFiles) {
		for (const { part, best, alt } of findParts(file, rel, canonUtils, config)) {
			const suggestions = [{ util: best.canon.name, path: best.canon.path, confidence: best.decision.confidence, reason: best.decision.reason }];
			if (alt) suggestions.push({ util: alt.canon.name, path: alt.canon.path, confidence: alt.decision.confidence, reason: alt.decision.reason });
			rows.push({ owner: part.owner, tag: part.rootTag, path: rel, line: part.line, endLine: part.endLine, suggestions });
		}
	}
	return rows;
};

const stageLog = (enabled) => {
	const started = Date.now();

	return (label) => {
		if (!enabled) return;
		if (global.gc) global.gc();
		say(`${label}: ${((Date.now() - started) / 1000).toFixed(1)}s, heap ${Math.round(process.memoryUsage().heapUsed / 1048576)} MB`);
	};
};

const buildUtilsReport = async (args, repoRoot, roots, config, registry, catalogUtils) => {
	const exts = config.exts || DEFAULT_EXTS;
	const ignoreDirs = config.ignoreDirs;
	const dedupeFiles = (files) => {
		const seen = new Set();
		const out = [];
		for (const f of files) {
			if (seen.has(f.file)) continue;
			seen.add(f.file);
			out.push(f);
		}

		return out;
	};
	const stage = stageLog(args.verbose);

	const shouldSkipCanon = (abs) => isIgnored(relPosix(repoRoot, abs), [], config.exclude);
	const canonFiles = dedupeFiles(collectFiles(roots, repoRoot, shouldSkipCanon, exts, ignoreDirs).files);
	const canonUtils = parseUtils(canonFiles, config);
	stage(`canonical parsed (${canonUtils.length})`);

	const appInclude = args.appRoots ? [] : config.include;
	const appShouldSkip = (abs) => isIgnored(relPosix(repoRoot, abs), appInclude, config.exclude);
	// --files restricts the app-side candidate scan to the given files (agent
	// stop-hooks lint only changed files); the canonical (roots) scan stays folder-based.
	const appFiles = args.files
		? (() => {
			const files = args.files.map((rel) => ({ file: resolveAgainst(rel, repoRoot), rel: rel.split(path.sep).join("/") })).filter((f) => fs.existsSync(f.file) && fs.statSync(f.file).isFile());

			return { files, count: files.length };
		})()
		: collectFiles(args.appRoots || ["."], repoRoot, appShouldSkip, exts, ignoreDirs);
	const appUtils = parseUtils(appFiles.files, config, "CANDIDATE");
	// §6: the trash decision runs BEFORE any comparison. Every candidate gets
	// a score once; the score then rides along with the candidate into the
	// trash clusters and the report.
	const trashSet = new Set();
	for (const c of appUtils) {
		c.trashScore = trashScore(c);
		if (isTrash(c)) trashSet.add(c);
	}
	stage(`app parsed (${appUtils.length}, ${trashSet.size} trash)`);

	const matches = matchPairs(appUtils, canonUtils, config);
	const { kept, dropped } = applyFilters(matches);
	const deduped = dedupPairs(kept);
	stage("utils matched");
	const inLayer = (p) => inUtilsFolder(p, config.utilsFolder);
	const layerMatches = capSimilarFanout(deduped.filter((m) => inLayer(m.app.path)));
	const appMatches = deduped.filter((m) => !inLayer(m.app.path));
	const cappedAppMatches = capSimilarFanout(appMatches);
	const { clusters, remaining } = findMissingUtils(cappedAppMatches, { minCluster: args.minCluster });
	if (log.enabled()) log.stage("missing-util", { minCluster: args.minCluster, clusters: clusters.map((c) => ({ name: c.name, canon: c.canon.name, apps: c.matches.map((m) => m.app.name) })), remaining: remaining.length });
	stage("missing-util clustered");
	const parts = collectParts(appFiles.files, canonUtils, config);
	stage("parts done");

	// Clusters where EVERY member is a valueless one-liner (status guards and
	// the like) are not "worth moving to utils" — inlining the comparison at
	// the call site is the right fix. They go to the Trash section instead.
	const { keep: appClusters, trash: trashClusters } = config.proposeUtils
		? splitTrashClusters(clusterAppPairs(matchAppPairs(appUtils, config, trashSet)))
		: { keep: [], trash: [] };

	// Status guards are logical duplicates that never reach the copy floor
	// (their literal values differ — Fix 5), so they are clustered by body
	// shape with the constants collapsed, directly from the app utils.
	const allTrash = config.proposeUtils ? [...trashClusters, ...collectTrashClusters(appUtils)] : [];
	const seenTrash = new Set();
	const mergedTrash = allTrash
		.filter((c) => {
			const keys = c.members.map((m) => `${m.path}#${m.name}`);
			if (keys.some((k) => seenTrash.has(k))) return false;
			keys.forEach((k) => seenTrash.add(k));
			return true;
		})
		// App-pair clusters carry the suggestName heading ("Is", "Detail"…);
		// re-derive a distinguishing heading for every trash cluster so two
		// groups never share a name in the report.
		.map((c) => ({ ...c, name: trashClusterName(c.members) }));
	stage(`app-pairs done (${appClusters.length} cluster(s), ${mergedTrash.length} trash)`);

	return {
		matches: [...remaining, ...layerMatches],
		dropped,
		missingClusters: clusters,
		appClusters,
		trashClusters: mergedTrash,
		parts,
		layerFolders: config.utilsFolder,
		files: appFiles.count,
		canonCount: canonUtils.length,
		appCount: appUtils.length,
		// Both sides of every comparison, so the report can diff a pair without
		// re-parsing the project: the same candidates the funnel already built.
		appUtils,
		canonUtils,
	};
};

const main = async () => {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		for (const line of USAGE) say(line);

		return;
	}
	if (args.quiet) setQuiet(true);
	const cwd = process.cwd();

	const loaded = await loadRuleOptions(cwd, args.configFile);
	const configOptions = loaded ? { ...loaded.options } : {};
	if (loaded) {
		say(`config from ${loaded.source}`);
	} else if (!args.configFile) {
		say("no rule options found in eslint.config.js / md-code-utils-uniqueness.config.js; using defaults");
	}
	if (args.ignoreDirs) {
		const base = Array.isArray(configOptions.ignoreDirs) ? configOptions.ignoreDirs : [];
		configOptions.ignoreDirs = [...new Set([...base, ...args.ignoreDirs])];
	}

	const config = normalizeOptions(configOptions);
	setTsConfig(config.tsconfig);
	if (args.include) config.include = [...new Set([...(config.include || []), ...args.include])];
	if (args.thresholds) config.thresholds = { ...(config.thresholds || {}), ...args.thresholds };
	if (args.parts) config.parts = true;
	if (args.proposeUtils) config.proposeUtils = true;
	if (args.log) log.enable(args.log);
	await whenReady(config);
	const repoRoot = pickRepoRoot({ cwd, configSource: loaded ? loaded.source : null, explicitRepoRoot: args.repoRoot, rootMarkers: config.rootMarkers });

	const configRoots = (config.utilsFolder || []).map((d) => String(d).replace(/\\/g, "/").replace(/\/+$/, ""));
	const roots = args.roots || configRoots;

	// Both artifacts are the SAME findings rendered twice: markdown for a diff in
	// a pull request, HTML for a human. Building the comparison once means the two
	// can never disagree, and an overview-only run costs one pass.
	const writeArtifacts = async (catalogUtils) => {
		if (!args.report && !args.overview) return;
		const comp: any = await buildUtilsReport(args, repoRoot, roots, config, loadRegistry(config), catalogUtils);
		comp.findings = describeComp(comp);
		const notices = peekNotices();
		if (args.overview) {
			const data = collectOverviewData({ comp, repoRoot, config, catalogPath: args.out || config.exportPath, notices });
			const written = writeOverview(data, resolveAgainst(args.overview, repoRoot));
			say(`wrote overview ${path.relative(repoRoot, written.path)} (${comp.findings.length} finding(s), ${kb(written.bytes)})`);
		}
		if (args.report) {
			const reportPath = path.isAbsolute(args.report) ? args.report : path.resolve(process.cwd(), args.report);
			const written = writeText(reportPath, renderUtilsReport(comp, args.verbose, notices));
			say(`wrote report ${path.relative(repoRoot, written.path)}`);
		}
		takeNotices();
	};

	// --files is a partial scan (agent stop-hooks) — skip the catalog entirely
	// so a single-file scan does not clobber the folder-based catalog. Roots
	// may be empty (the canonical scan simply yields no catalog utils).
	if (args.files?.length) {
		await writeArtifacts(((loadCatalog(config) || {}).utils) || []);
		log.flush();

		return;
	}

	if (!roots || roots.length === 0) {
		fail(render(CODE.NoScanRoots));
	}
	if (!config.utilsFolder || config.utilsFolder.length === 0) {
		config.utilsFolder = roots;
	}

	const outPath = resolveAgainst(args.out || config.exportPath, repoRoot);
	const registry = args.registry ? loadRegistry({ ...config, registry: null, registryPath: args.registry }) : loadRegistry(config);
	const catalogUtils = ((loadCatalog(config) || {}).utils) || [];

	const include = config.include;
	const exclude = config.exclude;
	const shouldSkip = (abs) => isIgnored(relPosix(repoRoot, abs), include, exclude);
	const exts = config.exts;
	const ignoreDirs = config.ignoreDirs;

	const shouldSkipCanon = (abs) => isIgnored(relPosix(repoRoot, abs), [], config.exclude);
	const canonFiles = collectFiles(roots, repoRoot, shouldSkipCanon, exts, ignoreDirs).files;
	const final = dedupeAndSort(parseUtils(canonFiles, config).map((u) => slimRecord(u, repoRoot)));

	if (args.check) {
		let current = null;
		try {
			current = JSON.parse(fs.readFileSync(outPath, "utf8"));
		} catch {}
		const same = current && JSON.stringify(current.utils || []) === JSON.stringify(final);
		if (!same) {
			fail(render(CODE.CatalogStale, { count: final.length, path: path.relative(repoRoot, outPath) }));
		}
		say(`catalog up to date (${final.length} util(s))`);

		return;
	}

	writeCatalog(outPath, final);
	say(`wrote ${path.relative(repoRoot, outPath)} (${final.length} util(s), ${canonFiles.length} file(s) scanned)`);

	void registry;
	await writeArtifacts(catalogUtils);

	const leftover = takeNotices();
	if (leftover.length) say(renderNotices(leftover));
	log.flush();
};

const run = async () => {
	try {
		await main();
	} catch (err) {
		// A `fail()` message is ALREADY a sentence for the reader; anything else is
		// the engine breaking, and keeps its stack so it can be reported.
		if (err && err.reported) say(`utils-uniqueness: ${err.message}`);
		else say(crash(err));
		process.exitCode = 1;
	} finally {
		log.flush();
	}
};

export {  parseArgs, collectFiles, parseUtils, matchPairs, matchAppPairs, applyFilters, dedupPairs, capSimilarFanout, findParts, buildUtilsReport, stageLog, appPairSizeComparable, run  };

if (require.main === module) {
	run();
}
