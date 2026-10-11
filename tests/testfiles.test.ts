import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const main = require("../main.js");
const { normalizeOptions } = require("../config.js");

const pluginDir = path.resolve(__dirname, "..");

// Test files (*.test.ts, *.e2e.ts, …) are scanned as app utils today, so the
// report recommends "extract to shared util" for test helpers (seedPatient ×3,
// row ×3, …) — pure noise. They must be excluded by default.
describe("test-file exclusion (default)", () => {
	it("collectFiles skips *.test.ts and *.e2e.ts by default", () => {
		const config = normalizeOptions({ root: pluginDir });
		const shouldSkip = (abs: string) => {
			const rel = path.relative(pluginDir, abs).split(path.sep).join("/");
			return require("../config.js").isIgnored(rel, [], config.exclude);
		};
		const { files } = main.collectFiles(["tests/NOT_duplicates/testfiles"], pluginDir, shouldSkip, config.exts, config.ignoreDirs);

		const rels = files.map((f: any) => f.rel);
		expect(rels).toContain("tests/NOT_duplicates/testfiles/prod.ts");
		expect(rels).not.toContain("tests/NOT_duplicates/testfiles/prod.test.ts");
		expect(rels).not.toContain("tests/NOT_duplicates/testfiles/prod.e2e.ts");
	});

	it("normalizeOptions carries the default test-file patterns", () => {
		const config = normalizeOptions({ root: pluginDir });

		expect(config.exclude.some((p: string) => String(p).includes("test"))).toBe(true);
		expect(config.exclude.some((p: string) => String(p).includes("e2e"))).toBe(true);
	});

	it("an explicit exclude still applies on top of the defaults", () => {
		const config = normalizeOptions({ root: pluginDir, exclude: ["**/prod.ts"] });
		const shouldSkip = (abs: string) => {
			const rel = path.relative(pluginDir, abs).split(path.sep).join("/");
			return require("../config.js").isIgnored(rel, [], config.exclude);
		};
		const { files } = main.collectFiles(["tests/NOT_duplicates/testfiles"], pluginDir, shouldSkip, config.exts, config.ignoreDirs);

		expect(files).toHaveLength(0);
	});
});
