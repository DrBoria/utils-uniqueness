import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const main = require("../main.js");
const { normalizeOptions } = require("../config.js");
const { whenReady } = require("../playgrounds/typescript.js");

const pluginDir = path.resolve(__dirname, "..");

// Ground truth: md-prettify/apps/backend/utils/ describes the same IDE
// decoration domain twice, split across ide-editor.ts and ide-types.ts.
// Interfaces are not functions, so the old functions-only collection never
// saw them; the type-extraction pass must surface the cross-file twins.
const APP_PAIR_ROOTS = ["tests/duplicates"];
const CANON_ROOTS = ["tests/utils"];

const run = async () => {
	const config = normalizeOptions({
		root: pluginDir,
		utilsFolder: CANON_ROOTS,
		thresholds: { duplicate: 0.7, similar: 0.5 },
		proposeUtils: true,
	});
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

describe("buildUtilsReport — split IDE interface domain (ide-editor.ts / ide-types.ts)", () => {
	it("extracts interfaces as type candidates (not just functions)", async () => {
		const comp = await run(true);
		const all = (comp.appClusters || []).flatMap((c: any) => c.members);

		// The base interface is byte-identical across the two files — it must
		// be visible to the pipeline at all (previously only functions were).
		expect(all.some((m: any) => m.name === "DecorationRenderOptionsBase")).toBe(true);
	}, 15000);

	it("clusters the identical cross-file interface as a worth-moving group", async () => {
		const comp = await run(true);

		expect(comp.appClusters).toBeTruthy();
		const cluster = comp.appClusters.find((c: any) =>
			c.members.some((m: any) => m.name === "DecorationRenderOptionsBase" && m.path.includes("ide-editor")) &&
			c.members.some((m: any) => m.name === "DecorationRenderOptionsBase" && m.path.includes("ide-types")),
		);
		expect(cluster).toBeTruthy();
		expect(cluster.confidence).toBeGreaterThanOrEqual(0.7);
	}, 15000);
});
