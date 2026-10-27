import { describe, expect, it } from "vitest";
import { resolve, dirname, join } from "node:path";
import { pickRepoRoot } from "../config";

// The tool lives in its OWN git repo (a nested .git inside utils-uniqueness),
// while the consumer project (chomp-2) has its own .git one level up. Walking
// up from the tool dir finds the tool's root — the WRONG anchor for resolving
// scan roots like "core/utils/utils". pickRepoRoot must anchor on the config
// file's directory (which sits in the consumer's tree) instead.
const REPO_ROOT = resolve(__dirname, "..", "..");
const TOOL_DIR = resolve(__dirname, "..");
const CONFIG_IN_CONSUMER = join(REPO_ROOT, "cleanup-tools", "eslint.config.js");

describe("pickRepoRoot anchors on the config file, not the tool's own .git", () => {
	it("with a config source in the consumer tree, returns the consumer root", () => {
		expect(pickRepoRoot({ cwd: TOOL_DIR, configSource: CONFIG_IN_CONSUMER })).toBe(REPO_ROOT);
	});

	it("without a config source, falls back to the cwd's own repo root (the tool)", () => {
		expect(pickRepoRoot({ cwd: TOOL_DIR })).toBe(TOOL_DIR);
	});

	it("an explicit --repo-root always wins", () => {
		expect(pickRepoRoot({ cwd: TOOL_DIR, configSource: CONFIG_IN_CONSUMER, explicitRepoRoot: REPO_ROOT })).toBe(REPO_ROOT);
	});

	it("a config source in the tool tree does not escape the tool root", () => {
		const toolConfig = join(TOOL_DIR, "eslint.config.js");
		expect(pickRepoRoot({ cwd: TOOL_DIR, configSource: toolConfig })).toBe(TOOL_DIR);
	});
});
