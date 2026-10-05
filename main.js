#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { pipe, map, filter, concat } = require("remeda");

const { findRepoRoot, isIgnored, DEFAULT_EXCLUDE, loadRuleOptions } = require("./config");
const { resolveThresholds } = require("./thresholds");
const { extractFromFiles } = require("./ast");
const { match } = require("./matcher/cluster");
const { minBodyTokensFilter } = require("./filter/min-body-tokens");
const { runJscpd, toPairRefs } = require("./jscpd");
const { walk, dedupeAndSort, slimRecord, writeCatalog } = require("./utils");
const { renderDuplicateReport } = require("./report");

const fail = (message) => {
	console.error(`[utils-uniqueness] ${message}`);
	process.exit(1);
};

const parseArgs = (argv) => {
	const cfg = { roots: null, out: null, repoRoot: null, appRoots: null, check: false, report: null, useJscpd: true, forceJscpd: false, verbose: false };
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i];
		if (a === "--check") {
			cfg.check = true;
		} else if (a === "--jscpd") {
			cfg.forceJscpd = true;
		} else if (a === "--no-jscpd") {
			cfg.useJscpd = false;
		} else if (a === "--report") {
			const next = argv[i + 1];
			if (next && !next.startsWith("--")) cfg.report = argv[++i];
			else cfg.report = true;
		} else if (a === "--roots") {
			if (!argv[i + 1]) fail("--roots requires a value (colon-separated list of directories)");
			cfg.roots = pipe(argv[++i].split(":"), filter(Boolean));
		} else if (a === "--out") {
			if (!argv[i + 1]) fail("--out requires a value");
			cfg.out = argv[++i];
		} else if (a === "--repo-root") {
			if (!argv[i + 1]) fail("--repo-root requires a value");
			cfg.repoRoot = argv[++i];
		} else if (a === "--app-roots") {
			if (!argv[i + 1]) fail("--app-roots requires a value (colon-separated list of directories)");
			cfg.appRoots = pipe(argv[++i].split(":"), filter(Boolean));
		} else if (a === "--verbose") {
			cfg.verbose = true;
		} else if (a === "--help" || a === "-h") {
			console.log("Usage: md-code-utils-uniqueness [--roots dir1:dir2] [--out catalog.json] [--report [file]] [--check] [--jscpd] [--no-jscpd] [--verbose]");
			console.log("Scans for duplicate utility functions → catalog + reports/utils-duplicates.md.");
			console.log("Scan roots come from --roots or the rule options (utilsFolder) in eslint.config.js / md-code-utils-uniqueness.config.js.");
			process.exit(0);
		} else {
			fail(`unknown argument: ${a} (see --help)`);
		}
	}
	return cfg;
};

const resolveAgainst = (value, repoRoot) => (path.isAbsolute(value) ? value : path.resolve(repoRoot, value));

const normalize = (s) => String(s).replace(/\\/g, "/").replace(/\/+$/, "");

const main = async () => {
	const args = parseArgs(process.argv.slice(2));
	const cwd = process.cwd();

	const loaded = args.roots ? null : loadRuleOptions(cwd);
	const configOptions = loaded ? loaded.options : {};
	if (loaded) {
		console.log(`[utils-uniqueness] config from ${loaded.source}`);
	}

	const opts = { ...configOptions, root: args.repoRoot ? path.resolve(cwd, args.repoRoot) : undefined };
	const repoRoot = args.repoRoot ? path.resolve(cwd, args.repoRoot) : findRepoRoot(cwd, opts.rootMarkers) || cwd;
	const thresholds = resolveThresholds(configOptions);
	const exts = Array.isArray(configOptions.exts) && configOptions.exts.length > 0 ? configOptions.exts : [".ts", ".tsx", ".js", ".jsx"];
	const ignoreDirs = Array.isArray(configOptions.ignoreDirs) && configOptions.ignoreDirs.length > 0 ? configOptions.ignoreDirs : ["node_modules", "dist", "build"];

	const configRoots = pipe(
		configOptions.utilsFolder || [],
		map((d) => (d && typeof d === "object" ? d.path : d)),
		map(normalize),
	);
	const roots = args.roots || configRoots;
	if (!roots || roots.length === 0) {
		fail("no scan roots: pass --roots <dir1>:<dir2> or set utilsFolder in the rule options (eslint.config.js / md-code-utils-uniqueness.config.js)");
	}

	const outPath = resolveAgainst(args.out || configOptions.catalogPath || "reports/utils-catalog.json", repoRoot);
	const include = configOptions.include || [];
	const exclude = configOptions.exclude && configOptions.exclude.length > 0 ? configOptions.exclude : DEFAULT_EXCLUDE;
	const shouldSkip = (abs) => isIgnored(path.relative(repoRoot, abs).split(path.sep).join("/"), include, exclude);

	const files = [];
	for (const relRoot of roots) {
		const rootDir = resolveAgainst(relRoot, repoRoot);
		if (!fs.existsSync(rootDir)) {
			fail(`scan root does not exist: ${relRoot}`);
		}
		for (const file of walk(rootDir, exts, ignoreDirs)) {
			if (shouldSkip(file)) continue;
			files.push(file);
		}
	}
	if (args.verbose) {
		console.log(`[utils-uniqueness] ${files.length} file(s) to extract`);
	}
	const records = minBodyTokensFilter(extractFromFiles(files, { requireExported: thresholds.requireExported }), thresholds);
	if (args.verbose) {
		console.log(`[utils-uniqueness] ${records.length} utility function(s) extracted`);
	}

	let jscpdPairs = [];
	const jscpdOn = (thresholds.jscpd && thresholds.jscpd.enabled) || args.forceJscpd;
	if (jscpdOn && args.useJscpd) {
		const appRoots = pipe(args.appRoots || configOptions.appRoots || [], map((d) => resolveAgainst(d, repoRoot)));
		const jscpdRoots = [...new Set([...pipe(roots, map((d) => resolveAgainst(d, repoRoot))), ...appRoots])];
		try {
			let cloneCount = 0;
			for (const jroot of jscpdRoots) {
				const clones = await runJscpd({
					root: jroot,
					minTokens: thresholds.jscpd.minTokens,
					similarity: thresholds.jscpd.similarity,
					minLines: thresholds.jscpd.minLines,
					mode: thresholds.jscpd.mode,
					timeoutMs: thresholds.jscpd.timeoutMs,
				});
				cloneCount += clones.length;
				jscpdPairs = concat(jscpdPairs, toPairRefs(clones, jroot));
			}
			if (args.verbose) {
				console.log(`[utils-uniqueness] jscpd: ${cloneCount} raw clone(s)`);
			}
		} catch (e) {
			console.error(`[utils-uniqueness] jscpd source failed (continuing without it): ${e.message}`);
		}
	}

	const { clusters } = match(records, thresholds, jscpdPairs);
	if (args.verbose) {
		console.log(`[utils-uniqueness] ${clusters.length} duplicate cluster(s)`);
	}

	const catalog = {
		version: 1,
		roots: pipe(roots, map(normalize)),
		repoRoot: repoRoot.split(path.sep).join("/"),
		functions: pipe(dedupeAndSort(records), map((r) => slimRecord(r, repoRoot))),
		clusters: pipe(
			clusters,
			map((c) => ({
				canonical: slimRecord(c.canonical, repoRoot),
				members: pipe(c.members, map((m) => slimRecord(m, repoRoot))),
				tier: c.tier,
			})),
		),
	};

	if (args.check) {
		let current = null;
		try {
			current = JSON.parse(fs.readFileSync(outPath, "utf8"));
		} catch {
			current = null;
		}
		const same =
			current &&
			JSON.stringify(current.functions || []) === JSON.stringify(catalog.functions) &&
			JSON.stringify(current.clusters || []) === JSON.stringify(catalog.clusters);
		if (!same) {
			fail(`catalog is out of date (${catalog.functions.length} function(s), ${catalog.clusters.length} cluster(s) at ${path.relative(repoRoot, outPath)}); regenerate it (node main.js)`);
		}
		console.log(`[utils-uniqueness] catalog up to date (${catalog.functions.length} function(s), ${catalog.clusters.length} cluster(s))`);
		return;
	}

	writeCatalog(outPath, catalog);
	console.log(`[utils-uniqueness] wrote ${path.relative(repoRoot, outPath)} (${catalog.functions.length} function(s), ${catalog.clusters.length} cluster(s), ${files.length} file(s) scanned)`);

	if (args.report) {
		const dupReportPath = args.report === true ? "reports/utils-duplicates.md" : args.report;
		const reportPath = path.isAbsolute(dupReportPath) ? dupReportPath : path.resolve(cwd, dupReportPath);
		fs.mkdirSync(path.dirname(reportPath), { recursive: true });
		fs.writeFileSync(reportPath, renderDuplicateReport({ clusters, repoRoot, roots: catalog.roots }), "utf8");
		console.log(`[utils-uniqueness] wrote report ${reportPath} (${clusters.length} cluster(s))`);
	}
};

main().catch((e) => fail(e.stack || e.message));
