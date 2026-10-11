import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const main = require("../main.js");
const { normalizeOptions } = require("../config.js");
const { whenReady } = require("../playgrounds/typescript.js");

const pluginDir = path.resolve(__dirname, "..");

// Canonical utils (the public API) live in tests/utils; the app is scanned
// across BOTH a `duplicates` folder (renamed copies of the canonicals) and a
// `NOT_duplicates` folder (same shape, different operation). The pipeline must
// flag the former as duplicates of the right canonical and must NOT flag the
// latter.
const CANON_ROOTS = ["tests/utils"];
const APP_ROOTS = ["tests/duplicates", "tests/NOT_duplicates"];

const buildConfig = () =>
	normalizeOptions({
		root: pluginDir,
		utilsFolder: CANON_ROOTS,
		thresholds: { duplicate: 0.7, similar: 0.5 },
	});

describe("boundary — duplicates vs NOT_duplicates", () => {
	it("flags renamed copies as duplicates of the right canonical", async () => {
		const config = buildConfig();
		await whenReady(config);

		const comp = await main.buildUtilsReport(
			{ appRoots: APP_ROOTS, minCluster: 3, verbose: false, parts: false },
			pluginDir,
			CANON_ROOTS,
			config,
			null,
			[],
		);

		const dupMatches = comp.matches.filter((m: any) => m.decision.tier === "duplicate");
		const byName = new Map(dupMatches.map((m: any) => [m.app.name, m]));

		// Every renamed copy is a duplicate of the correct canonical.
		expect(byName.get("capFirst")?.canon.name).toBe("capitalize");
		expect(byName.get("toSlug")?.canon.name).toBe("slugify");
		expect(byName.get("shorten")?.canon.name).toBe("truncate");
		expect(byName.get("glue")?.canon.name).toBe("joinParts");
		expect(byName.get("bound")?.canon.name).toBe("clamp");
		expect(byName.get("money")?.canon.name).toBe("formatMoney");
		expect(byName.get("totalUp")?.canon.name).toBe("safeSum");
		expect(byName.get("keyMap")?.canon.name).toBe("indexBy");

		// TP regression guards for the real-run TRUE duplicates that the
		// precision gates (object-property tree, find-lookup) must NOT demote.
		expect(byName.get("clean")?.canon.name).toBe("trimmed");
		expect(byName.get("requisitionDiagnoses")?.canon.name).toBe("dedupeRows");
	});

	it("flags identical one-liners (right at the complexity gate) as duplicates", async () => {
		const config = buildConfig();
		await whenReady(config);

		const comp = await main.buildUtilsReport(
			{ appRoots: APP_ROOTS, minCluster: 3, verbose: false, parts: false },
			pluginDir,
			CANON_ROOTS,
			config,
			null,
			[],
		);

		const dupMatches = comp.matches.filter((m: any) => m.decision.tier === "duplicate");
		const byName = new Map(dupMatches.map((m: any) => [m.app.name, m]));

		// `cash` is a byte-for-byte twin of `moneyOrNone` (all four signals
		// should be ~1.00). The complexity gate must not cap such a pair at
		// "similar" just because a one-liner has few tree nodes.
		expect(byName.get("cash")?.canon.name).toBe("moneyOrNone");
	});

	it("does NOT flag same-shape-but-different-operation utils as duplicates", async () => {
		const config = buildConfig();
		await whenReady(config);

		const comp = await main.buildUtilsReport(
			{ appRoots: APP_ROOTS, minCluster: 3, verbose: false, parts: false },
			pluginDir,
			CANON_ROOTS,
			config,
			null,
			[],
		);

		const dupNames = new Set(comp.matches.filter((m: any) => m.decision.tier === "duplicate").map((m: any) => m.app.name));

		// None of the NOT_duplicates may be in the duplicate tier.
		//
		// Regression (Fix 7): perMonth vs moneyOrNone are both
		// `x === undefined ? undefined : \`$${x}...\`` one-liners. Once the
		// template's static text became part of the fingerprint, their AST
		// dropped to ~0.63 — above the plain AST veto (0.6) — and the pair
		// escaped to the duplicate tier at conf 0.86. Different operations
		// (currency vs monthly rate) must stay in the similar tier.
		//
		// Regression (Fix 8): keyOf (`` `${row.system}|${row.code}` ``)
		// over-matched the canonical formatAtTime (`` `${t.formatDay} at ${t.formatTime}` ``)
		// at 0.92 in the real run — structure 1.00, controlFlow 1.00, ast 0.66.
		// Every template one-liner shares the same pattern-level skeleton, so
		// a composite-key builder and a timestamp display must stay in the
		// similar tier.
		for (const name of ["reverseWord", "wordCount", "padEnd", "lerp", "pct", "yearOf", "perMonth", "argMax", "countBy", "keyOf"]) {
			expect(dupNames.has(name)).toBe(false);
		}
	});

	it("STILL flags a genuine renamed template one-liner copy as a duplicate (Fix 8 regression guard)", async () => {
		const config = buildConfig();
		await whenReady(config);

		const comp = await main.buildUtilsReport(
			{ appRoots: APP_ROOTS, minCluster: 3, verbose: false, parts: false },
			pluginDir,
			CANON_ROOTS,
			config,
			null,
			[],
		);

		const dupMatches = comp.matches.filter((m: any) => m.decision.tier === "duplicate");
		const byName = new Map(dupMatches.map((m: any) => [m.app.name, m]));

		// `formatAtTimeCopy` is a renamed copy of `formatAtTime` — both are
		// template one-liners with the same static text. The template gate
		// must not demote genuine twins.
		expect(byName.get("formatAtTimeCopy")?.canon.name).toBe("formatAtTime");
	});
});
