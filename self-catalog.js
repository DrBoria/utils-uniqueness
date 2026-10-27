"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { isIgnored } = require("./config");
const { collectFiles, parseUtils } = require("./main");
const { slimRecord, dedupeAndSort, writeCatalog } = require("./utils");

// Self-maintained catalog: the rule keeps its own catalog fresh by walking the
// configured roots on every lint and re-parsing only the files whose
// mtime+size changed since the last refresh (per-file cache in os.tmpdir()).
// This is the "cache WHAT to compare against" part — the file being linted is
// always judged from its live editor buffer by the rule itself, so the disk
// catalog only ever supplies the OTHER files.
//
// Budget guard: the refresh is capped at `budgetMs`; past it the partial
// catalog is written as-is (better a slightly stale catalog than a frozen
// editor). The per-file cache makes the fast path ~0ms and a single changed
// file ~100-300ms.

const cachePathFor = (root, ruleName) => {
	const key = crypto.createHash("md5").update(path.resolve(root)).digest("hex");
	return path.join(os.tmpdir(), ".md-code-cache", `${ruleName}-${key}.json`);
};

const readCache = (cachePath) => {
	try {
		const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
		return parsed && typeof parsed === "object" && parsed.files ? parsed : { files: {} };
	} catch {
		return { files: {} };
	}
};

// Refresh the on-disk catalog in place. Returns true when the catalog was
// rewritten (or created), false when nothing changed or the refresh was
// skipped entirely.
const refreshCatalog = (config, { budgetMs = 30000 } = {}) => {
	let wrote = false;
	const root = config.root;
	if (!root) return false;
	const catalogPath = path.isAbsolute(config.catalogPath) ? config.catalogPath : path.join(root, config.catalogPath);
	const cachePath = cachePathFor(root, "utils");
	const started = Date.now();
	const cache = readCache(cachePath);

	const { files } = collectFiles(config.utilsFolder, root, (abs) => isIgnored(abs.split(path.sep).join("/"), [], config.exclude), config.exts, config.ignoreDirs);
	const seen = new Set();
	let changed = 0;
	let pruned = 0;
	let budgetHit = false;

	for (const { file, rel } of files) {
		seen.add(rel);
		let stat;
		try {
			stat = fs.statSync(file);
		} catch {
			continue;
		}
		const prev = cache.files[rel];
		if (prev && prev.mtimeMs === stat.mtimeMs && prev.size === stat.size) continue;
		if (Date.now() - started > budgetMs) {
			budgetHit = true;
			break;
		}
		try {
			const records = parseUtils([{ file, rel }], config).map((u) => slimRecord(u, root));
			cache.files[rel] = { mtimeMs: stat.mtimeMs, size: stat.size, records };
			changed += 1;
		} catch (err) {
			// Keep the previous records for a file that fails to parse — a
			// transient error must not silently drop half the catalog.
			if (prev) cache.files[rel] = prev;
			else cache.files[rel] = { mtimeMs: stat.mtimeMs, size: stat.size, records: [] };
		}
	}
	for (const rel of Object.keys(cache.files)) {
		if (!seen.has(rel)) {
			delete cache.files[rel];
			pruned += 1;
		}
	}

	const records = dedupeAndSort(Object.values(cache.files).flatMap((b) => b.records));
	if (changed > 0 || pruned > 0 || !fs.existsSync(catalogPath)) {
		try {
			writeCatalog(catalogPath, records);
			wrote = true;
		} catch (err) {
			console.warn(`[utils-uniqueness] self-catalog: could not write ${catalogPath}: ${err && err.message ? err.message : err}`);
			return false;
		}
	}

	try {
		fs.mkdirSync(path.dirname(cachePath), { recursive: true });
		fs.writeFileSync(cachePath, JSON.stringify(cache), "utf8");
	} catch {
		// Cache write failure is non-fatal: the catalog is already written,
		// the next lint simply re-parses more files.
	}

	if (budgetHit) console.warn("[utils-uniqueness] self-catalog: budget exhausted, catalog may be partially stale");
	return wrote;
};

module.exports = { refreshCatalog };
