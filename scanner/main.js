#!/usr/bin/env node
"use strict";

/**
 * scanner/main.js
 *
 * Orchestrator: scans the utils roots, extracts utility functions, runs the
 * jscpd raw-clone source, matches everything into duplicate clusters, and
 * writes the catalog JSON that the ESLint rule matches app-code against.
 *
 * Usage:
 *   node scanner/main.js [options]
 *
 * Options:
 *   --roots <dir>[:<dir>...]   REQUIRED (unless config provides utilsFolder).
 *                              Utils directories to catalog (repo-relative or
 *                              absolute).
 *   --out <file>               output path. Default: reports/utils-catalog.json
 *   --repo-root <dir>          repo root. Default: discovered by walking up.
 *   --app-roots <dir>[:<dir>]  extra roots for the jscpd pass only. Default:
 *                              the repo root.
 *   --no-jscpd                 skip the jscpd raw-clone source.
 *   --check                    do not write; exit 1 when the catalog would
 *                              change (for CI gates).
 *   --report [file]            write the Markdown duplicate report. With a
 *                              value: that path. Without:
 *                              reports/utils-duplicates.md
 *   --verbose                  log per-file record counts.
 */

const fs = require("node:fs");
const path = require("node:path");

const { findRepoRoot } = require("../debt");
const { isIgnored, DEFAULT_EXCLUDE } = require("../config");
const { resolveThresholds } = require("../thresholds");
const { loadRuleOptions } = require("./load-config");
const { walk } = require("./walk");
const { extractFromFiles } = require("../extract");
const { match } = require("../matching");
const { runJscpd, toPairRefs } = require("./jscpd");
const { dedupeAndSort, slimRecord, writeCatalog } = require("./output");
const { renderDuplicateReport } = require("../report");

function fail(message) {
	// eslint-disable-next-line no-console
	console.error(`[utils-uniqueness] ${message}`);
	process.exit(1);
}

/**
 * Parse command-line arguments.
 *
 * @param {string[]} argv process.argv.slice(2)
 * @returns {object}
 */
function parseArgs(argv) {
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
			cfg.roots = argv[++i].split(":").filter(Boolean);
		} else if (a === "--out") {
			if (!argv[i + 1]) fail("--out requires a value");
			cfg.out = argv[++i];
		} else if (a === "--repo-root") {
			if (!argv[i + 1]) fail("--repo-root requires a value");
			cfg.repoRoot = argv[++i];
		} else if (a === "--app-roots") {
			if (!argv[i + 1]) fail("--app-roots requires a value (colon-separated list of directories)");
			cfg.appRoots = argv[++i].split(":").filter(Boolean);
		} else if (a === "--verbose") {
			cfg.verbose = true;
		} else if (a === "--help" || a === "-h") {
			// eslint-disable-next-line no-console
			console.log("Usage: md-code-utils-uniqueness [--report file.md] [--jscpd] [--no-jscpd] [--verbose]");
			// eslint-disable-next-line no-console
			console.log("Scans for duplicate utility functions → reports/utils-duplicates.md.");
			// eslint-disable-next-line no-console
			console.log("Scan roots come from the consumer's eslint.config.js (rule md-code/utils-uniqueness) or md-code-utils-uniqueness.config.js.");
			process.exit(0);
		} else {
			fail(`unknown argument: ${a} (see --help)`);
		}
	}
	return cfg;
}

/** Resolve a possibly-relative path against the repo root. */
function resolveAgainst(value, repoRoot) {
	return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const cwd = process.cwd();

	const loaded = args.roots ? null : await loadRuleOptions(cwd);
	const configOptions = loaded ? loaded.options : {};
	if (loaded) {
		// eslint-disable-next-line no-console
		console.log(`[utils-uniqueness] config from ${loaded.source}`);
	}

	const repoRoot = args.repoRoot ? path.resolve(cwd, args.repoRoot) : findRepoRoot(cwd) || cwd;
	const thresholds = resolveThresholds(configOptions);

	const configRoots = (configOptions.utilsFolder || []).map((d) => (d && typeof d === "object" ? d.path : d)).map((d) => String(d).replace(/\\/g, "/").replace(/\/+$/, ""));
	const roots = args.roots || configRoots;
	if (!roots || roots.length === 0) {
		fail("no scan roots: pass --roots <dir1>:<dir2> or set utilsFolder in the rule options (eslint.config.js / md-code-utils-uniqueness.config.js)");
	}

	const outPath = resolveAgainst(args.out || configOptions.catalogPath || "reports/utils-catalog.json", repoRoot);
	const include = configOptions.include || [];
	const exclude = configOptions.exclude || DEFAULT_EXCLUDE;
	const shouldSkip = (abs) => isIgnored(path.relative(repoRoot, abs).split(path.sep).join("/"), include, exclude);


	// 1. Extract utility functions from the utils roots.
	const files = [];
	for (const relRoot of roots) {
		const rootDir = resolveAgainst(relRoot, repoRoot);
		if (!fs.existsSync(rootDir)) {
			fail(`scan root does not exist: ${relRoot}`);
		}
		for (const file of walk(rootDir)) {
			if (shouldSkip(file)) continue;
			files.push(file);
		}
	}
	if (args.verbose) {
		// eslint-disable-next-line no-console
		console.log(`[utils-uniqueness] ${files.length} file(s) to extract`);
	}
	const records = extractFromFiles(files, { requireExported: thresholds.requireExported });
	if (args.verbose) {
		// eslint-disable-next-line no-console
		console.log(`[utils-uniqueness] ${records.length} utility function(s) extracted`);
	}

	// 2. jscpd raw-clone source. Off by default (config `jscpd.enabled: false`);
	// enable with `jscpd: { enabled: true }` in the rule options or `--jscpd`.
	let jscpdPairs = [];
	const jscpdOn = (thresholds.jscpd && thresholds.jscpd.enabled) || args.forceJscpd;
	if (jscpdOn && args.useJscpd) {
		const appRoots = (args.appRoots || configOptions.appRoots || []).map((d) => resolveAgainst(d, repoRoot));
		const jscpdRoots = [...new Set([...roots.map((d) => resolveAgainst(d, repoRoot)), ...appRoots])];
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
				jscpdPairs = jscpdPairs.concat(toPairRefs(clones, jroot));
			}
			if (args.verbose) {
				// eslint-disable-next-line no-console
				console.log(`[utils-uniqueness] jscpd: ${cloneCount} raw clone(s)`);
			}
		} catch (e) {
			// eslint-disable-next-line no-console
			console.error(`[utils-uniqueness] jscpd source failed (continuing without it): ${e.message}`);
		}
	}

	// 3. Match into clusters.
	const { clusters } = match(records, thresholds, jscpdPairs);
	if (args.verbose) {
		// eslint-disable-next-line no-console
		console.log(`[utils-uniqueness] ${clusters.length} duplicate cluster(s)`);
	}

	// 4. Build the catalog.
	const catalog = {
		version: 1,
		generatedAt: new Date().toISOString(),
		roots: roots.map((d) => String(d).replace(/\\/g, "/").replace(/\/+$/, "")),
		repoRoot: repoRoot.split(path.sep).join("/"),
		functions: dedupeAndSort(records).map((r) => slimRecord(r, repoRoot)),
		clusters: clusters.map((c) => ({
			canonical: slimRecord(c.canonical, repoRoot),
			members: c.members.map((m) => slimRecord(m, repoRoot)),
			tier: c.tier,
		})),
	};

	// 5. Check mode or write.
	if (args.check) {
		let current = null;
		try {
			current = JSON.parse(fs.readFileSync(outPath, "utf8"));
		} catch {
			// missing catalog — a change
		}
		const same =
			current &&
			JSON.stringify(current.functions || []) === JSON.stringify(catalog.functions) &&
			JSON.stringify(current.clusters || []) === JSON.stringify(catalog.clusters);
		if (!same) {
			fail(`catalog is out of date (${catalog.functions.length} function(s), ${catalog.clusters.length} cluster(s) at ${path.relative(repoRoot, outPath)}); regenerate it (node scanner/main.js)`);
		}
		// eslint-disable-next-line no-console
		console.log(`[utils-uniqueness] catalog up to date (${catalog.functions.length} function(s), ${catalog.clusters.length} cluster(s))`);
		return;
	}

	writeCatalog(outPath, catalog);
	// eslint-disable-next-line no-console
	console.log(`[utils-uniqueness] wrote ${path.relative(repoRoot, outPath)} (${catalog.functions.length} function(s), ${catalog.clusters.length} cluster(s), ${files.length} file(s) scanned)`);

	const dupReportPath = args.report === true || !args.report ? "reports/utils-duplicates.md" : args.report;
	const reportPath = path.isAbsolute(dupReportPath) ? dupReportPath : path.resolve(cwd, dupReportPath);
	fs.mkdirSync(path.dirname(reportPath), { recursive: true });
	fs.writeFileSync(reportPath, renderDuplicateReport({ clusters, repoRoot, roots: catalog.roots }), "utf8");
	// eslint-disable-next-line no-console
	console.log(`[utils-uniqueness] wrote report ${reportPath} (${clusters.length} cluster(s))`);
}

main().catch((e) => fail(e.stack || e.message));
