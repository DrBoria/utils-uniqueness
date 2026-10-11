import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { renderUtilsReport } = require("../report.js");

// The Duplicate / Similar sections only render APP-layer matches (layer matches
// go to the "Inside <folder>" sections), and the Trash section header shows the
// number of CLUSTERS. The summary header must count the SAME things the
// sections show, or the report contradicts itself (real run: header said
// "11 duplicate" while the Duplicate section showed 9 — the extra 2 were
// layer matches; header said "9 trash" while the section showed 4 clusters).
const match = (appPath: string, canonPath: string, tier: string, confidence = 0.9) => ({
	app: { name: "appFn", path: appPath, line: 1 },
	canon: { name: "canonFn", path: canonPath, line: 1 },
	decision: { tier, confidence, reason: `confidence ${confidence.toFixed(2)}` },
});

const buildComp = () => ({
	files: 3,
	appCount: 10,
	canonCount: 5,
	// 1 app duplicate + 1 app similar + 1 LAYER duplicate (inside utilsFolder).
	matches: [
		match("app/x.ts", "utils/u.ts", "duplicate"),
		match("app/y.ts", "utils/u.ts", "similar"),
		match("utils/a.ts", "utils/b.ts", "duplicate"),
	],
	dropped: [],
	missingClusters: [],
	appClusters: [],
	// 4 trash clusters, 2 members each = 8 members.
	trashClusters: [
		{ name: "isA", members: [{ name: "isA", path: "app/a.ts", line: 1, trashScore: 95 }, { name: "isA", path: "app/b.ts", line: 2, trashScore: 95 }] },
		{ name: "isB", members: [{ name: "isB", path: "app/c.ts", line: 3, trashScore: 90 }, { name: "isB", path: "app/c2.ts", line: 3, trashScore: 90 }] },
		{ name: "isC", members: [{ name: "isC", path: "app/d.ts", line: 4, trashScore: 85 }, { name: "isC", path: "app/d2.ts", line: 4, trashScore: 85 }] },
		{ name: "isD", members: [{ name: "isD", path: "app/e.ts", line: 5, trashScore: 80 }, { name: "isD", path: "app/e2.ts", line: 5, trashScore: 80 }] },
	],
	parts: [],
	layerFolders: ["utils"],
});

describe("renderUtilsReport — header must agree with the sections", () => {
	it("counts only app-layer duplicates, not layer matches", () => {
		const md = renderUtilsReport(buildComp(), false);
		const header = md.split("\n").find((l) => l.startsWith("Found "));
		expect(header).toBeDefined();
		// The Duplicate section shows exactly 1 app duplicate.
		expect(md).toContain("## Duplicate (confidence ≥ threshold) (1)");
		// The header must therefore also say 1 duplicate, not 2.
		expect(header).toContain("Found 1 duplicate util(s)");
	});

	it("counts trash members consistently with the trash section", () => {
		const md = renderUtilsReport(buildComp(), false);
		const header = md.split("\n").find((l) => l.startsWith("Found "));
		// 4 clusters → section header shows (4); 8 members total.
		expect(md).toContain("## Trash — inline these (4)");
		expect(header).toContain("8 valueless one-liner(s) flagged as trash");
	});
});
