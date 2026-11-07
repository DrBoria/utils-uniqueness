import { afterAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const plugin = require("../index.js");
const { parseFunctions } = require("../playgrounds/typescript.js");
const { buildCandidate } = require("../normalize/candidate.js");

// The rule reads a PRECOMPUTED catalog from disk, so the test builds one from
// the same shape the CLI produces. Everything below is driven through
// createRule() — the same entry the ESLint run uses.
const rule = plugin.rules["utils-uniqueness"];

// The same function, three times, in three sibling folders. Identical bodies
// make the pair a duplicate rather than a look-alike, so a test either sees the
// finding or does not.
const BODY = [
	"export function dupUtil(value: number) {",
	"  const doubled = value * 2;",
	"  const shifted = doubled + 1;",
	"  return shifted;",
	"}",
	"",
].join("\n");

const PAIR_OF_TWO = {
	"packages/a/one.ts": BODY,
	"packages/b/two.ts": BODY,
};

const THREE_FOLDERS = {
	...PAIR_OF_TWO,
	"packages/c/three.ts": BODY,
};

const A_B = [["packages/a/**", "packages/b/**"]];

const roots: string[] = [];

const projectWith = (files: Record<string, string>): { root: string; catalogPath: string } => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "uu-known-dups-"));
	roots.push(root);
	for (const [relPath, text] of Object.entries(files)) {
		const abs = path.join(root, relPath);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, text, "utf8");
	}

	// The catalog the rule compares against: every function of every file,
	// with paths relative to the temp root — the same space the rule uses.
	const utils: Array<Record<string, unknown>> = [];
	for (const relPath of Object.keys(files).sort()) {
		for (const declaration of parseFunctions(path.join(root, relPath))) {
			utils.push({ ...buildCandidate(declaration, {}), path: relPath });
		}
	}
	const catalogPath = path.join(root, "utils-catalog.json");
	fs.writeFileSync(catalogPath, JSON.stringify({ generatedAt: "test", utils }), "utf8");

	return { root, catalogPath };
};

// The rule's create() needs filename, options and report; the catalog is
// supplied explicitly, so no directory walk happens (cache: false).
const findingsFor = (
	project: { root: string; catalogPath: string },
	relPath: string,
	extra: Record<string, unknown> = {},
) => {
	const messages: Array<{ messageId: string; data: Record<string, string> }> = [];
	const context = {
		filename: path.join(project.root, relPath),
		cwd: project.root,
		options: [
			{
				root: project.root,
				catalogPath: project.catalogPath,
				utilsFolder: ["packages"],
				compareAll: true,
				cache: false,
				parts: false,
				thresholds: { duplicate: 0.7, similar: 0.6 },
				...extra,
			},
		],
		getFilename: () => path.join(project.root, relPath),
		report: (descriptor: { messageId: string; data: Record<string, string> }) => messages.push(descriptor),
	};
	const handlers = rule.create(context);
	handlers["Program:exit"]();

	return messages;
};

afterAll(() => {
	for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

describe("knownDuplicates", () => {
	it("reports the duplicate when no pair is declared", () => {
		const project = projectWith(PAIR_OF_TWO);
		const findings = findingsFor(project, "packages/a/one.ts");

		expect(findings).toHaveLength(1);
		expect(findings[0].messageId).toBe("duplicateUtil");
		expect(findings[0].data.name).toBe("dupUtil");
	});

	it("silences the declared pair, in both directions", () => {
		const project = projectWith(PAIR_OF_TWO);

		expect(findingsFor(project, "packages/a/one.ts", { knownDuplicates: A_B })).toHaveLength(0);
		expect(findingsFor(project, "packages/b/two.ts", { knownDuplicates: A_B })).toHaveLength(0);
	});

	it("still reports a declared folder against a place outside the pair", () => {
		const project = projectWith(THREE_FOLDERS);

		// `c` duplicates both `a` and `b`; only a↔b is excused.
		expect(findingsFor(project, "packages/c/three.ts", { knownDuplicates: A_B })).toHaveLength(1);

		// `a` is excused from `b`, so what remains is the duplicate with `c`.
		expect(findingsFor(project, "packages/a/one.ts", { knownDuplicates: A_B })).toHaveLength(1);
	});

	it("accepts exact file paths, not only folders", () => {
		const project = projectWith(PAIR_OF_TWO);
		const knownDuplicates = [["packages/a/one.ts", "packages/b/two.ts"]];

		expect(findingsFor(project, "packages/a/one.ts", { knownDuplicates })).toHaveLength(0);
		expect(findingsFor(project, "packages/b/two.ts", { knownDuplicates })).toHaveLength(0);
	});

	it("exact file paths excuse only those two files", () => {
		const project = projectWith(THREE_FOLDERS);
		const knownDuplicates = [["packages/a/one.ts", "packages/b/two.ts"]];

		expect(findingsFor(project, "packages/a/one.ts", { knownDuplicates })).toHaveLength(1);
		expect(findingsFor(project, "packages/c/three.ts", { knownDuplicates })).toHaveLength(1);
	});

	it("excuses each listed pair without making the group transitive", () => {
		// Three known groups over five folders: a-b, b-d, j-k. Inside a group the
		// pair is excused, but a-b plus b-d does NOT excuse a-d — the groups are
		// pairs, not a union.
		const folders = ["a", "b", "d", "j", "k"];
		const files: Record<string, string> = {};
		for (const folder of folders) files[`packages/${folder}/x.ts`] = BODY;
		const project = projectWith(files);
		const knownDuplicates = [
			["packages/a/**", "packages/b/**"],
			["packages/b/**", "packages/d/**"],
			["packages/j/**", "packages/k/**"],
		];

		// a is excused from b only, so it still duplicates d, j and k.
		expect(findingsFor(project, "packages/a/x.ts", { knownDuplicates })).toHaveLength(1);
		// d is excused from b only.
		expect(findingsFor(project, "packages/d/x.ts", { knownDuplicates })).toHaveLength(1);
		// j and k are excused from each other, nothing else.
		expect(findingsFor(project, "packages/j/x.ts", { knownDuplicates })).toHaveLength(1);
		expect(findingsFor(project, "packages/k/x.ts", { knownDuplicates })).toHaveLength(1);
	});

	it("works with many pairs, not just a couple", () => {
		const project = projectWith(PAIR_OF_TWO);
		const noise = Array.from({ length: 200 }, (_unused, index) => [
			`packages/noise-${index}/**`,
			`packages/noise-${index}-twin/**`,
		]);
		const knownDuplicates = [["packages/a/**", "packages/b/**"], ...noise];

		expect(findingsFor(project, "packages/a/one.ts", { knownDuplicates })).toHaveLength(0);
		expect(findingsFor(project, "packages/b/two.ts", { knownDuplicates })).toHaveLength(0);
	});
});
