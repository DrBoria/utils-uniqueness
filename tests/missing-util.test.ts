import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const require = createRequire(import.meta.url);
const { whenReady, parseFunctions } = require("../playgrounds/typescript.js");
const { buildCandidate } = require("../normalize/candidate.js");
const { findMissingUtils, pairSimilarity } = require("../filter/missing-util.js");

// Parse a set of named functions from a single temp file into candidates.
const parseCandidates = async (source: string, names: string[]) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mu-test-"));
	const file = path.join(dir, "sample.ts");
	fs.writeFileSync(file, source, "utf8");
	const parsed = parseFunctions(file, { requireExported: false });
	return names.map((n) => {
		const d = parsed.find((p) => p.name === n);
		if (!d) throw new Error(`function ${n} not found`);
		return buildCandidate(d, {});
	});
};

// Build a "match" record as the pipeline hands it to findMissingUtils.
const mkMatch = (app: any, canon: any, confidence: number, tier: string) => ({
	app,
	canon,
	decision: { confidence, tier },
});

describe("findMissingUtils — clustering must require mutual similarity", () => {
	it("does NOT cluster unrelated functions that only share a canonical", async () => {
		await whenReady({});
		// Three genuinely different bodies: a map, a reduce, and a for-loop
		// accumulator. Each is "plausibly similar" to a generic canonical, but
		// they are not similar to each other. Before the fix they were all
		// dumped into one bogus cluster (e.g. 76 unrelated fns under
		// normalizeDuration).
		const [a, b, c] = await parseCandidates(
			[
				`export const buildGroup = (rows: any[]): any => ({ id: rows[0].id, name: rows[0].name, size: rows.length, items: rows.map((r) => r.id) });`,
				`export const walkTotals = (xs: number[]): number => { let t = 0; for (const x of xs) { if (x > 0) { t += x; } else { t -= x; } } return t; };`,
				`export const trimIt = (x: string): string => (x ? x.trim() : "");`,
			].join("\n"),
			["buildGroup", "walkTotals", "trimIt"],
		);
		// Guard: these really are dissimilar to one another, so a correct
		// clusterer must not group them. (matchStructure alone is too coarse —
		// a map vs a reduce scores 0.91 — so the clusterer must lean on the
		// composite that weights AST heavily.)
		expect(pairSimilarity(a, b)).toBeLessThan(0.6);
		expect(pairSimilarity(a, c)).toBeLessThan(0.6);

		const canon = a; // stand-in canonical they all "matched"
		const matches = [
			mkMatch(a, canon, 0.8, "similar"),
			mkMatch(b, canon, 0.8, "similar"),
			mkMatch(c, canon, 0.8, "similar"),
		];
		const { clusters } = findMissingUtils(matches, { minCluster: 3 });
		expect(clusters).toHaveLength(0);
	});

	it("does cluster genuinely similar functions that share a canonical", async () => {
		await whenReady({});
		// Three near-identical bodies (same shape, different names) — a real
		// missing-util signal.
		const [a, b, c] = await parseCandidates(
			[
				`export const fA = (x: string): string => (x ? x.trim() : "");`,
				`export const fB = (y: string): string => (y ? y.trim() : "");`,
				`export const fC = (z: string): string => (z ? z.trim() : "");`,
			].join("\n"),
			["fA", "fB", "fC"],
		);
		// Guard: these are genuinely similar to one another.
		expect(pairSimilarity(a, b)).toBeGreaterThan(0.6);

		const canon = a;
		const matches = [
			mkMatch(a, canon, 0.8, "similar"),
			mkMatch(b, canon, 0.8, "similar"),
			mkMatch(c, canon, 0.8, "similar"),
		];
		const { clusters } = findMissingUtils(matches, { minCluster: 3 });
		expect(clusters).toHaveLength(1);
	});

	it("does NOT cluster when the only anchor is a trivial canonical (e.g. a throw-stub)", async () => {
		await whenReady({});
		// Several genuinely similar app functions (a shared client-factory shape)
		// that all coincidentally matched the SAME trivial canonical — a deprecated
		// throw-stub like `date() { throw new Error(...) }` in zod.ts. The mutual
		// similarity is real, but the "shared canonical" evidence is vacuous (the
		// canonical is a 4-node throw), and naming the cluster after it
		// ("Shareddate") is misleading. A correct clusterer must not anchor a
		// cluster to a trivial canonical.
		const apps = await parseCandidates(
			[
				`export const allergies = () => new AppMedplumClient("AllergyIntolerance");`,
				`export const patients = () => new AppMedplumClient("Patient");`,
				`export const groups = () => new AppMedplumClient("Group");`,
			].join("\n"),
			["allergies", "patients", "groups"],
		);
		// Guard: the app fns are mutually similar (they are a real factory family).
		expect(pairSimilarity(apps[0], apps[1])).toBeGreaterThan(0.6);

		// The anchor canonical is a trivial throw-stub (nodeCount < 6).
		const [stub] = await parseCandidates(
			`export const date = () => { throw new Error("use day instead"); };`,
			["date"],
		);
		expect(stub.nodeCount).toBeLessThan(6);

		const matches = apps.map((app) => mkMatch(app, stub, 0.53, "similar"));
		const { clusters } = findMissingUtils(matches, { minCluster: 3 });
		expect(clusters).toHaveLength(0);
	});

	it("does NOT merge distinct template one-liners into one missing-util cluster (SharedR FP)", async () => {
		await whenReady({});
		// Ground truth from the REAL run: five different template one-liner
		// operations (a FHIR reference builder, a seed-id builder, and the
		// Snowflake F/E/R table-name builders) all matched the canonical `R`
		// and were merged into one bogus "SharedR" cluster. For template
		// one-liners the AST's sequence sub-score saturates (same pattern
		// skeleton) while the discriminating subtree sub-score stays low, so
		// the 0.6 pair floor let cross-operation pairs (0.47-0.86) cluster.
		// A missing-util cluster is a family of near-identical copies (~1.0);
		// different operations must not share one.
		const apps = await parseCandidates(
			[
				`export const ref = (type: string, id: string) => \`\${type}/\${id}\`;`,
				`export const seedId = (patientId: string, key: string, suffix = "") => \`\${key}\${suffix}-\${patientId}\`;`,
				`export const F = (table: string) => \`\${DB}.\${SCHEMA}.\${table}\`;`,
				`export const E = (table: string) => \`\${DB}.ELATION.\${table}\`;`,
			].join("\n"),
			["ref", "seedId", "F", "E"],
		);
		const canon = apps[0]; // stand-in for the canonical `R`
		const matches = apps.map((app) => mkMatch(app, canon, 0.8, "similar"));
		const { clusters } = findMissingUtils(matches, { minCluster: 3 });
		expect(clusters).toHaveLength(0);
	});
});
