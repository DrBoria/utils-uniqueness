import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const main = require("../main.js");
const { normalizeOptions } = require("../config.js");
const { whenReady } = require("../playgrounds/typescript.js");

const pluginDir = path.resolve(__dirname, "..");

// Ground-truth cases from the REAL run (reports/utils-duplicates.md, 504 app
// files / 2353 app utils / 71 canonicals). Each fixture replicates the exact
// source shape of a verified finding:
//   TRUE   money            -> formatMoney      (1.00, byte-identical twin)
//   TRUE   parseDay         -> parseDayParam    (0.91, renamed param)
//   FALSE  parseDay         -> formatIsoDay     (0.88, inverse operation)
//   FALSE  teamKeyByValue   -> enumKeys         (0.77, lookup vs key-listing)
//   FALSE  contactTypes     -> enumValues       (0.76, label-map vs enum values)
//   FALSE  isTerminalStatus -> celsiusToFahrenheit (0.55, bool check vs math)
//   FALSE  any zero-arg     -> date/datetime    (0.53, deprecated throw-stubs)
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

describe("ground truth — real-run findings, replicated in test data", () => {
	it("flags parseDay as a duplicate of parseDayParam (TRUE, 0.91 in the real run)", async () => {
		const comp = await run();
		const dupMatches = comp.matches.filter((m: any) => m.decision.tier === "duplicate" && m.app.name === "parseDay");

		// The best (highest-confidence) duplicate match must be parseDayParam.
		const best = dupMatches.sort((a: any, b: any) => b.decision.confidence - a.decision.confidence)[0];
		expect(best).toBeTruthy();
		expect(best.canon.name).toBe("parseDayParam");
	});

	it("does NOT flag parseDay as a duplicate of formatIsoDay (inverse operation, 0.88 in the real run)", async () => {
		const comp = await run();
		const dupMatches = comp.matches.filter((m: any) => m.decision.tier === "duplicate");

		const hit = dupMatches.find((m: any) => m.app.name === "parseDay" && m.canon.name === "formatIsoDay");
		expect(hit).toBeUndefined();
	});

	it("does NOT flag teamKeyByValue as a duplicate of enumKeys (FP, 0.77 in the real run)", async () => {
		const comp = await run();
		const dupNames = new Set(comp.matches.filter((m: any) => m.decision.tier === "duplicate").map((m: any) => m.app.name));

		expect(dupNames.has("teamKeyByValue")).toBe(false);
	});

	it("does NOT flag contactTypes as a duplicate of enumValues (FP, 0.76 in the real run)", async () => {
		const comp = await run();
		const dupNames = new Set(comp.matches.filter((m: any) => m.decision.tier === "duplicate").map((m: any) => m.app.name));

		expect(dupNames.has("contactTypes")).toBe(false);
	});

	it("does NOT report isTerminalStatus as similar to celsiusToFahrenheit (FP, 0.55 in the real run)", async () => {
		const comp = await run();

		const hit = comp.matches.find((m: any) => m.app.name === "isTerminalStatus" && m.canon.name === "celsiusToFahrenheit");
		expect(hit).toBeUndefined();
	});

	it("does NOT report zero-arg one-liners as similar to deprecated throw-stubs (FP, 0.53 in the real run)", async () => {
		const comp = await run();

		const hits = comp.matches.filter((m: any) => m.app.name === "todayIso" && (m.canon.name === "date" || m.canon.name === "datetime"));
		expect(hits).toEqual([]);
	});
});
