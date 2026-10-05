"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { minimatch } = require("minimatch");

const RULE_ID = "utils-uniqueness";

const DEFAULT_EXCLUDE = [
	"**/*.test.*",
	"**/*.spec.*",
	"**/*.stories.*",
	"**/__tests__/**",
	"**/node_modules/**",
	"**/dist/**",
	"**/build/**",
	"**/.git/**",
];

const DEFAULT_EXTS = [".ts", ".tsx", ".js", ".jsx"];
const DEFAULT_IGNORE_DIRS = ["node_modules", "dist", "build"];
const DEFAULT_ROOT_MARKERS = [".git"];

const resolveDataPath = (raw, root) => {
	if (path.isAbsolute(raw)) return raw;
	return path.join(root, raw);
};

const normalizeFolders = (raw, root) => {
	if (!raw) return [];
	const list = Array.isArray(raw) ? raw : [raw];
	return list
		.map((f) => (typeof f === "string" ? { path: f } : f))
		.filter(Boolean)
		.map((f) => ({ path: path.isAbsolute(f.path) ? f.path : path.join(root, f.path) }));
};

const isIgnored = (rel, include, exclude) => {
	const norm = rel.split(path.sep).join("/");
	if (include && include.length > 0) {
		if (!include.some((p) => minimatch(norm, p))) return true;
	}
	if (exclude && exclude.length > 0) {
		if (exclude.some((p) => minimatch(norm, p))) return true;
	}
	return false;
};

const findRepoRoot = (startDir, markers) => {
	const list = markers && markers.length > 0 ? markers : DEFAULT_ROOT_MARKERS;
	let dir = path.resolve(startDir);
	for (;;) {
		if (list.some((m) => fs.existsSync(path.join(dir, m)))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) return path.resolve(startDir);
		dir = parent;
	}
};

const normalizeOptions = (rawOpts, cwd) => {
	const opts = rawOpts && typeof rawOpts === "object" ? rawOpts : {};
	const root = opts.root ? path.resolve(opts.root) : findRepoRoot(cwd || process.cwd(), opts.rootMarkers);
	const catalogPath = opts.catalogPath || opts.catalog || "reports/utils-catalog.json";
	const folders = normalizeFolders(opts.utilsFolder, root);
	return {
		root,
		folders,
		catalogPath,
		include: Array.isArray(opts.include) ? opts.include : [],
		exclude: Array.isArray(opts.exclude) && opts.exclude.length > 0 ? opts.exclude : DEFAULT_EXCLUDE,
		useJscpd: opts.useJscpd === true,
		debt: opts.debt === undefined ? true : opts.debt,
		exts: Array.isArray(opts.exts) && opts.exts.length > 0 ? opts.exts : DEFAULT_EXTS,
		ignoreDirs: Array.isArray(opts.ignoreDirs) && opts.ignoreDirs.length > 0 ? opts.ignoreDirs : DEFAULT_IGNORE_DIRS,
		rootMarkers: Array.isArray(opts.rootMarkers) ? opts.rootMarkers : DEFAULT_ROOT_MARKERS,
	};
};

const tryLoadIn = (dir) => {
	const candidates = [
		path.join(dir, "md-code-utils-uniqueness.config.js"),
		path.join(dir, "eslint.config.js"),
		path.join(dir, "eslint.config.mjs"),
		path.join(dir, "eslint.config.cjs"),
		path.join(dir, "eslint.config.ts"),
		path.join(dir, ".eslintrc.js"),
		path.join(dir, ".eslintrc.cjs"),
		path.join(dir, ".eslintrc.json"),
	];
	for (const file of candidates) {
		if (!fs.existsSync(file)) continue;
		try {
			const mod = require(file);
			const cfg = mod && mod.config ? mod.config : mod;
			if (!cfg) continue;
			if (Array.isArray(cfg)) {
				for (const entry of cfg) {
					if (!entry || typeof entry !== "object") continue;
					const rules = entry.rules || {};
					const val = rules[RULE_ID];
					if (Array.isArray(val) && val[1] && typeof val[1] === "object") return { options: val[1], source: file };
					if (val && typeof val === "object") return { options: val, source: file };
				}
				continue;
			}
			if (cfg.rules && cfg.rules[RULE_ID]) {
				const val = cfg.rules[RULE_ID];
				if (Array.isArray(val) && val[1] && typeof val[1] === "object") return { options: val[1], source: file };
				if (val && typeof val === "object") return { options: val, source: file };
			}
		} catch {
			continue;
		}
	}
	return null;
};

const loadRuleOptions = (cwd) => {
	const root = findRepoRoot(cwd || process.cwd());
	let dir = root;
	for (;;) {
		const found = tryLoadIn(dir);
		if (found) return found;
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
};

module.exports = { RULE_ID, DEFAULT_EXCLUDE, DEFAULT_EXTS, DEFAULT_IGNORE_DIRS, DEFAULT_ROOT_MARKERS, resolveDataPath, normalizeFolders, normalizeOptions, isIgnored, findRepoRoot, loadRuleOptions };
