"use strict";

const path = require("node:path");
const { minimatch } = require("minimatch");
const { findRepoRoot } = require("./debt");
const { map } = require("remeda");

const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/dist/**", "**/build/**", ".git/**", "**/_medplum/**", "**/_db/**", "**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx", "**/*.stories.tsx", "**/*.stories.ts"];

const resolveDataPath = (value, root) => {
	if (path.isAbsolute(value)) return value;
	const base = root || process.cwd();
	return path.resolve(base, value);
};

const normalizeFolders = (folders) =>
	map(folders || [], (f) => {
		const raw = f && typeof f === "object" ? f.path : f;
		let s = String(raw).trim().split(path.sep).join("/");
		while (s.startsWith("./")) s = s.slice(2);
		if (!s.endsWith("/")) s += "/";
		return s;
	});

const normalizeOptions = (opts) => {
	const o = opts && typeof opts === "object" ? opts : {};
	const root = findRepoRoot(process.cwd());

	return {
		catalog: o.catalog || null,
		catalogPath: resolveDataPath(o.catalogPath || "reports/utils-catalog.json", root),
		utilsFolder: normalizeFolders(o.utilsFolder || []),
		include: o.include || [],
		exclude: o.exclude || DEFAULT_EXCLUDE,
		useJscpd: o.useJscpd !== false,
		jscpdMinTokens: typeof o.jscpdMinTokens === "number" ? o.jscpdMinTokens : 20,
		jscpdSimilarity: typeof o.jscpdSimilarity === "number" ? o.jscpdSimilarity : 0.7,
		debt: o.debt || null,
		root,
	};
};

const inFolder = (relPath, folders) => {
	const p = relPath.split(path.sep).join("/");
	for (const dir of folders) {
		if (p.startsWith(dir) || p === dir.slice(0, -1)) return true;
	}
	return false;
};

const isIgnored = (relPath, include, exclude) => {
	const p = relPath.split(path.sep).join("/");
	for (const pat of exclude || []) {
		if (minimatch(p, pat)) return true;
	}
	if (include && include.length) {
		return !include.some((pat) => minimatch(p, pat));
	}
	return false;
};

module.exports = {
	normalizeOptions,
	normalizeFolders,
	inFolder,
	isIgnored,
	resolveDataPath,
	DEFAULT_EXCLUDE,
};
