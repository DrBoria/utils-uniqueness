import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const main = require("../main.js");
const { normalizeOptions, isIgnored } = require("../config.js");
const { whenReady, parseFunctions } = require("../playgrounds/typescript.js");
const { buildAst, multisetJaccard } = require("../normalize/ast.js");
const { buildCandidate } = require("../normalize/candidate.js");

const pluginDir = path.resolve(__dirname, "..");
const relPosix = (abs: string) => path.relative(pluginDir, abs).split(path.sep).join("/");

const CANON_ROOTS = ["tests/utils"];
const APP_ROOTS = ["tests/duplicates", "tests/NOT_duplicates"];

const buildConfig = () =>
	normalizeOptions({
		root: pluginDir,
		utilsFolder: CANON_ROOTS,
		parts: true,
		thresholds: { duplicate: 0.6, similar: 0.3 },
	});

describe("normalizeOptions", () => {
	it("normalizes utilsFolder to posix paths with trailing slash", () => {
		const config = buildConfig();

		expect(config.root).toBe(pluginDir);
		expect(config.utilsFolder).toEqual(["tests/utils/"]);
		expect(config.parts).toBe(true);
	});

	it("has default excludes for test files only (prod code is scanned too)", () => {
		const config = buildConfig();

		expect(config.exclude.length).toBeGreaterThan(0);
		expect(config.exclude.some((p: string) => String(p).includes("test"))).toBe(true);
		expect(config.exclude.some((p: string) => String(p).includes("e2e"))).toBe(true);
	});
});

describe("buildUtilsReport", () => {
	it("flags a renamed duplicate and ignores a distinct util", async () => {
		const config = buildConfig();
		await whenReady(config);

		const comp = await main.buildUtilsReport(
			{ appRoots: APP_ROOTS, minCluster: 3, verbose: false, parts: true },
			pluginDir,
			CANON_ROOTS,
			config,
			null,
			[],
		);

		expect(comp.canonCount).toBeGreaterThanOrEqual(2);
		expect(comp.appCount).toBeGreaterThanOrEqual(3);

		const dupMatches = comp.matches.filter((m: any) => m.decision.tier === "duplicate");
		const totalMatch = dupMatches.find((m: any) => m.app.name === "formatTotal");
		expect(totalMatch).toBeTruthy();
		expect(totalMatch.canon.name).toBe("formatPrice");
		expect(totalMatch.decision.confidence).toBeGreaterThanOrEqual(0.6);

		const dupAppNames = new Set(dupMatches.map((m: any) => m.app.name));
		expect(dupAppNames.has("reverseWords")).toBe(false);
	});

	it("drops a function that already calls the canonical util", async () => {
		const config = buildConfig();
		await whenReady(config);

		const comp = await main.buildUtilsReport(
			{ appRoots: APP_ROOTS, minCluster: 3, verbose: true, parts: true },
			pluginDir,
			CANON_ROOTS,
			config,
			null,
			[],
		);

		const adjustDropped = comp.dropped.filter((d: any) => d.match.app.name === "adjustVolume");
		for (const d of adjustDropped) {
			expect(d.filter).toBe("drop-usages");
		}
	});
});

describe("isIgnored", () => {
	it("skips test files by default (they are not production utils)", () => {
		const config = buildConfig();

		expect(isIgnored("tests/utils/format.test.ts", [], config.exclude)).toBe(true);
		expect(isIgnored("tests/utils/format.spec.ts", [], config.exclude)).toBe(true);
		expect(isIgnored("tests/utils/format.e2e.ts", [], config.exclude)).toBe(true);
		// Story files are demo/prototype code — excluded like tests.
		expect(isIgnored("tests/utils/format.stories.tsx", [], config.exclude)).toBe(true);
		// Plain prod files are still scanned.
		expect(isIgnored("tests/utils/format.ts", [], config.exclude)).toBe(false);
	});
});

describe("bodyless signatures (overloads / ambient) — null bodyTree", () => {
	const OVERLOADS_FILE = path.resolve(__dirname, "NOT_duplicates/overloads.ts");

	it("buildAst returns a valid empty Map for a null bodyTree", () => {
		const ast = buildAst({ bodyTree: null } as any);

		expect(ast.subtreeHashes).toBeInstanceOf(Map);
		expect(ast.subtreeHashes.size).toBe(0);
		expect(ast.subtreeCount).toBe(0);
		expect(Array.isArray(ast.sequence)).toBe(true);
		expect(ast.sequence.length).toBe(0);
	});

	it("multisetJaccard handles an empty Map without throwing", () => {
		const empty = new Map<string, number>();
		const result = multisetJaccard(empty, empty);

		expect(result).toEqual({ score: 1, shared: 0, union: 0 });
	});

	it("buildCandidate produces a usable candidate for a bodyless descriptor", () => {
		const config = buildConfig();
		const parsed = parseFunctions(OVERLOADS_FILE);
		const bodyless = parsed.find((d: any) => d.name === "graphql" && d.bodyTree == null);
		expect(bodyless).toBeTruthy();

		const candidate = buildCandidate(bodyless as any, config);

		expect(candidate.ast.subtreeHashes).toBeInstanceOf(Map);
		expect(candidate.hasStructure).toBe(false);
	});

	it("the full pipeline survives a file full of bodyless signatures", async () => {
		const config = buildConfig();
		await whenReady(config);

		const comp = await main.buildUtilsReport(
			{ appRoots: APP_ROOTS, minCluster: 3, verbose: false, parts: true },
			pluginDir,
			CANON_ROOTS,
			config,
			null,
			[],
		);

		// No crash is the primary assertion. Additionally, bodyless
		// signatures must never surface as a duplicate.
		const dupAppNames = new Set(comp.matches.filter((m: any) => m.decision.tier === "duplicate").map((m: any) => m.app.name));
		expect(dupAppNames.has("graphql")).toBe(false);
		expect(dupAppNames.has("useFragment")).toBe(false);
	});
});
