import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const main = require("../main.js");
const { normalizeOptions } = require("../config.js");
const { whenReady } = require("../playgrounds/typescript.js");

const pluginDir = path.resolve(__dirname, "..");
const APP_PAIR_ROOTS = ["tests/duplicates", "tests/Trash"];
const CANON_ROOTS = ["tests/utils"];

// The status-guard one-liners (isRemoved / isAmended / isCorrected /
// isAnnotated in vitals.adapters.ts) are mutual duplicates — but the right
// recommendation is NOT "extract to utils": the function carries no value,
// the comparison should be inlined at the call site. The Trash category
// separates those clusters from "worth moving to utils".
const buildConfig = () =>
	normalizeOptions({
		root: pluginDir,
		utilsFolder: CANON_ROOTS,
		thresholds: { duplicate: 0.7, similar: 0.5 },
		proposeUtils: true,
	});

const run = async () => {
	const config = buildConfig();
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

// A minimal candidate: the detector reads name/bodyTree/params only.
const cand = (name: string, bodyTree: any, params: any[] = [{ name: "set" }]) => ({
	name,
	path: "x.ts",
	line: 1,
	params,
	bodyTree,
});

const member = (prop: string) => ({ kind: "member", label: prop, children: [{ kind: "ident", label: "v", children: [] }] });
const eq = (a: any, b: any) => ({ kind: "bin", label: "EqualsEqualsEqualsToken", children: [a, b] });
const str = (text: string) => ({ kind: "lit", label: text, children: [] });

describe("trashScore — pure scoring of the Trash category", () => {
	it("scores a status-guard one-liner (is* name + status field) as trash", () => {
		const { trashScore } = require("../decision-maker.js");
		const c = cand("isRemoved", eq(member("status"), str("entered-in-error")));

		expect(trashScore(c)).toBeGreaterThanOrEqual(70);
	});

	it("scores a clean-literal status guard as trash too", () => {
		const { trashScore } = require("../decision-maker.js");
		const c = cand("isAnnotated", eq(member("status"), str("amended")));

		expect(trashScore(c)).toBeGreaterThanOrEqual(70);
	});

	it("scores an || chain of status comparisons as trash", () => {
		const { trashScore } = require("../decision-maker.js");
		const body = {
			kind: "bin",
			label: "BarBarToken",
			children: [eq(member("status"), str("amended")), eq(member("status"), str("corrected"))],
		};
		const c = cand("isAmended", body);

		expect(trashScore(c)).toBeGreaterThanOrEqual(70);
	});

	it("does NOT score a plain field accessor (no comparison) as trash", () => {
		const { trashScore } = require("../decision-maker.js");
		const c = cand("countAllergies", member("length"), [{ name: "rows" }]);

		expect(trashScore(c)).toBeLessThan(40);
	});

	it("does NOT score a function with a call in the body as trash", () => {
		const { trashScore } = require("../decision-maker.js");
		const body = eq({ kind: "call", label: "trim", children: [member("status")] }, str("x"));
		const c = cand("isTrimmed", body);

		expect(trashScore(c)).toBeLessThan(70);
	});

	it("scores a predicate body as trash even with a non-predicate name (name is a bonus, not a gate)", () => {
		const { trashScore } = require("../decision-maker.js");
		const c = cand("checkStatus", eq(member("status"), str("amended")));

		// The body is a valueless one-liner regardless of the name: it scores
		// trash. The predicate name only adds the +10 bonus on top.
		expect(trashScore(c)).toBeGreaterThanOrEqual(70);
	});

	it("does NOT score a multi-field predicate (kind !== X && category !== null) as trash", () => {
		const { trashScore, TRASH_THRESHOLD } = require("../decision-maker.js");
		const kind = (v: string) => ({ kind: "member", label: v, children: [{ kind: "ident", label: "row", children: [] }] });
		const body = {
			kind: "bin",
			label: "AmpersandAmpersandToken",
			children: [
				{ kind: "bin", label: "ExclamationEqualsEqualsToken", children: [kind("kind"), str("nka")] },
				{ kind: "bin", label: "ExclamationEqualsEqualsToken", children: [kind("category"), str("null")] },
			],
		};
		const c = cand("resolvable", body, [{ name: "row" }]);

		// Two distinct fields are compared — a legitimate multi-condition
		// predicate, not a valueless status one-liner.
		expect(trashScore(c)).toBeLessThan(TRASH_THRESHOLD);
	});

	it("does NOT score a multi-field || validation rule as trash", () => {
		const { trashScore, TRASH_THRESHOLD } = require("../decision-maker.js");
		const field = (v: string) => ({ kind: "member", label: v, children: [{ kind: "ident", label: "input", children: [] }] });
		const body = {
			kind: "bin",
			label: "BarBarToken",
			children: [
				{ kind: "bin", label: "EqualsEqualsToken", children: [field("spo2FlowRate"), str("undefined")] },
				{ kind: "bin", label: "EqualsEqualsToken", children: [field("spo2SupplementalO2"), str("true")] },
			],
		};
		const c = cand("flowRateNeedsSupplementalO2", body, [{ name: "input" }]);

		expect(trashScore(c)).toBeLessThan(TRASH_THRESHOLD);
	});

	it("does NOT score an instanceof + code guard as trash (type guards carry value)", () => {
		const { trashScore, TRASH_THRESHOLD } = require("../decision-maker.js");
		const code = { kind: "member", label: "code", children: [{ kind: "ident", label: "err", children: [] }] };
		const body = {
			kind: "bin",
			label: "AmpersandAmpersandToken",
			children: [
				{ kind: "bin", label: "InstanceOfToken", children: [{ kind: "ident", label: "err", children: [] }, { kind: "ident", label: "Error", children: [] }] },
				{ kind: "bin", label: "EqualsEqualsToken", children: [code, str("404")] },
			],
		};
		const c = cand("isPatientNotFound", body, [{ name: "err" }]);

		expect(trashScore(c)).toBeLessThan(TRASH_THRESHOLD);
	});

	it("never scores a trash body at a round 100 (kebab literals are not a bonus)", () => {
		const { trashScore } = require("../decision-maker.js");
		// `entered-in-error` is a normal FHIR status (kebab-case). A kebab
		// literal must not push a 95-score status guard to a suspiciously
		// round 100 — the +5 "dirty literal" bonus is semantically noise.
		const c = cand("isRemoved", eq(member("status"), str("entered-in-error")));

		expect(trashScore(c)).toBeLessThan(100);
	});
});

describe("splitTrashClusters — all-trash clusters move to the trash side", () => {
	it("splits a cluster whose members are all trash", () => {
		const { splitTrashClusters } = require("../filter/trash.js");
		const { trashScore } = require("../decision-maker.js");
		const guard = (name: string) => ({ name, path: "a.ts", line: 1, bodyTree: eq(member("status"), str("x")) });
		const { keep, trash } = splitTrashClusters([
			{ name: "Status", members: [guard("isAnnotated"), guard("isRemoved")], confidence: 0.9 },
		]);

		expect(trash.length).toBe(1);
		expect(keep.length).toBe(0);
		expect(trash[0].members.every((m: any) => trashScore(m) >= 70)).toBe(true);
	});

	it("keeps a cluster with at least one non-trash member", () => {
		const { splitTrashClusters } = require("../filter/trash.js");
		const guard = { name: "isAnnotated", path: "a.ts", line: 1, bodyTree: eq(member("status"), str("x")) };
		const real = { name: "summarizeAllergies", path: "b.ts", line: 1, bodyTree: { kind: "for-of", label: "for-of", children: [] } };
		const { keep, trash } = splitTrashClusters([
			{ name: "Shared", members: [guard, real], confidence: 0.9 },
		]);

		expect(keep.length).toBe(1);
		expect(trash.length).toBe(0);
	});
});

describe("collectTrashClusters — singletons stay visible", () => {
	it("keeps a singleton trash function in the result, flagged as singleton", () => {
		const { collectTrashClusters } = require("../filter/trash.js");
		const guard = (name: string, lit: string) => ({ name, path: "a.ts", line: 1, bodyTree: eq(member("status"), str(lit)) });
		const lone = { name: "isAmended", path: "b.ts", line: 9, bodyTree: { kind: "bin", label: "BarBarToken", children: [eq(member("status"), str("amended")), eq(member("status"), str("corrected"))] } };

		const clusters = collectTrashClusters([guard("isRemoved", "x"), guard("isAnnotated", "y"), lone]);

		const pair = clusters.find((c: any) => c.members.length === 2);
		expect(pair).toBeTruthy();
		expect(pair.singleton).toBeFalsy();

		const single = clusters.find((c: any) => c.members.length === 1);
		expect(single).toBeTruthy();
		expect(single.members[0].name).toBe("isAmended");
		expect(single.singleton).toBe(true);
	});

	it("does not flag a size-2 shape cluster as singleton", () => {
		const { collectTrashClusters } = require("../filter/trash.js");
		const guard = (name: string, lit: string) => ({ name, path: "a.ts", line: 1, bodyTree: eq(member("status"), str(lit)) });

		const clusters = collectTrashClusters([guard("isRemoved", "x"), guard("isAnnotated", "y")]);

		expect(clusters).toHaveLength(1);
		expect(clusters[0].singleton).toBeFalsy();
	});
});

describe("trashClusterName — cluster headings are distinguishable", () => {
	const { trashClusterName } = require("../filter/trash.js");
	const m = (name: string) => ({ name });

	it("derives a name from the words that distinguish the members", () => {
		// isVitalsSetBlock + isVitalsTrendBlock: "is" and "vitals" are shared,
		// "set" and "trend" are not — the heading must carry them.
		const name = trashClusterName([m("isVitalsSetBlock"), m("isVitalsTrendBlock")]);

		expect(name.toLowerCase()).toContain("set");
		expect(name.toLowerCase()).toContain("trend");
	});

	it("falls back to the first member name when nothing distinguishes", () => {
		const name = trashClusterName([m("isAnnotated"), m("isRemoved")]);

		// "annotated" and "removed" both distinguish — either is fine, but the
		// generic "Is" must NOT be the heading.
		expect(name).not.toBe("Is");
		expect(name.length).toBeGreaterThan(2);
	});

	it("uses the full name for a singleton", () => {
		expect(trashClusterName([m("isAmended")])).toBe("isAmended");
	});
});

describe("matchAppPairs — §6 one-trash rule", () => {
	it("drops a pair where exactly one side is trash (not a partial duplicate)", () => {
		const { matchAppPairs } = main;
		const config = buildConfig();
		const guard = { name: "isRemoved", path: "a.ts", line: 1, params: [{ name: "set" }], bodyTree: eq(member("status"), str("entered-in-error")) };
		const real = { name: "summarizeAllergies", path: "b.ts", line: 1, params: [{ name: "items" }], bodyTree: { kind: "for-of", label: "for-of", children: [] } };

		// Exactly one side is trash → the pair is dropped before any matching.
		expect(matchAppPairs([guard, real], config, new Set([guard]))).toHaveLength(0);
	});
});

describe("buildUtilsReport — Trash category (integration)", () => {
	it("routes the status-guard cluster to trashClusters, not appClusters", async () => {
		const comp = await run();

		const inApp = new Set((comp.appClusters || []).flatMap((c: any) => c.members.map((m: any) => m.name)));
		expect(inApp.has("isRemoved")).toBe(false);
		expect(inApp.has("isAnnotated")).toBe(false);
		expect(inApp.has("isCorrected")).toBe(false);
		expect(inApp.has("isAmended")).toBe(false);

		// isAmended is an || chain of two comparisons — a different body shape,
		// so it does not shape-cluster with the single-comparison guards. It is
		// still trash on its own, and singletons must stay VISIBLE in the
		// report (a valueless one-liner is worth inlining even without a twin).
		const inTrash = new Set((comp.trashClusters || []).flatMap((c: any) => c.members.map((m: any) => m.name)));
		expect(inTrash.has("isRemoved")).toBe(true);
		expect(inTrash.has("isAnnotated")).toBe(true);
		expect(inTrash.has("isCorrected")).toBe(true);
		expect(inTrash.has("isAmended")).toBe(true);
		expect(inTrash.has("vitalType")).toBe(false);
	});

	it("keeps the real cross-file twin in appClusters", async () => {
		const comp = await run();
		const cluster = (comp.appClusters || []).find((c: any) =>
			c.members.some((m: any) => m.name === "summarizeAllergies") &&
			c.members.some((m: any) => m.name === "summarizeReviews"),
		);

		expect(cluster).toBeTruthy();
	});
});
