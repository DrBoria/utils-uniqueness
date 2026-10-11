import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const main = require("../main.js");
const { normalizeOptions } = require("../config.js");
const { whenReady } = require("../playgrounds/typescript.js");

const pluginDir = path.resolve(__dirname, "..");

// Ground truth from the REAL run's emptyTotals false-positive cluster.
//
//   core/ehr/_import/define-import.ts:24  emptyTotals
//     () => ({members:0, mappedRows:0, planned:0, created:0,
//             skippedExisting:0, unresolvedMembers:0, failed:0})
//
// over-matched 8 unrelated object-returning app functions at 0.72-0.77, all
// with structure 1.00, because object-literal property *values* were dropped
// from the tree (PropertyAssignment fell into the default case), so any two
// builders with the same property count looked identical.
//
//   FALSE buildLinkedItemsList -> emptyTotals  (0.77, real builder vs zero-init)
//   FALSE toNoteSnapshot       -> emptyTotals  (0.73, real builder vs zero-init)
//   TRUE  emptyTotalsCopy      -> emptyTotals  (a genuine byte-shape twin)
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

describe("object builders — trivial zero-init canonical (emptyTotals FP cluster)", () => {
	it("does NOT flag buildLinkedItemsList as a duplicate of emptyTotals (FP, 0.77 in the real run)", async () => {
		const comp = await run();
		const dupMatches = comp.matches.filter((m: any) => m.decision.tier === "duplicate");

		const hit = dupMatches.find((m: any) => m.app.name === "buildLinkedItemsList" && m.canon.name === "emptyTotals");
		expect(hit).toBeUndefined();
	});

	it("does NOT flag toNoteSnapshot as a duplicate of emptyTotals (FP, 0.73 in the real run)", async () => {
		const comp = await run();
		const dupMatches = comp.matches.filter((m: any) => m.decision.tier === "duplicate");

		const hit = dupMatches.find((m: any) => m.app.name === "toNoteSnapshot" && m.canon.name === "emptyTotals");
		expect(hit).toBeUndefined();
	});

	it("STILL flags emptyTotalsCopy as a duplicate of emptyTotals (TRUE twin — regression guard)", async () => {
		const comp = await run();
		const dupMatches = comp.matches.filter((m: any) => m.decision.tier === "duplicate");

		const hit = dupMatches.find((m: any) => m.app.name === "emptyTotalsCopy" && m.canon.name === "emptyTotals");
		expect(hit).toBeTruthy();
	});
});
