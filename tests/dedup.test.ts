import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { dedupPairs, capSimilarFanout } = require("../main.js");

// A match record as produced by matchPairs: { app, canon, decision, tier, reason }.
const match = (appPath: string, appName: string, canonPath: string, canonName: string, confidence: number, tier = "duplicate") => ({
	app: { path: appPath, name: appName },
	canon: { path: canonPath, name: canonName },
	decision: { confidence, tier, reason: `confidence ${confidence.toFixed(2)}` },
	tier,
	reason: `confidence ${confidence.toFixed(2)}`,
});

describe("dedupPairs", () => {
	it("collapses overloads: same app location + same canonical keeps the best confidence", () => {
		// Two descriptors for the same function (overload + implementation)
		// share path + name; only the strongest row survives.
		const kept = dedupPairs([
			match("app/a.ts", "graphql", "utils/u.ts", "parse", 0.7),
			match("app/a.ts", "graphql", "utils/u.ts", "parse", 0.9),
		]);

		expect(kept).toHaveLength(1);
		expect(kept[0].decision.confidence).toBe(0.9);
	});

	it("keeps distinct functions that share a name in different files", () => {
		// Ground truth (real run): two different `parseDay` functions in two
		// files both duplicate `parseDayParam` — the name-only key collapsed
		// them and hid a true duplicate.
		const kept = dedupPairs([
			match("app/a.ts", "parseDay", "utils/tx.ts", "parseDayParam", 0.91),
			match("app/b.ts", "parseDay", "utils/tx.ts", "parseDayParam", 0.87),
		]);

		expect(kept).toHaveLength(2);
	});

	it("keeps distinct functions that share a name and match the same canonical in different files", () => {
		// Ground truth (real run): `clean` in allergens/parsers.ts and
		// `clean` in rxnav/parsers.ts both duplicate `trimmed` at 0.98.
		const kept = dedupPairs([
			match("layer/a/parsers.ts", "clean", "layer/x/fhir.ts", "trimmed", 0.98),
			match("layer/b/parsers.ts", "clean", "layer/x/fhir.ts", "trimmed", 0.98),
		]);

		expect(kept).toHaveLength(2);
	});

	it("keeps the same function matching two different canonicals", () => {
		const kept = dedupPairs([
			match("app/a.ts", "f", "utils/u1.ts", "g1", 0.8),
			match("app/a.ts", "f", "utils/u2.ts", "g2", 0.75),
		]);

		expect(kept).toHaveLength(2);
	});
});

describe("capSimilarFanout", () => {
	it("caps fanout per app function, not per name: same name in different files are not capped against each other", () => {
		// Ground truth (real run): `parseDay` in lab-orders-filters.tsx and
		// `parseDay` in note-vitals-embed.ts are different functions; the
		// name-only group capped them together.
		const kept = capSimilarFanout([
			match("app/a.ts", "parseDay", "utils/tx.ts", "formatIsoDay", 0.88, "similar"),
			match("app/b.ts", "parseDay", "utils/tx.ts", "parseIsoTstz", 0.79, "similar"),
			match("app/c.ts", "parseDay", "utils/tx.ts", "parseDayParam", 0.7, "similar"),
		]);

		// Each distinct function keeps its own top-2 fanout; all three are
		// the best match of their own function.
		expect(kept).toHaveLength(3);
	});

	it("still caps one function's fanout to the top two canonicals", () => {
		const kept = capSimilarFanout([
			match("app/a.ts", "f", "utils/u1.ts", "g1", 0.85, "similar"),
			match("app/a.ts", "f", "utils/u2.ts", "g2", 0.8, "similar"),
			match("app/a.ts", "f", "utils/u3.ts", "g3", 0.75, "similar"),
		]);

		expect(kept).toHaveLength(2);
		const names = kept.map((m: any) => m.canon.name).sort();
		expect(names).toEqual(["g1", "g2"]);
	});

	it("does not cap duplicate-tier rows", () => {
		const kept = capSimilarFanout([
			match("app/a.ts", "f", "utils/u1.ts", "g1", 0.9),
			match("app/a.ts", "f", "utils/u2.ts", "g2", 0.85),
			match("app/a.ts", "f", "utils/u3.ts", "g3", 0.8),
		]);

		expect(kept).toHaveLength(3);
	});
});
