import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const pluginDir = path.resolve(__dirname, "..");
const mainJs = path.join(pluginDir, "main.js");
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "uu-cli-"));

afterAll(() => {
	rmSync(tmpRoot, { recursive: true, force: true });
});

const runCli = (args, opts = {}) => {
	const { spawnSync } = require("node:child_process");
	const res = spawnSync(process.execPath, [mainJs, ...args], {
		cwd: opts.cwd || pluginDir,
		encoding: "utf8",
		timeout: 240000,
	});
	if (res.error) throw res.error;
	if (res.status !== 0) throw new Error(`CLI exited ${res.status}: ${res.stderr}`);

	return `${res.stdout || ""}${res.stderr || ""}`;
};

const readReport = (report) => readFileSync(path.join(pluginDir, report), "utf8");

describe("CLI", () => {
	it("prints usage and exits 0 on --help", () => {
		const out = runCli(["--help"]);

		expect(out).toContain("Usage: utils-uniqueness");
	});

	it("fails on an unknown argument", () => {
		expect(() => runCli(["--nope"])).toThrow();
	});

	it("requires --roots without --files", () => {
		expect(() => runCli(["--repo-root", "."])).toThrow();
	});

	it(
		"--files scans only the listed files without --roots and skips the catalog",
		() => {
			const report = "reports/cli-files.md";
			const catalog = path.join(pluginDir, "reports", "utils-catalog.json");
			const before = existsSync(catalog) ? readFileSync(catalog, "utf8") : null;
			const out = runCli(["--repo-root", ".", "--roots", "tests/utils", "--files", "tests/utils/strings.ts", "--report", report]);
			const md = readReport(report);

			expect(out).toContain("wrote report");
			expect(md).toContain("Scanned 1 app file(s)");
			expect(md).toContain("capitalize");
			// a single-file scan must not clobber the folder-based catalog
			expect(existsSync(catalog) ? readFileSync(catalog, "utf8") : null).toBe(before);
		},
		30_000,
	);

	it("--files silently skips missing files", () => {
		const report = "reports/cli-files-missing.md";
		runCli(["--repo-root", ".", "--files", "tests/utils/does-not-exist.ts", "--report", report]);
		const md = readReport(report);

		expect(md).toContain("Scanned 0 app file(s)");
	});
});
