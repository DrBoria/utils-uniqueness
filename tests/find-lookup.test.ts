import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const main = require("../main.js");
const { normalizeOptions } = require("../config.js");
const { whenReady } = require("../playgrounds/typescript.js");

const pluginDir = path.resolve(__dirname, "..");

// Ground truth from the REAL run's splitGroupsValue false-positive cluster.
//
//   core/ehr/hg.contract.ts:532  splitGroupsValue
//     outcome.extension.find((ext) => ext.url === "ORDER_SPLIT")?.valueString
//
// over-matched 3 unrelated single-expression find-lookups at 0.70-0.78, all
// with structure 1.00 and controlFlow 1.00, because every single-expression
// `collection.find(pred)?.prop` lookup shares the same pattern-level skeleton
// (member → find → member). Only the AST signal (the actual predicate +
// accessed property) discriminates them, so a find-lookup body needs a higher
// AST bar before it may be called a duplicate.
//
//   FALSE answerOf   -> splitGroupsValue  (0.78, different predicate/property)
//   FALSE snomedIn   -> splitGroupsValue  (0.70, optional-chain + different pred)
//   FALSE findVitalId-> splitGroupsValue  (0.70, different predicate/property)
//   FALSE orgName    -> splitGroupsValue  (0.71, find + ?? "" fallback)
//   TRUE  splitGroupsValueCopy -> splitGroupsValue  (a genuine twin)
const CANON_ROOTS = ["tests/utils"];
const APP_ROOTS = ["tests/duplicates", "tests/NOT_duplicates"];

const buildConfig = () =>
	normalizeOptions({
		root: pluginDir,
		utilsFolder: CANON_ROOTS,
		thresholds: { duplicate: 0.7, similar: 0.5 },
	});

const run = async () => {
	const config = buildConfig();
	await whenReady(config);

	return main.buildUtilsReport(
		{ appRoots: APP_ROOTS, minCluster: 3, verbose: false, parts: false },
		pluginDir,
		CANON_ROOTS,
		config,
		null,
		[],
	);
};

const dupAgainst = (comp: any, appName: string, canonName: string) =>
	comp.matches.find((m: any) => m.decision.tier === "duplicate" && m.app.name === appName && m.canon.name === canonName);

describe("single-expression find-lookups — splitGroupsValue FP cluster", () => {
	it("does NOT flag answerOf as a duplicate of splitGroupsValue (FP, 0.78 in the real run)", async () => {
		expect(dupAgainst(await run(), "answerOf", "splitGroupsValue")).toBeUndefined();
	});

	it("does NOT flag snomedIn as a duplicate of splitGroupsValue (FP, 0.70 in the real run)", async () => {
		expect(dupAgainst(await run(), "snomedIn", "splitGroupsValue")).toBeUndefined();
	});

	it("does NOT flag findVitalId as a duplicate of splitGroupsValue (FP, 0.70 in the real run)", async () => {
		expect(dupAgainst(await run(), "findVitalId", "splitGroupsValue")).toBeUndefined();
	});

	it("does NOT flag orgName as a duplicate of splitGroupsValue (borderline FP, 0.71 in the real run)", async () => {
		expect(dupAgainst(await run(), "orgName", "splitGroupsValue")).toBeUndefined();
	});

	it("STILL flags splitGroupsValueCopy as a duplicate of splitGroupsValue (TRUE twin — regression guard)", async () => {
		expect(dupAgainst(await run(), "splitGroupsValueCopy", "splitGroupsValue")).toBeTruthy();
	});
});
