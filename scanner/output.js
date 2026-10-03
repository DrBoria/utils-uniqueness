"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { uniqueBy, sort } = require("remeda");

const slimRecord = (rec, repoRoot) => {
	const { bodyTokens, ...rest } = rec;
	const p = path.isAbsolute(rec.path) && repoRoot ? path.relative(repoRoot, rec.path) : rec.path;
	return { ...rest, path: p.split(path.sep).join("/") };
};

const dedupeAndSort = (records) =>
	sort(
		uniqueBy(records, (r) => `${r.path}|${r.line}|${r.name}`),
		(a, b) => {
			if (a.path !== b.path) return a.path < b.path ? -1 : 1;
			if (a.line !== b.line) return a.line - b.line;
			return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
		},
	);

const writeCatalog = (outPath, catalog) => {
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2) + "\n", "utf8");
};

module.exports = { slimRecord, dedupeAndSort, writeCatalog };
