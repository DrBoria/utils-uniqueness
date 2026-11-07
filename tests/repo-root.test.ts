import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pickRepoRoot } from "../config";

// The tool may live in its OWN git repo (a nested .git), while the consumer
// project has its own .git somewhere above the config file. Walking up from the
// tool dir finds the tool's root — the WRONG anchor for resolving scan roots like
// `core/utils/utils`. pickRepoRoot must anchor on the config file's directory
// (which sits in the consumer's tree) instead.
//
// The tree is built here instead of being assumed: a checkout layout is not a
// property of this rule, and the previous version pointed at a consumer project
// that does not exist in every environment.
let root: string;
let consumerRoot: string;
let toolDir: string;
let configInConsumer: string;

beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "uu-root-"));
	// consumer/                    ← the project being linted (its own .git)
	//   cleanup-tools/eslint.config.js
	//   tool/                      ← the tool, a nested repo of its own
	consumerRoot = path.join(root, "consumer");
	toolDir = path.join(consumerRoot, "cleanup-tools", "utils-uniqueness");
	fs.mkdirSync(path.join(consumerRoot, ".git"), { recursive: true });
	fs.mkdirSync(path.join(toolDir, ".git"), { recursive: true });
	configInConsumer = path.join(consumerRoot, "cleanup-tools", "eslint.config.js");
	fs.writeFileSync(configInConsumer, "module.exports = {};\n", "utf8");
});

afterAll(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

describe("pickRepoRoot anchors on the config file, not the tool's own .git", () => {
	it("with a config source in the consumer tree, returns the consumer root", () => {
		expect(pickRepoRoot({ cwd: toolDir, configSource: configInConsumer })).toBe(consumerRoot);
	});

	it("without a config source, falls back to the cwd's own repo root (the tool)", () => {
		expect(pickRepoRoot({ cwd: toolDir })).toBe(toolDir);
	});

	it("an explicit --repo-root always wins", () => {
		expect(pickRepoRoot({ cwd: toolDir, configSource: configInConsumer, explicitRepoRoot: consumerRoot })).toBe(consumerRoot);
	});

	it("a config source in the tool tree does not escape the tool root", () => {
		const toolConfig = path.join(toolDir, "eslint.config.js");
		fs.writeFileSync(toolConfig, "module.exports = {};\n", "utf8");
		expect(pickRepoRoot({ cwd: toolDir, configSource: toolConfig })).toBe(toolDir);
	});
});
