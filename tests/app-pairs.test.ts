import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const main = require("../main.js");
const { normalizeOptions } = require("../config.js");
const { clusterAppPairs } = require("../filter/app-pairs.js");
const { whenReady } = require("../playgrounds/typescript.js");

const pluginDir = path.resolve(__dirname, "..");

// The app↔app mode finds functions that are near-identical copies of *each
// other* — with no canonical anchor. Ground truth from the real run:
//   toReviewedAsOf (allergy.rm.ts)  ≈  toReviewedAsOf (review.rm.ts)
//   openChart (meds.e2e.ts)         ≈  openChart (problems.e2e.ts)
// These are invisible to the canonical scan (which only matches app → canon),
// so the flag surfaces them as "worth moving to utils".
const APP_PAIR_ROOTS = ["tests/duplicates", "tests/Trash"];
const CANON_ROOTS = ["tests/utils"];

// A minimal candidate record — the clusterer only reads path/name/line and
// decision.confidence, so no real parsing is needed for the pure tests.
const cand = (p: string, n: string, line = 1) => ({ path: p, name: n, line });
const pair = (a: any, b: any, confidence: number) => ({
	app: a,
	peer: b,
	decision: { confidence, tier: confidence >= 0.7 ? "duplicate" : "similar" },
});

const buildConfig = (proposeUtils: boolean) =>
	normalizeOptions({
		root: pluginDir,
		utilsFolder: CANON_ROOTS,
		thresholds: { duplicate: 0.7, similar: 0.5 },
		proposeUtils,
	});

const run = async (proposeUtils: boolean) => {
	const config = buildConfig(proposeUtils);
	await whenReady(config);

	return main.buildUtilsReport(
		{ appRoots: APP_PAIR_ROOTS, minCluster: 3, verbose: false, parts: false },
		pluginDir,
		CANON_ROOTS,
		config,
		null,
		[],
	);
};

describe("parseArgs — --propose-utils flag", () => {
	it("sets proposeUtils when the flag is present", () => {
		expect(main.parseArgs(["--propose-utils"]).proposeUtils).toBe(true);
	});

	it("leaves proposeUtils off by default", () => {
		expect(main.parseArgs([]).proposeUtils).toBeFalsy();
	});
});

describe("normalizeOptions — proposeUtils carried through", () => {
	it("propagates proposeUtils: true", () => {
		expect(normalizeOptions({ proposeUtils: true }).proposeUtils).toBe(true);
	});

	it("defaults proposeUtils to false", () => {
		expect(normalizeOptions({}).proposeUtils).toBe(false);
	});
});

describe("clusterAppPairs — pure clustering of mutual copies", () => {
	it("clusters a two-function clique of near-identical copies", () => {
		const clusters = clusterAppPairs([
			pair(cand("app/a.ts", "summarizeAllergies"), cand("app/b.ts", "summarizeReviews"), 0.98),
		]);

		expect(clusters).toHaveLength(1);
		const members = clusters[0].members.map((m: any) => m.name).sort();
		expect(members).toEqual(["summarizeAllergies", "summarizeReviews"]);
		expect(clusters[0].confidence).toBeCloseTo(0.98);
	});

	it("does NOT cluster a chain (A~B~C but A and C are unrelated)", () => {
		// A~B and B~C are similar, but A~C is below the floor — not a set of
		// mutual copies, so nothing is emitted.
		const clusters = clusterAppPairs([
			pair(cand("app/a.ts", "a"), cand("app/b.ts", "b"), 0.9),
			pair(cand("app/b.ts", "b"), cand("app/c.ts", "c"), 0.9),
			pair(cand("app/a.ts", "a"), cand("app/c.ts", "c"), 0.3),
		]);

		expect(clusters).toHaveLength(0);
	});

	it("does NOT cluster pairs below the confidence floor", () => {
		const clusters = clusterAppPairs([
			pair(cand("app/a.ts", "a"), cand("app/b.ts", "b"), 0.5),
		]);

		expect(clusters).toHaveLength(0);
	});

	it("keeps two independent pairs as two clusters", () => {
		const clusters = clusterAppPairs([
			pair(cand("app/a.ts", "a1"), cand("app/b.ts", "a2"), 0.95),
			pair(cand("app/c.ts", "b1"), cand("app/d.ts", "b2"), 0.9),
		]);

		expect(clusters).toHaveLength(2);
	});

	it("does not treat a size-mismatched pair as a copy (pre-filter contract)", () => {
		// The O(n²) match pre-filters on body size before computing signals: a
		// one-liner and a 100-node function cannot be mutual copies, so the pair
		// is never clustered even if a (hypothetical) high confidence were fed.
		const big = { ...cand("app/big.ts", "big"), nodeCount: 100 };
		const small = { ...cand("app/small.ts", "small"), nodeCount: 2 };
		const clusters = clusterAppPairs([
			{ app: small, peer: big, decision: { confidence: 0.98, tier: "duplicate" } },
		]);

		// clusterAppPairs itself clusters by the given confidence; the size gate
		// lives in matchAppPairs (the O(n²) loop). Assert the contract there.
		expect(main.appPairSizeComparable(small, big)).toBe(false);
		expect(clusters).toHaveLength(1);
	});
});

describe("clusterAppPairs — copy policy (AST + params)", () => {
	// A "copy" is stronger than a "similar" match: it must share near-identical
	// subtree structure (high AST score) and must not be a 0-param factory
	// stub. Synthetic pairs without signals/params are exempt (they test the
	// clique/floor logic in isolation, not the copy policy).
	const copyPair = (a: any, b: any, confidence: number, ast: number, params: number) => ({
		app: { ...a, params: Array(params).fill({ name: "p" }) },
		peer: { ...b, params: Array(params).fill({ name: "p" }) },
		decision: {
			confidence,
			tier: confidence >= 0.7 ? "duplicate" : "similar",
			signals: { ast: { score: ast } },
		},
	});

	it("does NOT cluster a high-confidence pair whose AST structure diverges", () => {
		// confidence is high but the subtrees are only 50% shared — not a copy.
		const clusters = clusterAppPairs([
			copyPair(cand("app/a.ts", "a"), cand("app/b.ts", "b"), 0.95, 0.5, 1),
		]);

		expect(clusters).toHaveLength(0);
	});

	it("does NOT cluster two 0-param factory stubs even when they match", () => {
		// () => new Client<T>("T") and () => new Client<U>("U") share a shape but
		// are pattern instances, not copies of each other.
		const clusters = clusterAppPairs([
			copyPair(cand("app/a.ts", "allergies"), cand("app/b.ts", "patients"), 0.99, 1.0, 0),
		]);

		expect(clusters).toHaveLength(0);
	});

	it("keeps a true copy (high AST, >=1 param) above the floor", () => {
		const clusters = clusterAppPairs([
			copyPair(cand("app/a.ts", "summarizeAllergies"), cand("app/b.ts", "summarizeReviews"), 0.98, 1.0, 1),
		]);

		expect(clusters).toHaveLength(1);
		expect(clusters[0].members.map((m: any) => m.name).sort()).toEqual(["summarizeAllergies", "summarizeReviews"]);
	});

	it("recovers a twin pair buried under noisy low-AST neighbours (regression)", () => {
		// A and B are byte-identical twins (AST 1.0). Each is also 'similar' to a
		// set of unrelated helpers (AST 0.5, confidence 0.8). The old connected-
		// component + all-or-nothing clique check swallowed A and B into one big
		// non-clique component and dropped them. The copy policy must filter the
		// noisy edges so the clean {A,B} clique survives.
		const a = cand("app/a.ts", "toReviewedAsOf");
		const b = cand("app/b.ts", "toReviewedAsOf");
		const pairs: any[] = [copyPair(a, b, 1.0, 1.0, 1)];
		for (const [i, x] of ["x1", "x2", "x3"].entries()) {
			const n = cand(`app/n${i}.ts`, x);
			pairs.push(copyPair(a, n, 0.8, 0.5, 1));
			pairs.push(copyPair(b, n, 0.8, 0.5, 1));
		}

		const clusters = clusterAppPairs(pairs);

		expect(clusters).toHaveLength(1);
		const names = clusters[0].members.map((m: any) => m.name).sort();
		expect(names).toEqual(["toReviewedAsOf", "toReviewedAsOf"]);
	});
});

describe("buildUtilsReport — app↔app mode (integration)", () => {
	it("with the flag, surfaces the cross-file twin as a worth-moving cluster", async () => {
		const comp = await run(true);

		expect(comp.appClusters).toBeTruthy();
		expect(comp.appClusters.length).toBeGreaterThanOrEqual(1);
		const cluster = comp.appClusters.find((c: any) =>
			c.members.some((m: any) => m.name === "summarizeAllergies") &&
			c.members.some((m: any) => m.name === "summarizeReviews"),
		);
		expect(cluster).toBeTruthy();
	});

	it("with the flag, does NOT pull the unrelated one-liners into a cluster", async () => {
		const comp = await run(true);
		const clustered = new Set(
			(comp.appClusters || []).flatMap((c: any) => c.members.map((m: any) => m.name)),
		);

		expect(clustered.has("countAllergies")).toBe(false);
		expect(clustered.has("sortReviews")).toBe(false);
	});

	it("without the flag, reports no app↔app clusters", async () => {
		const comp = await run(false);

		expect(comp.appClusters).toEqual([]);
	});
});
