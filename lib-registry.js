"use strict";

// Lib registry for `proposeFromLib`: an inventory of named exports of the
// project's installed dependencies, so a duplicate report can suggest
// "consider `sortBy` from `lodash`" instead of (or on top of) the local
// canonical util.
//
// Nothing is hardcoded: the dependency list is read from the project's
// package.json (dependencies + devDependencies) on every build, the type
// entry of each package is resolved through its own package.json
// (types/typings, the exports map, or index.d.ts), and the exports are
// parsed from the .d.ts with ts-morph. Any library — lodash, radix, a
// private monorepo package — works the same way.
//
// The inventory is cached in os.tmpdir() keyed by the project root and
// invalidated when the root package.json mtime changes, so the parse cost
// (one ts-morph Project over all .d.ts entries) is paid once per
// dependency change, not per lint.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const MAX_LIBS = 80;
const MAX_EXPORTS_PER_LIB = 2000;
const BUDGET_MS = 30000;

const hash = (s) => crypto.createHash("md5").update(s).digest("hex");

const cachePathFor = (root) => path.join(os.tmpdir(), ".md-code-cache", `lib-registry-${hash(path.resolve(root))}.json`);

const readCache = (cachePath) => {
	try {
		const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
		return parsed && typeof parsed.libs === "object" ? parsed : null;
	} catch {
		return null;
	}
};

// Resolve the .d.ts entry of an installed package: top-level types/typings,
// then the exports map ("." condition), then index.d.ts / main, then the
// @types/<name> companion package (lodash ships no types of its own).
const resolveTypesEntry = (pkgDir, pkg, name, root) => {
	for (const f of [pkg.types, pkg.typings]) {
		if (typeof f === "string") {
			const p = path.join(pkgDir, f);
			if (fs.existsSync(p)) return { path: p, typesDir: pkgDir };
		}
	}
	const dot = pkg.exports && pkg.exports["."];
	if (dot) {
		const candidates = [];
		if (typeof dot === "string") candidates.push(dot);
		else if (dot && typeof dot === "object") {
			if (typeof dot.types === "string") candidates.push(dot.types);
			for (const cond of ["require", "import", "default"]) if (typeof dot[cond] === "string") candidates.push(dot[cond]);
			for (const v of Object.values(dot)) if (v && typeof v === "object" && typeof v.types === "string") candidates.push(v.types);
		}
		for (const c of candidates) {
			const p = path.join(pkgDir, c);
			if (fs.existsSync(p)) return { path: p, typesDir: pkgDir };
		}
	}
	for (const f of ["index.d.ts", pkg.main && pkg.main.endsWith(".js") ? pkg.main.replace(/\.js$/, ".d.ts") : null]) {
		if (f) {
			const p = path.join(pkgDir, f);
			if (fs.existsSync(p)) return { path: p, typesDir: pkgDir };
		}
	}
	// @types/<name> companion (lodash, express, …): the types live in a
	// separate package, so the entry is @types/<name>/index.d.ts.
	try {
		const typesPkg = require.resolve(`@types/${name}/package.json`, { paths: [root] });
		const typesDir = path.dirname(typesPkg);
		const t = JSON.parse(fs.readFileSync(typesPkg, "utf8"));
		for (const f of [t.types, t.typings, "index.d.ts"]) {
			if (typeof f === "string") {
				const p = path.join(typesDir, f);
				if (fs.existsSync(p)) return { path: p, typesDir };
			}
		}
	} catch {
		// No @types package for this dependency — no types to parse.
	}
	return null;
};

// Classify a declaration node for the inventory.
const classify = (ts, d) => {
	const k = d.getKind();
	if (k === ts.SyntaxKind.FunctionDeclaration || k === ts.SyntaxKind.FunctionExpression || k === ts.SyntaxKind.ArrowFunction) return "function";
	if (k === ts.SyntaxKind.ClassDeclaration) return "class";
	if (k === ts.SyntaxKind.InterfaceDeclaration || k === ts.SyntaxKind.TypeAliasDeclaration) return "type";
	if (k === ts.SyntaxKind.EnumDeclaration) return "enum";
	return "value";
};

const pushDecl = (ts, items, name, d) => {
	const kind = classify(ts, d);
	let paramCount = null;
	if (kind === "function" && typeof d.getParameters === "function") paramCount = d.getParameters().length;
	items.push({ name, kind, paramCount });
};

// Some @types packages (lodash) ship one tiny .d.ts per export next to a
// stub index.d.ts. When that happens, the file name IS the export name.
const scanTypesDir = (typesDir) => {
	const items = [];
	let entries = [];
	try {
		entries = fs.readdirSync(typesDir, { withFileTypes: true });
	} catch {
		return items;
	}
	for (const e of entries) {
		if (!e.isFile() || !e.name.endsWith(".d.ts") || e.name === "index.d.ts") continue;
		const name = e.name.slice(0, -5);
		// Sub-namespace files (lodash/common/array.d.ts) are not exports.
		if (name.includes("/") || name.includes("-")) continue;
		items.push({ name, kind: "value", paramCount: null });
		if (items.length >= MAX_EXPORTS_PER_LIB) break;
	}
	return items;
};

const isContainer = (ts, d) => {
	const k = d.getKind();
	return k === ts.SyntaxKind.InterfaceDeclaration || k === ts.SyntaxKind.ModuleDeclaration;
};

const buildForLib = (ts, project, libName, { path: dtsPath, typesDir }) => {
	const sf = project.addSourceFileAtPath(dtsPath);
	const items = [];
	const decls = sf.getExportedDeclarations();
	const seen = new Set();
	const push = (name, d) => {
		if (!name || name.startsWith("_") || seen.has(name)) return;
		seen.add(name);
		pushDecl(ts, items, name, d);
	};
	// Named exports (mobx, typescript): the export key IS the public name.
	// A container export (interface/namespace) is NOT a public name — its
	// members are (see below), so skip the key itself.
	for (const [name, list] of decls) {
		for (const d of list || []) {
			if (isContainer(ts, d)) continue;
			push(name, d);
		}
	}
	// `export = <interface|namespace>` style (lodash, express): the public
	// API is the container's members (LoDashStatic → sortBy, debounce, …).
	for (const list of decls.values()) for (const d of list || []) {
		if (!isContainer(ts, d)) continue;
		const members = typeof d.getMembers === "function" ? d.getMembers() : [];
		for (const m of members) {
			const name = typeof m.getName === "function" ? m.getName() : "";
			push(name, m);
			if (items.length >= MAX_EXPORTS_PER_LIB) break;
		}
		if (items.length >= MAX_EXPORTS_PER_LIB) break;
	}
	// Per-file @types layout (lodash): the entry is a stub and every export
	// is its own sibling .d.ts file next to a `common/` sub-namespace. Only
	// used when the container carried no visible members.
	if (items.length === 0 && typesDir && fs.existsSync(path.join(typesDir, "common"))) {
		const scanned = scanTypesDir(typesDir);
		if (scanned.length > 0) return scanned;
	}
	return items;
};

// Collect dependency names from the root package.json and from workspace
// packages (apps/*, packages/*, core/*) — in a monorepo the interesting
// deps (mobx, lodash, radix) usually live in a workspace, not the root.
// Returns { deps: Map<name, dir>, stamps: {dir: mtimeMs} }.
const collectDeps = (root) => {
	const deps = new Map();
	const stamps = {};
	const read = (dir) => {
		const pkgPath = path.join(dir, "package.json");
		let stat;
		try {
			stat = fs.statSync(pkgPath);
		} catch {
			return;
		}
		stamps[pkgPath] = stat.mtimeMs;
		let pkg;
		try {
			pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
		} catch {
			return;
		}
		for (const [name] of Object.entries({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) })) {
			// @types/* are type stubs for other packages, not libraries.
			if (name.startsWith("@types/")) continue;
			if (!deps.has(name)) deps.set(name, dir);
		}
	};
	read(root);
	for (const group of ["apps", "packages", "core"]) {
		let entries = [];
		try {
			entries = fs.readdirSync(path.join(root, group), { withFileTypes: true });
		} catch {
			continue;
		}
		for (const e of entries) if (e.isDirectory()) read(path.join(root, group, e.name));
	}
	return { deps, stamps };
};

// Build (or read from cache) the lib registry for a project root.
// Returns Map<libName, Array<{name, kind, paramCount}>>.
//
// The cache is PER-LIB: when the budget is hit mid-build, the libs parsed so
// far stay cached and the next lint picks up where this one stopped, so a
// big dependency tree (typescript, react…) converges over a few lints
// instead of being re-parsed from scratch every time.
const buildLibRegistry = (root) => {
	const empty = new Map();
	const cachePath = cachePathFor(root);
	const { deps, stamps } = collectDeps(root);
	if (deps.size === 0) return empty;

	const cached = readCache(cachePath);
	const libs = cached && cached.stamps && JSON.stringify(cached.stamps) === JSON.stringify(stamps) && cached.libs ? cached.libs : {};
	if (deps.size === Object.keys(libs).length) return new Map(Object.entries(libs));

	const started = Date.now();
	let budgetHit = false;
	let { Project, ts } = {};
	try {
		({ Project } = require("ts-morph"));
		ts = require("typescript");
	} catch (err) {
		console.warn(`[lib-registry] ts-morph/typescript unavailable: ${err && err.message ? err.message : err}`);
		return new Map(Object.entries(libs));
	}
	const project = new Project({ skipAddingFilesFromTsConfig: true });
	for (const [name, fromDir] of deps) {
		if (libs[name]) continue;
		if (Object.keys(libs).length >= MAX_LIBS) break;
		if (Date.now() - started > BUDGET_MS) {
			budgetHit = true;
			break;
		}
		try {
			const pkgJsonPath = require.resolve(`${name}/package.json`, { paths: [fromDir, root] });
			const depPkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
			const dtsPath = resolveTypesEntry(path.dirname(pkgJsonPath), depPkg, name, root);
			if (!dtsPath) {
				libs[name] = [];
				continue;
			}
			const items = buildForLib(ts, project, name, dtsPath);
			libs[name] = items.length > 0 ? items : [];
		} catch {
			// Unresolvable or unparseable package — leave it uncached so a
			// transient failure (disk busy, half-installed node_modules) is
			// retried on the next lint.
		}
	}

	try {
		fs.mkdirSync(path.dirname(cachePath), { recursive: true });
		fs.writeFileSync(cachePath, JSON.stringify({ stamps, libs }), "utf8");
	} catch {
		// Cache write failure is not fatal: the registry is returned in
		// memory, the next lint simply rebuilds it.
	}

	if (budgetHit) console.warn("[lib-registry] budget exhausted, remaining libs will be parsed on the next lint");
	return new Map(Object.entries(libs));
};

// The bare specifiers a file imports (from/import()/require) — used by the
// wrapper filter: if the candidate file already imports the lib, the local
// function is likely EXTENDING it, not duplicating it.
const fileImportSpecifiers = (sourceText) => {
	const out = new Set();
	if (typeof sourceText !== "string") return out;
	const re = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
	let m;
	while ((m = re.exec(sourceText)) !== null) {
		const spec = m[1];
		if (!spec.startsWith(".")) {
			const parts = spec.split("/");
			out.add(spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
		}
	}
	return out;
};

// Suggest lib exports whose name matches the candidate (case-insensitive).
// Returns up to `max` {lib, name, kind} suggestions, skipping libs the file
// already imports (extension, not duplication).
const suggestFromLib = (candidateName, libRegistry, fileImports = new Set(), max = 3) => {
	const lower = String(candidateName || "").toLowerCase();
	if (!lower) return [];
	const out = [];
	for (const [lib, items] of libRegistry) {
		if (fileImports.has(lib)) continue;
		for (const it of items) {
			if (it.name.toLowerCase() === lower) {
				out.push({ lib, name: it.name, kind: it.kind });
				break;
			}
		}
		if (out.length >= max) break;
	}
	return out.slice(0, max);
};

module.exports = { buildLibRegistry, fileImportSpecifiers, suggestFromLib };
