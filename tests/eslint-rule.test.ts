import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const plugin = require("../dist/index.js");
const { parseFunctions } = require("../dist/playgrounds/typescript.js");
const { buildCandidate } = require("../dist/normalize/candidate.js");

// This exercises the ESLint RULE (index.js -> createRule), which is a DIFFERENT
// code path from the CLI (main.js). Every other test in this folder drives the
// CLI. The rule reads a PRECOMPUTED catalog from disk and inspects EVERY
// function in the file — exported, non-exported, nested, anonymous callbacks.
// There is no exported-only contract: all functions are comparable.
const rule = plugin.rules["utils-uniqueness"];
const pluginDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginDir, "..");
const canonDir = path.join(pluginDir, "tests", "utils");

const rel = (abs) => path.relative(repoRoot, abs).split(path.sep).join("/");

// Build the canonical catalog the same way the CLI does — EVERY function in
// the canonical files (exported or not), with paths relative to repoRoot so
// the rule's canSeeCanon sees the same relative space it computes for the app
// files.
const buildCatalog = () => {
	const utils = [];
	for (const name of fs.readdirSync(canonDir).filter((f) => f.endsWith(".ts")).sort()) {
		const abs = path.join(canonDir, name);
		for (const d of parseFunctions(abs)) {
			utils.push({ ...buildCandidate(d, {}), path: rel(abs) });
		}
	}
	return { generatedAt: "test", utils };
};

let tmpCatalog = "";
beforeAll(() => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uu-catalog-"));
	tmpCatalog = path.join(dir, "utils-catalog.json");
	fs.writeFileSync(tmpCatalog, JSON.stringify(buildCatalog()), "utf8");
});
afterAll(() => {
	fs.rmSync(path.dirname(tmpCatalog), { recursive: true, force: true });
});

// Minimal ESLint rule context — just enough surface for createRule().
const runRule = (fileRel, options) => {
	const filename = path.join(repoRoot, fileRel);
	const messages = [];
	const ctx = {
		filename,
		cwd: repoRoot,
		options: [options],
		getFilename: () => filename,
		report: (desc) => messages.push(desc),
	};
	const handlers = rule.create(ctx);
	handlers["Program:exit"]();
	return messages;
};

const baseOptions = (extra = {}) => ({
	catalogPath: tmpCatalog,
	utilsFolder: [rel(canonDir)],
	thresholds: { duplicate: 0.7, similar: 0.6 },
	...extra,
});

describe("ESLint rule (createRule) — the path no CLI test covers", () => {
	it("flags an EXPORTED function that duplicates a canonical util", () => {
		const messages = runRule("utils-uniqueness/tests/duplicates/numberDups.ts", baseOptions());

		expect(messages.length).toBeGreaterThan(0);
		const money = messages.find((m) => m.message.includes("`money`") && m.message.includes("`formatMoney`"));
		expect(money).toBeDefined();
		// The editor prints the SAME sentence the terminal report and the HTML page
		// print for the same pair — it is rendered from the shared code table.
		expect(money.message).toContain("repeats the canonical");
	});

	it("flags a NON-exported function that is an exact copy of a canonical", () => {
		// nonExportedDups.ts holds hiddenMoney (a byte-for-byte copy of
		// formatMoney) that is NOT exported, plus an exported `tag` that is not
		// a duplicate of anything. There is no exported-only contract: the
		// non-exported copy MUST be flagged, and `tag` must stay silent.
		const messages = runRule("utils-uniqueness/tests/duplicates/nonExportedDups.ts", baseOptions());

		const hidden = messages.find((m) => m.message.includes("`hiddenMoney`") && m.message.includes("`formatMoney`"));
		expect(hidden).toBeDefined();
		expect(hidden.message).toContain("repeats the canonical");
		expect(messages.find((m) => m.message.includes("`tag`"))).toBeUndefined();
	});

	it("flags a NESTED function (function inside a function) that copies a canonical", () => {
		// nestedAnonDups.ts: outerWithNested declares `formatOne` INSIDE its
		// body — a byte-for-byte copy of formatMoney. The rule must see it.
		const messages = runRule("utils-uniqueness/tests/duplicates/nestedAnonDups.ts", baseOptions());

		const nested = messages.find((m) => m.message.includes("`formatOne`") && m.message.includes("`formatMoney`"));
		expect(nested).toBeDefined();
		expect(nested.message).toContain("repeats the canonical");
	});

	it("flags an ANONYMOUS .map() callback that copies a canonical", () => {
		// nestedAnonDups.ts: mapAnon passes an unnamed arrow to .map() whose
		// body is the exact formatMoney block. Unnamed functions get a
		// synthetic owner-scoped name (#anon@line) and are compared by
		// everything else (structure, not name).
		const messages = runRule("utils-uniqueness/tests/duplicates/nestedAnonDups.ts", baseOptions());

		const anon = messages.find((m) => m.message.includes("`formatMoney`") && /#anon@/.test(m.message));
		expect(anon).toBeDefined();
	});

	it("reports a PARTIAL duplicate (partOfUtil) when parts is enabled", () => {
		// nestedAnonDups.ts: `wrapper` is not a copy of formatMoney, but it
		// contains an anonymous arrow whose body IS the exact formatMoney
		// block. With parts: true the rule must report that block as a part
		// of the canonical.
		const messages = runRule("utils-uniqueness/tests/duplicates/nestedAnonDups.ts", baseOptions({ parts: true }));

		const part = messages.find((m) => m.message.includes("repeats") && m.message.includes("`formatMoney`") && m.message.includes("block inside"));
		expect(part).toBeDefined();
	});

	it("is silent when the catalog is missing (rule degrades off, not an error)", () => {
		const missing = path.join(repoRoot, "reports", "no-such-catalog.json");
		const messages = runRule("utils-uniqueness/tests/duplicates/numberDups.ts", baseOptions({ catalogPath: missing }));

		expect(messages).toEqual([]);
	});
});
