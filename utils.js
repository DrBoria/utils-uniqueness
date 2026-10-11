"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DEFAULT_EXTS, DEFAULT_IGNORE_DIRS } = require("./config");

const walk = (dir, exts = DEFAULT_EXTS, ignoreDirs = DEFAULT_IGNORE_DIRS) => {
	const extSet = new Set(exts);
	const ignoreSet = new Set(ignoreDirs);
	const out = [];
	const visit = (d) => {
		let list;
		try {
			list = fs.readdirSync(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of list) {
			if (entry.name.startsWith(".") || ignoreSet.has(entry.name)) continue;
			const full = path.join(d, entry.name);
			if (entry.isDirectory()) {
				visit(full);
			} else if ([...extSet].some((e) => entry.name.endsWith(e))) {
				out.push(full);
			}
		}
	};
	visit(dir);
	return out;
};

// Strip the heavy, non-serializable internals before a candidate is written to
// the catalog or compared for freshness. bodyTree is kept: it is plain and
// JSON-serializable, and the ESLint rule rebuilds candidates from catalog
// entries via buildCandidate, which needs it.
const slimRecord = (rec, repoRoot) => {
	const { rawText, tree, ast, ...rest } = rec;
	const p = path.isAbsolute(rec.path) && repoRoot ? path.relative(repoRoot, rec.path) : rec.path;
	return { ...rest, path: p.split(path.sep).join("/") };
};

const dedupeAndSort = (records) => {
	const seen = new Set();
	const out = [];
	for (const r of records) {
		const key = `${r.path}|${r.line}|${r.name}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(r);
	}
	out.sort((a, b) => (a.path !== b.path ? a.path.localeCompare(b.path) : a.line !== b.line ? a.line - b.line : a.name.localeCompare(b.name)));
	return out;
};

const writeCatalog = (outPath, records) => {
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), utils: records }, null, 2) + "\n", "utf8");
};

module.exports = { walk, slimRecord, dedupeAndSort, writeCatalog };
