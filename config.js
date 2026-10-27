"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { minimatch } = require("minimatch");

const DEFAULT_EXTS = [".ts", ".tsx", ".js", ".jsx"];
// "out" is the default VS Code extension build dir (vsce pack / F5); "coverage"
// is the standard test-output dir. The walker does not read .gitignore, so
// common build-artifact names must be listed here explicitly.
const DEFAULT_IGNORE_DIRS = ["node_modules", "dist", "build", "out", "coverage"];
const DEFAULT_ROOT_MARKERS = [".git"];

// Test files are not production utils: scanning them recommends "extract to
// shared util" for test helpers (seedPatient ×3, row ×3, …) — pure noise in
// every report. Excluded by default, always: the defaults are prepended to
// any consumer-provided exclude list, so they cannot be turned off without a
// code change.
//
// Storybook files (*.stories.tsx) are demo/prototype code: full of play()
// functions, inline render callbacks and one-liner filters that match
// canonical utils at 0.70–0.72 — hundreds of noise rows in every report.
// Same treatment as tests.
//
// Files inside an `e2e/` directory are end-to-end test code regardless of
// their filename (e.g. `core/e2e/coverage.ts` is not named *.e2e.*). Excluded
// like other test code.
const DEFAULT_TEST_EXCLUDES = ["**/*.test.*", "**/*.spec.*", "**/*.e2e.*", "**/*.stories.*", "**/e2e/**"];

// A package.json without a marker (the tool's own dir) is NOT the repo root —
// keep walking up until a marker dir is found, no matter how many nested
// package.json dirs sit between startDir and the repo root.
const findRepoRoot = (startDir, markers = DEFAULT_ROOT_MARKERS) => {
	const markerSet = new Set(markers);
	let dir = path.resolve(startDir);
	for (;;) {
		if (fs.existsSync(dir) && fs.readdirSync(dir).some((name) => markerSet.has(name))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
};

// The tool can live in its OWN git repo (a nested .git), so walking up from the
// cwd finds the tool's root, not the consumer project's. When a config file is
// loaded, that file sits in the consumer's tree — anchor on its directory first,
// then fall back to the cwd. An explicit --repo-root always wins.
const pickRepoRoot = ({ cwd, configSource = null, explicitRepoRoot = null, rootMarkers = DEFAULT_ROOT_MARKERS } = {}) => {
	if (explicitRepoRoot) return path.resolve(cwd, explicitRepoRoot);
	const anchors = [];
	if (configSource) anchors.push(path.dirname(path.resolve(configSource)));
	anchors.push(cwd);
	for (const anchor of anchors) {
		const found = findRepoRoot(anchor, rootMarkers);
		if (found) return found;
	}
	return cwd;
};

const normalizeFolders = (folders) => {
	return (folders || []).map((f) => {
		const raw = f && typeof f === "object" ? f.path : f;
		let s = String(raw).trim().split(path.sep).join("/");
		while (s.startsWith("./")) s = s.slice(2);
		if (!s.endsWith("/")) s += "/";
		return s;
	});
};

const normalizeOptions = (opts) => {
	const o = opts && typeof opts === "object" ? opts : {};
	const rootMarkers = o.rootMarkers || DEFAULT_ROOT_MARKERS;
	const root = o.root || findRepoRoot(process.cwd(), rootMarkers);

	return {
		root,
		registry: o.registry || null,
		registryPath: o.registryPath || "reports/utils-registry.json",
		catalog: o.catalog || null,
		catalogPath: o.catalogPath || "reports/utils-catalog.json",
		parts: o.parts === true,
		weights: o.weights && typeof o.weights === "object" ? o.weights : null,
		thresholds: o.thresholds && typeof o.thresholds === "object" ? o.thresholds : null,
		utilsFolder: normalizeFolders(o.utilsFolder || []),
		include: o.include || [],
		exclude: [...DEFAULT_TEST_EXCLUDES, ...(o.exclude || [])],
		exts: o.exts || DEFAULT_EXTS,
		ignoreDirs: o.ignoreDirs ? [...new Set([...DEFAULT_IGNORE_DIRS, ...o.ignoreDirs])] : DEFAULT_IGNORE_DIRS,
		rootMarkers,
		proposeUtils: o.proposeUtils === true,
		compareAll: o.compareAll === true,
		proposeFromLib: o.proposeFromLib === true,
		cache: o.cache !== false,
	};
};

const inUtilsFolder = (relPath, utilsFolder) => {
	return utilsFolder.some((d) => relPath.startsWith(d));
};

const layerOf = (relPath, utilsFolder) => {
	return utilsFolder.findIndex((d) => relPath.startsWith(d));
};

const canSeeCanon = (appPath, canonPath, utilsFolder, compareAll = false) => {
	// compareAll mode: every file sees every canon in the catalog, so a
	// single-layer utilsFolder (all files in layer 0) still flags duplicates.
	if (compareAll) return true;
	const appLayer = layerOf(appPath, utilsFolder);

	return appLayer < 0 || layerOf(canonPath, utilsFolder) < appLayer;
};

const inCanonicalDir = (relPath, dirs) => {
	return dirs.some((d) => relPath === d || relPath.startsWith(d + "/"));
};

const compileMatcher = (pattern) => {
	if (pattern instanceof RegExp) return (p) => pattern.test(p);
	if (typeof pattern !== "string" || pattern.length === 0) return null;
	if (pattern.startsWith("/") && pattern.endsWith("/") && pattern.length > 2) {
		try {
			const re = new RegExp(pattern.slice(1, -1));
			return (p) => re.test(p);
		} catch {
			return null;
		}
	}
	if (pattern.startsWith("^") && pattern.endsWith("$")) {
		try {
			const re = new RegExp(pattern);
			return (p) => re.test(p);
		} catch {
			return null;
		}
	}
	return (p) => minimatch(p, pattern);
};

const matchesPath = (m, relPath) => {
	if (m(relPath)) return true;
	const base = relPath.slice(relPath.lastIndexOf("/") + 1);
	return base !== relPath && m(base);
};

const isIgnored = (relPath, include, exclude) => {
	for (const pattern of exclude || []) {
		const m = compileMatcher(pattern);
		if (m && matchesPath(m, relPath)) return true;
	}
	if (include && include.length > 0) {
		return !include.some((pattern) => {
			const m = compileMatcher(pattern);
			return m ? matchesPath(m, relPath) : false;
		});
	}
	return false;
};

const RULE_NAME = "md-code/utils-uniqueness";
const RULE_SHORT = "md-code";

const FLAT_CANDIDATES = ["md-code-utils-uniqueness.config.js", "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts"];
const LEGACY_CANDIDATES = [".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ".eslintrc.yaml", ".eslintrc.yml"];

const loadModule = (file) => {
	const src = fs.readFileSync(file, "utf8");
	if (file.endsWith(".json")) return Promise.resolve(JSON.parse(src));
	if (/^\s*(exports?\s+(default|const|let|var)|import\s)/m.test(src)) {
		const { pathToFileURL } = require("node:url");
		return import(pathToFileURL(file).href).catch((esmErr) => {
			try {
				return require(file);
			} catch {
				throw esmErr;
			}
		});
	}
	return Promise.resolve().then(() => require(file));
};

const pickOptions = (v) => {
	if (v === undefined || v === null) return null;
	if (Array.isArray(v)) return v[1] && typeof v[1] === "object" ? v[1] : {};
	if (typeof v === "object") return v;
	return {};
};

const isRuleKey = (key) => typeof key === "string" && (key === RULE_NAME || key === RULE_SHORT || key === "utils-uniqueness" || key.endsWith("/utils-uniqueness"));

const ruleValue = (rules) => {
	for (const [key, v] of Object.entries(rules)) {
		if (!isRuleKey(key)) continue;
		if (v === undefined || v === null) continue;
		return v;
	}
	return null;
};

const pluginRuleValue = (plugins) => {
	for (const plugin of Object.values(plugins || {})) {
		if (!plugin || typeof plugin !== "object") continue;
		const v = ruleValue(plugin.rules || {});
		if (v !== null && v !== undefined) return v;
	}
	return null;
};

const loadFlatOptions = async (file) => {
	const mod = await loadModule(file);
	const list = mod && mod.default !== undefined ? mod.default : mod;
	if (!Array.isArray(list)) return null;
	for (const entry of list) {
		if (!entry || typeof entry !== "object") continue;
		const v = (entry.rules && ruleValue(entry.rules)) || (entry.plugins && pluginRuleValue(entry.plugins)) || null;
		if (v === undefined || v === null) continue;
		return pickOptions(v);
	}
	return null;
};

const loadLegacyOptions = async (file) => {
	const mod = await loadModule(file);
	const v = ruleValue((mod && mod.rules) || {});
	return v === undefined || v === null ? null : pickOptions(v);
};

const loadRuleOptions = async (dir, explicitFile = null) => {
	if (explicitFile) {
		const file = path.isAbsolute(explicitFile) ? explicitFile : path.resolve(dir, explicitFile);
		if (!fs.existsSync(file)) return null;
		const mod = await loadModule(file);
		const list = mod && mod.default !== undefined ? mod.default : mod;
		if (Array.isArray(list)) {
			const opts = await loadFlatOptions(file);
			return opts ? { options: opts, source: file } : null;
		}
		const opts = pickOptions(ruleValue((mod && mod.rules) || {}) || mod);
		return opts ? { options: opts, source: file } : null;
	}

	const candidates = [...FLAT_CANDIDATES, ...LEGACY_CANDIDATES];
	for (const name of candidates) {
		const file = path.join(dir, name);
		if (!fs.existsSync(file)) continue;
		try {
			const opts = LEGACY_CANDIDATES.includes(name) ? await loadLegacyOptions(file) : await loadFlatOptions(file);
			if (opts) return { options: opts, source: file };
		} catch {
			continue;
		}
	}
	return null;
};

const loadJson = (file) => {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		console.warn(`[utils-uniqueness] could not read ${file}`);
		return null;
	}
};

const loadRegistry = (config) => {
	if (config.registry) return loadJson(config.registry);
	if (config.registryPath) {
		const file = path.isAbsolute(config.registryPath) ? config.registryPath : path.join(config.root, config.registryPath);
		if (fs.existsSync(file)) return loadJson(file);
	}
	return null;
};

const loadCatalog = (config) => {
	if (config.catalog) return loadJson(config.catalog);
	if (config.catalogPath) {
		const file = path.isAbsolute(config.catalogPath) ? config.catalogPath : path.join(config.root, config.catalogPath);
		if (fs.existsSync(file)) return loadJson(file);
	}
	return null;
};

module.exports = {
	RULE_NAME,
	DEFAULT_EXTS,
	DEFAULT_IGNORE_DIRS,
	DEFAULT_ROOT_MARKERS,
	findRepoRoot,
	pickRepoRoot,
	normalizeFolders,
	normalizeOptions,
	inUtilsFolder,
	canSeeCanon,
	inCanonicalDir,
	isIgnored,
	loadRuleOptions,
	loadRegistry,
	loadCatalog,
	loadJson,
};
