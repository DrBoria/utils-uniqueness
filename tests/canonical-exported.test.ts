import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const main = require("../main.js");
const { normalizeOptions } = require("../config.js");
const { whenReady } = require("../playgrounds/typescript.js");

const pluginDir = path.resolve(__dirname, "..");

// The canonical folder (tests/utils) holds both:
//   - an EXPORTED object builder (exportedBuild, public API) -> a valid reuse target
//   - a PRIVATE object builder (privateBuild, internal helper) -> must NOT be a reuse target
// The app side (tests/NOT_duplicates/app-build.ts) holds an object builder that is
// structurally identical to privateBuild. If the private canonical leaks into the
// catalog, the app builder can match it and be flagged as a duplicate of a function
// it cannot import.
const CANON_ROOTS = ["tests/utils"];
const APP_ROOTS = ["tests/duplicates", "tests/NOT_duplicates"];

const buildConfig = () =>
	normalizeOptions({
		root: pluginDir,
		utilsFolder: CANON_ROOTS,
		thresholds: { duplicate: 0.7, similar: 0.5 },
	});

const runReport = async () => {
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

describe("canonical catalog is the public API (exported only)", () => {
	it("excludes private canonical helpers from the catalog", async () => {
		const comp = await runReport();

		const canonNames = comp.matches.map((m: any) => m.canon.name);
		// The catalog is not empty, and the private helper never appears in it.
		expect(canonNames.length).toBeGreaterThan(0);
		expect(canonNames).not.toContain("privateBuild");
	});

	it("does not flag an app util as a duplicate of a private canonical", async () => {
		const comp = await runReport();

		const dupMatches = comp.matches.filter((m: any) => m.decision.tier === "duplicate");
		// No duplicate may point at the private canonical.
		for (const m of dupMatches) {
			expect(m.canon.name).not.toBe("privateBuild");
		}
		// The app builder is structurally identical to privateBuild, not to the
		// exported canonical — it must never be a duplicate of privateBuild.
		const appBuildDups = dupMatches.filter((m: any) => m.app.name === "appBuild");
		for (const m of appBuildDups) {
			expect(m.canon.name).not.toBe("privateBuild");
		}
	});
});
