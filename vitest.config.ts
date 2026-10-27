import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts"],
		exclude: ["tests/NOT_duplicates/testfiles/**", "**/node_modules/**"],
		testTimeout: 120000,
		hookTimeout: 120000,
	},
});
