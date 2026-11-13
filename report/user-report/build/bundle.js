"use strict";

// The React overview bundle.
//
// `src/` is plain JSX with no committed build step: this module compiles it with
// esbuild on first use and keeps the result. The compiled text is cached in
// `os.tmpdir()`, keyed by the mtime+size of every source file, so a second
// `--overview` on the same machine pays the build once and a changed source
// rebuilds.
//
// Required LAZILY from `./html/shell.js`: loading the ESLint rule must never
// pull in esbuild or React.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SRC_DIR = path.join(__dirname, "..", "src");
const ENTRY = path.join(SRC_DIR, "main.jsx");
const CACHE_DIR = path.join(os.tmpdir(), "utils-uniqueness-overview");
const CACHE_FILE = path.join(CACHE_DIR, "bundle.js");
const STAMP_FILE = path.join(CACHE_DIR, "stamp.json");

const listSources = (dir) => {
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const abs = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...listSources(abs));
		else if (/\.(jsx?|mjs)$/.test(entry.name)) out.push(abs);
	}

	return out.sort();
};

const stampOf = (files) =>
	files.map((file) => {
		const stat = fs.statSync(file);

		return `${file}:${stat.size}:${stat.mtimeMs}`;
	});

const readCached = (stamp) => {
	try {
		const cached = JSON.parse(fs.readFileSync(STAMP_FILE, "utf8"));
		if (JSON.stringify(cached) !== JSON.stringify(stamp)) return null;

		return fs.readFileSync(CACHE_FILE, "utf8");
	} catch {
		return null;
	}
};

const writeCached = (bundle, stamp) => {
	try {
		fs.mkdirSync(CACHE_DIR, { recursive: true });
		fs.writeFileSync(CACHE_FILE, bundle, "utf8");
		fs.writeFileSync(STAMP_FILE, JSON.stringify(stamp), "utf8");
	} catch {
		// A read-only tmpdir is not a reason to fail the report: the bundle is
		// in hand, it just is not cached.
	}
};

// A package DIRECTORY, so that `react/jsx-runtime` still resolves inside it.
const ROOT = (name) => path.dirname(require.resolve(`${name}/package.json`));

const compile = () => {
	const esbuild = require("esbuild");
	const result = esbuild.buildSync({
		entryPoints: [ENTRY],
		bundle: true,
		write: false,
		format: "iife",
		platform: "browser",
		target: ["es2020"],
		jsx: "automatic",
		loader: { ".js": "jsx", ".jsx": "jsx" },
		define: { "process.env.NODE_ENV": '"production"' },
		// The view is a linked package with its own `node_modules`: without an
		// alias the bundle carries two Reacts and the hooks of one read the
		// dispatcher of the other.
		alias: {
			react: ROOT("react"),
			"react-dom": ROOT("react-dom"),
			"styled-components": ROOT("styled-components"),
		},
		minify: true,
		logLevel: "silent",
	});

	return result.outputFiles[0].text;
};

// The view lives in a package shipped as compiled `dist`: its files change
// without any change under `src`, and a stamp that ignored them served a bundle
// built from the previous build of the package.
// The view is a package shipped as compiled `dist`: its files change without any
// change under `src`, and a stamp that ignored them served a bundle built from
// the previous build of the package. The package is not necessarily installed
// next to this file (pnpm hoists it), so it is RESOLVED, not assumed.
// The compiled entry is the only subpath the package exports, so the DIST
// directory is derived from it rather than read out of `package.json`.
const vendorDist = () => {
	try {
		return path.dirname(require.resolve("@md-code/code-diff/view", { paths: [__dirname] }));
	} catch {
		return null;
	}
};

const vendorSources = () => {
	const dist = vendorDist();
	if (dist === null) return [];

	try {
		return listSources(dist).filter((file) => file.endsWith(".js"));
	} catch {
		return [];
	}
};

let memoryCache = null;

const getBundle = () => {
	if (memoryCache) return memoryCache;

	const stamp = stampOf([...listSources(SRC_DIR), ...vendorSources()]);
	const cached = readCached(stamp);
	if (cached) {
		memoryCache = cached;

		return cached;
	}

	const bundle = compile();
	writeCached(bundle, stamp);
	memoryCache = bundle;

	return bundle;
};

module.exports = { getBundle };
