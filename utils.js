"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pipe, map, sort, uniqueBy, filter } = require("remeda");

const walk = (dir, exts, ignoreDirs) => {
	const extSet = new Set(exts);
	const ignoreSet = new Set(ignoreDirs);
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const files = filter(entries, (e) => e.isFile() && extSet.has(path.extname(e.name))).map((e) => path.join(dir, e.name));
	const dirs = filter(entries, (e) => e.isDirectory() && !ignoreSet.has(e.name) && !e.name.startsWith(".")).map((e) => walk(path.join(dir, e.name), exts, ignoreDirs));
	return [...files, ...dirs.flat()];
};

const slimRecord = (rec, repoRoot) => {
	const p = path.isAbsolute(rec.path) && repoRoot ? path.relative(repoRoot, rec.path) : rec.path;
	const { bodyTokens, ...rest } = rec;
	return { ...rest, path: p.split(path.sep).join("/") };
};

const dedupeAndSort = (records) =>
	pipe(
		records,
		uniqueBy((r) => `${r.path}|${r.line}|${r.name}`),
		sort((a, b) => (a.path !== b.path ? (a.path < b.path ? -1 : 1) : a.line !== b.line ? a.line - b.line : a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
	);

const writeCatalog = (outPath, catalog) => {
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2) + "\n", "utf8");
};

module.exports = { walk, slimRecord, dedupeAndSort, writeCatalog };
