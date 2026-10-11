#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
	findRepoRoot,
	isIgnored,
	inUtilsFolder,
	canSeeCanon,
	DEFAULT_EXTS,
	loadRuleOptions,
	normalizeOptions,
	loadRegistry,
	loadCatalog,
} = require("./config");
const { walk, writeCatalog, slimRecord, dedupeAndSort } = require("./utils");
const { parseFunctions, parseParts, whenReady } = require("./playgrounds/typescript.js");
const { buildCandidate, buildPartCandidate } = require("./normalize/candidate.js");
const { matchSignals } = require("./matcher");
const { decide, isTrash, trashScore } = require("./decision-maker");
const dropUsages = require("./filter/drop-usages");
const dropNoStructure = require("./filter/drop-no-structure");
const { findMissingUtils } = require("./filter/missing-util");
const { clusterAppPairs } = require("./filter/app-pairs");
const { splitTrashClusters, collectTrashClusters, trashClusterName } = require("./filter/trash");
const { renderUtilsReport } = require("./report");
const log = require("./logger");

const FILTERS = [dropUsages, dropNoStructure];

const fail = (message) => {
	console.error(`[utils-uniqueness] ${message}`);
	process.exit(1);
};

const parseArgs = (argv) => {
	const cfg = {
		roots: null,
		out: null,
		registry: null,
		repoRoot: null,
		check: false,
		report: null,
		appRoots: null,
		ignoreDirs: null,
		verbose: false,
		include: null,
		log: null,
		minCluster: 3,
		thresholds: null,
		parts: false,
		configFile: null,
		proposeUtils: false,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i];
		if (a === "--check") {
			cfg.check = true;
		} else if (a === "--report") {
			const next = argv[i + 1];
			cfg.report = next && !next.startsWith("--") ? argv[++i] : "reports/utils-duplicates.md";
		} else if (a === "--roots") {
			if (!argv[i + 1]) fail("--roots requires a value (colon-separated list of directories)");
			cfg.roots = argv[++i].split(":").filter(Boolean);
		} else if (a === "--out") {
			if (!argv[i + 1]) fail("--out requires a value");
			cfg.out = argv[++i];
		} else if (a === "--registry") {
			if (!argv[i + 1]) fail("--registry requires a value");
			cfg.registry = argv[++i];
		} else if (a === "--repo-root") {
			if (!argv[i + 1]) fail("--repo-root requires a value");
			cfg.repoRoot = argv[++i];
		} else if (a === "--app-roots") {
			if (!argv[i + 1]) fail("--app-roots requires a value (colon-separated list of directories)");
			cfg.appRoots = argv[++i].split(":").filter(Boolean);
		} else if (a === "--ignore-dirs") {
			if (!argv[i + 1]) fail("--ignore-dirs requires a value (colon-separated list of directory names)");
			cfg.ignoreDirs = argv[++i].split(":").filter(Boolean);
		} else if (a === "--parts") {
			cfg.parts = true;
		} else if (a === "--propose-utils") {
			cfg.proposeUtils = true;
		} else if (a === "--verbose") {
			cfg.verbose = true;
		} else if (a === "--include") {
			if (!argv[i + 1]) fail("--include requires a value (colon-separated list of file globs)");
			cfg.include = argv[++i].split(":").filter(Boolean);
		} else if (a === "--log") {
			if (!argv[i + 1]) fail("--log requires a value (path to the stage log file)");
			cfg.log = argv[++i];
		} else if (a === "--thresholds") {
			if (!argv[i + 1]) fail("--thresholds requires a value (duplicate:similar, e.g. 0.7:0.5)");
			const [dup, sim] = argv[++i].split(":").map((s) => Number.parseFloat(s));
			if (!Number.isFinite(dup) || !Number.isFinite(sim)) fail("--thresholds must be two numbers separated by a colon (duplicate:similar)");
			cfg.thresholds = { duplicate: dup, similar: sim };
		} else if (a === "--min-cluster") {
			if (!argv[i + 1]) fail("--min-cluster requires a value (min app utils matching one canonical to flag it as a missing util)");
			const n = Number.parseInt(argv[i + 1], 10);
			if (!Number.isFinite(n) || n < 2) fail("--min-cluster must be an integer >= 2");
			cfg.minCluster = n;
			i += 1;
		} else if (a === "--config") {
			if (!argv[i + 1]) fail("--config requires a value (path to an eslint.config.js or a standalone options file)");
			cfg.configFile = argv[++i];
		} else if (a === "--help" || a === "-h") {
			console.log("Usage: utils-uniqueness [--roots a:b] [--out file] [--registry file] [--repo-root dir] [--check] [--report [file.md]] [--app-roots a:b] [--ignore-dirs a:b] [--include a.ts:b.ts] [--thresholds dup:sim] [--parts] [--propose-utils] [--config file] [--log file] [--min-cluster N] [--verbose]");
			console.log("Rule options (weights, thresholds, parts, include, ignoreDirs, utilsFolder) are read from the consumer's eslint.config.js (rule md-code/utils-uniqueness) or md-code-utils-uniqueness.config.js; --config points to a specific file. CLI flags override the config.");
			process.exit(0);
		} else {
			fail(`unknown argument: ${a} (see --help)`);
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
	// The canonical catalog is the *public API* of the utils folder: only
	// exported functions are reuse targets. Private helpers (e.g. a module-local
	// object builder) must not become canonicals, or every structurally similar
	// app function over-matches them. App/candidate functions are scanned as-is.
	const requireExported = role === "CANONICAL" ? true : config.requireExported;
	for (const { file, rel } of files) {
		let parsed;
		try {
			parsed = parseFunctions(file, { requireExported });
		} catch (err) {
			console.warn(`[utils-uniqueness] could not parse ${rel}: ${err && err.message ? err.message : err}`);
			continue;
		}
		for (const d of parsed) {
			if (log.enabled()) log.stage("normalizer:before", { role, file: rel, name: d.name });
			const candidate = buildCandidate(d, config);
			const withPath = { ...candidate, path: rel };
			if (log.enabled()) log.stage("normalizer:after", { role, file: rel, name: d.name, nodeCount: withPath.nodeCount, hasStructure: withPath.hasStructure });
			utils.push(withPath);
		}
	}
	return utils;
};

const matchPairs = (appUtils, canonUtils, config) => {
	const matches = [];
	for (const app of appUtils) {
		for (const canon of canonUtils) {
			if (canon.path === app.path && canon.name === app.name) continue;
			if (!canSeeCanon(app.path, canon.path, config.utilsFolder)) continue;
			if (log.enabled()) log.stage("matcher:before", { app: { name: app.name, path: app.path }, canon: { name: canon.name, path: canon.path } });
			const signals = matchSignals(app, canon);
			if (log.enabled()) log.stage("matcher:after", { app: { name: app.name, path: app.path }, canon: { name: canon.name, path: canon.path }, signals });
			const decision = decide(app, canon, { signals, weights: config.weights, thresholds: config.thresholds });
			if (log.enabled()) log.stage("decision:after", { app: { name: app.name, path: app.path }, canon: { name: canon.name, path: canon.path }, confidence: decision.confidence, tier: decision.tier, isDuplicate: decision.isDuplicate });
			if (!decision.tier) continue;
			matches.push({ app, canon, decision, tier: decision.tier, reason: decision.reason });
		}
	}
	return matches;
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
	const sa = a.nodeCount || 0;
	const sb = b.nodeCount || 0;
	if (sa === 0 || sb === 0) return sa === sb;

	return sa <= sb * SIZE_RATIO && sb <= sa * SIZE_RATIO;
};

const matchAppPairs = (appUtils, config, trashSet) => {
	const pairs = [];
	for (let i = 0; i < appUtils.length; i += 1) {
		for (let j = i + 1; j < appUtils.length; j += 1) {
			const a = appUtils[i];
			const b = appUtils[j];
			if (a.path === b.path && a.name === b.name) continue;
			if (!appPairSizeComparable(a, b)) continue;
			// §6: a valueless one-liner (trash) is not a partial duplicate of a
			// real function — the right fix is to inline it, not to cluster it.
			// Two trash members still pair (they form a "trash cluster").
			if (trashSet && (trashSet.has(a) !== trashSet.has(b))) continue;
			if (log.enabled()) log.stage("matcher:before", { app: { name: a.name, path: a.path }, peer: { name: b.name, path: b.path } });
			const signals = matchSignals(a, b);
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
			const reason = f.test(match);
			if (reason) {
				hit = { match, filter: f.name, reason };
				break;
			}
		}
		if (hit) {
			dropped.push(hit);
			if (log.enabled()) log.stage("filter:after", { app: { name: match.app.name, path: match.app.path }, canon: { name: match.canon.name, path: match.canon.path }, outcome: "dropped", filter: hit.filter, reason: hit.reason });
		} else {
			kept.push(match);
			if (log.enabled()) log.stage("filter:after", { app: { name: match.app.name, path: match.app.path }, canon: { name: match.canon.name, path: match.canon.path }, outcome: "kept", confidence: match.decision.confidence });
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

const SIMILAR_FANOUT_CAP = 2;

// Fanout is capped per distinct app function (path + name), not per name:
// same-named helpers in different files are different functions and must not
// spend each other's fanout budget.
const capSimilarFanout = (matches) => {
	const byApp = new Map();
	for (const m of matches) {
		if (m.decision.tier !== "similar") continue;
		const key = `${m.app.path}#${m.app.name}`;
		if (!byApp.has(key)) byApp.set(key, []);
		byApp.get(key).push(m);
	}
	const keep = new Set(matches.filter((m) => m.decision.tier !== "similar"));
	for (const group of byApp.values()) {
		group.sort((a, b) => b.decision.confidence - a.decision.confidence || a.canon.name.localeCompare(b.canon.name));
		for (const m of group.slice(0, SIMILAR_FANOUT_CAP)) keep.add(m);
	}
	return [...keep];
};

const SIZE_RATIO = 3;
const MIN_PART_CANON_NODES = 1;

const sizeOf = (item) => item.nodeCount || 0;

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
		parts = parseParts(file, { requireExported: config.requireExported });
	} catch (err) {
		console.warn(`[utils-uniqueness] could not parse parts of ${rel}: ${err && err.message ? err.message : err}`);

		return [];
	}
	const found = [];
	for (const part of parts) {
		const pool = comparableCanons(part, canonUtils);
		if (pool.length === 0) continue;
		const candidate = { ...buildPartCandidate(part, config), path: rel };
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
		console.log(`[utils-uniqueness] ${label}: ${((Date.now() - started) / 1000).toFixed(1)}s, heap ${Math.round(process.memoryUsage().heapUsed / 1048576)} MB`);
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
	const appFiles = collectFiles(args.appRoots || ["."], repoRoot, appShouldSkip, exts, ignoreDirs);
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
	};
};

const main = async () => {
	const args = parseArgs(process.argv.slice(2));
	const cwd = process.cwd();

	const loaded = await loadRuleOptions(cwd, args.configFile);
	const configOptions = loaded ? { ...loaded.options } : {};
	if (loaded) {
		console.log(`[utils-uniqueness] config from ${loaded.source}`);
	} else if (!args.configFile) {
		console.log("[utils-uniqueness] no rule options found in eslint.config.js / md-code-utils-uniqueness.config.js; using defaults");
	}
	if (args.ignoreDirs) {
		const base = Array.isArray(configOptions.ignoreDirs) ? configOptions.ignoreDirs : [];
		configOptions.ignoreDirs = [...new Set([...base, ...args.ignoreDirs])];
	}

	const config = normalizeOptions(configOptions);
	if (args.include) config.include = [...new Set([...(config.include || []), ...args.include])];
	if (args.thresholds) config.thresholds = { ...(config.thresholds || {}), ...args.thresholds };
	if (args.parts) config.parts = true;
	if (args.proposeUtils) config.proposeUtils = true;
	if (args.log) log.enable(args.log);
	await whenReady(config);
	const rootMarkers = config.rootMarkers;
	const repoRoot = args.repoRoot ? path.resolve(cwd, args.repoRoot) : findRepoRoot(cwd, rootMarkers) || cwd;

	const configRoots = (config.utilsFolder || []).map((d) => String(d).replace(/\\/g, "/").replace(/\/+$/, ""));
	const roots = args.roots || configRoots;
	if (!roots || roots.length === 0) {
		fail("no scan roots: pass --roots <dir1>:<dir2> or set utilsFolder in the rule options (eslint.config.js / md-code-utils-uniqueness.config.js)");
	}
	if (!config.utilsFolder || config.utilsFolder.length === 0) {
		config.utilsFolder = roots;
	}

	const outPath = resolveAgainst(args.out || config.catalogPath, repoRoot);
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
			fail(`catalog is out of date (${final.length} util(s) expected at ${path.relative(repoRoot, outPath)}); regenerate it (node main.js)`);
		}
		console.log(`[utils-uniqueness] catalog up to date (${final.length} util(s))`);
		return;
	}

	writeCatalog(outPath, final);
	console.log(`[utils-uniqueness] wrote ${path.relative(repoRoot, outPath)} (${final.length} util(s), ${canonFiles.length} file(s) scanned)`);

	if (args.report) {
		const reportPath = path.isAbsolute(args.report) ? args.report : path.resolve(process.cwd(), args.report);
		const comp = await buildUtilsReport(args, repoRoot, roots, config, registry, catalogUtils);
		const md = renderUtilsReport(comp, args.verbose);
		fs.mkdirSync(path.dirname(reportPath), { recursive: true });
		fs.writeFileSync(reportPath, md, "utf8");
		console.log(`[utils-uniqueness] wrote report ${reportPath}`);
	}
	log.flush();
};

const run = () =>
	main().catch((err) => {
		console.error(`[utils-uniqueness] ${err && err.stack ? err.stack : err}`);
		process.exit(1);
	});

module.exports = { parseArgs, collectFiles, parseUtils, matchPairs, matchAppPairs, applyFilters, dedupPairs, capSimilarFanout, findParts, buildUtilsReport, stageLog, appPairSizeComparable, run };

if (require.main === module) {
	run();
}
