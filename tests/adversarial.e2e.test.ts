import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const main = require("../dist/main.js");
const { normalizeOptions, isIgnored } = require("../dist/config.js");
const { whenReady } = require("../dist/playgrounds/typescript.js");

// ── ADVERSARIAL E2E ─────────────────────────────────────────────────────────
// Runs the real pipeline against the adversarial fixtures (20 hard traps) and
// scores every trap exactly as the old adversarial harness did. Locks the
// detector ground truth so a future change cannot silently drop a caught trap
// or flag a legitimate look-alike. The fixtures live INSIDE this package at
// tests/duplicates (app side), tests/NOT_duplicates (canon side) with the trap
// manifest at tests/manifest.json (see tests/TRAPS.md).
//
// Known, documented gaps are asserted as MISS (not silently passed): the AST-veto
// (AST_VETO_THRESHOLD 0.75) intentionally demotes renamed/inlined copies whose
// call graph differs (u01/u02/u06/u15/u18) and u10 stays below `similar`.
// (u16 is caught under the consolidated repo-root scan.)
// This is a deliberate precision trade-off — do NOT weaken the veto to pass these.
// No trap may FAIL (a false duplicate on an expect:none).

const pluginDir = path.resolve(__dirname, "..");
const manifestPath = path.join(pluginDir, "tests", "manifest.json");

const fs = require("node:fs") as typeof import("node:fs");

const pairKey = (a: string, b: string) => [a, b].sort().join("::");

const verdict = (expect: string, tiers: string[]): "PASS" | "MISS" | "FAIL" => {
	if (expect === "none") return tiers.includes("duplicate") ? "FAIL" : "PASS";
	if (expect === "similar") return tiers.some((t) => ["similar", "extract", "duplicate"].includes(t)) ? "PASS" : "MISS";
	if (expect === "extract") return tiers.some((t) => ["extract", "duplicate"].includes(t)) ? "PASS" : "MISS";
	return tiers.includes(expect) ? "PASS" : "MISS";
};

describe("adversarial utils e2e (fixture ground truth)", () => {
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	let comp: any;

	// Default thresholds (the fixture config sets none) — matching the harness.
	const buildReport = async () => {
		const config = normalizeOptions({ root: pluginDir, utilsFolder: ["tests/NOT_duplicates"], parts: true });
		await whenReady(config);
		return main.buildUtilsReport(
			{ appRoots: ["tests/duplicates"], minCluster: 3, verbose: false, parts: true },
			pluginDir,
			["tests/NOT_duplicates"],
			config,
			null,
			[],
		);
	};

	it("builds the report once", async () => {
		comp = await buildReport();
		expect(comp.canonCount).toBeGreaterThan(10);
		expect(comp.appCount).toBeGreaterThan(10);
	});

	const tiersOf = (a: { file: string; name: string }, b: { file: string; name: string }): string[] => {
		const want = pairKey(`${a.file}#${a.name}`, `${b.file}#${b.name}`);
		return (comp?.matches ?? [])
			.filter((m: any) => pairKey(`${m.app.path}#${m.app.name}`, `${m.canon.path}#${m.canon.name}`) === want)
			.map((m: any) => m.decision.tier);
	};

	it.each(manifest.traps.map((t: any) => [t.id, t]))("%s — %s", async (_id: string, trap: any) => {
		if (!comp) comp = await buildReport();
		const tiers = tiersOf(trap.a, trap.b);
		const v = verdict(trap.expect, tiers);
		expect(v, `${trap.id} (${trap.title}): expected ${trap.expect}, got [${tiers.join(",") || "—"}]`).not.toBe("FAIL");
	});

	it("never flags a look-alike (expect:none) as a duplicate", async () => {
		if (!comp) comp = await buildReport();
		const failures = manifest.traps
			.filter((t: any) => t.expect === "none")
			.filter((t: any) => verdict(t.expect, tiersOf(t.a, t.b)) === "FAIL");
		expect(failures.map((t: any) => t.id)).toEqual([]);
	});

	it("holds the documented detection floor (no regression below 13/20)", async () => {
		if (!comp) comp = await buildReport();
		const pass = manifest.traps.filter((t: any) => verdict(t.expect, tiersOf(t.a, t.b)) === "PASS").length;
		// Round-1 ground truth: 13 PASS, 7 MISS (AST-veto demotions), 0 FAIL.
		expect(pass).toBeGreaterThanOrEqual(13);
	});

	it("keeps the AST-veto gaps as MISS, not silent passes (u01, u02)", async () => {
		if (!comp) comp = await buildReport();
		for (const id of ["u01", "u02"]) {
			const trap = manifest.traps.find((t: any) => t.id === id);
			expect(trap).toBeTruthy();
			expect(verdict(trap.expect, tiersOf(trap.a, trap.b))).toBe("MISS");
		}
	});
});
