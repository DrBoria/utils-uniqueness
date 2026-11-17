import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const require = createRequire(import.meta.url);
const { whenReady, parseFunctions } = require("../dist/playgrounds/typescript.js");
const { buildCandidate } = require("../dist/normalize/candidate.js");
const { collectOverviewData } = require("../dist/report/user-report/data/collect.js");

// A ribbon must connect rows that are the SAME subject. Two bugs broke that:
//   1. a TYPE-position member (`{ id: string }` in a return type / `as` cast) shared
//      the `prop` kind with a VALUE property (`{ id: payload.id }`), so one lane
//      spanned the declaration head and the body;
//   2. the glue merged a head row into a body lane across the declaration boundary.
// These lock the structural fix: type members are `type-prop`, value properties are
// `prop`, and no lane mixes the head with the body.

const writeFixture = (source: string) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lane-test-"));
	const file = path.join(dir, "sample.ts");
	fs.writeFileSync(file, source, "utf8");
	return { dir, file };
};

const candidateOf = (file: string, name: string) => {
	const parsed = parseFunctions(file);
	const descriptor = parsed.find((p: any) => p.name === name);
	if (!descriptor) throw new Error(`function ${name} not found`);
	return buildCandidate(descriptor, {});
};

describe("type members are a different kind from value properties", () => {
	it("splits PropertySignature (type-prop) from PropertyAssignment (prop)", async () => {
		await whenReady({});
		const { file } = writeFixture(
			`export function loadUser(fetcher: any, userId: string): Promise<{ id: string; name: string }> {
	const payload = (await fetcher(userId)) as { id?: unknown; name?: unknown };
	return { id: payload.id, name: payload.name };
}`,
		);
		const cand = candidateOf(file, "loadUser");
		const idSites = cand.names.filter((s: any) => s.name === "id");
		const kinds = new Set(idSites.map((s: any) => s.kind));
		// The return-type / cast members are type-prop; the returned object's key is prop.
		expect(kinds.has("type-prop")).toBe(true);
		expect(kinds.has("prop")).toBe(true);
		// The value property sits on the return row, the type members on the head/cast rows.
		const valueProp = idSites.find((s: any) => s.kind === "prop");
		const typeProp = idSites.find((s: any) => s.kind === "type-prop");
		expect(valueProp.line).not.toBe(typeProp.line);
	});
});

describe("no lane bridges the declaration head and the body", () => {
	it("keeps property assignments in the body, property signatures separate", async () => {
		await whenReady({});
		const app = writeFixture(
			`export function fetchUserById(fetcher: any, userId: string): Promise<{ id: string; name: string }> {
	return fetcher(userId).then((data: any) => {
		const payload = data as { id?: unknown; name?: unknown };
		return { id: payload.id, name: payload.name };
	});
}`,
		);
		const canon = writeFixture(
			`export async function loadUser(fetcher: any, userId: string): Promise<{ id: string; name: string }> {
	const payload = (await fetcher(userId)) as { id?: unknown; name?: unknown };
	return { id: payload.id, name: payload.name };
}`,
		);
		const repoRoot = os.tmpdir();
		const rel = (abs: string) => path.relative(repoRoot, abs).split(path.sep).join("/");
		// The candidates map keys on `candidate.path#name`, so the candidates carry the
		// SAME relative path the finding names.
		const appCand = { ...candidateOf(app.file, "fetchUserById#anon@2"), path: rel(app.file) };
		const canonCand = { ...candidateOf(canon.file, "loadUser"), path: rel(canon.file) };
		const finding = {
			id: `duplicate:${rel(app.file)}#fetchUserById#anon@2=>${rel(canon.file)}#loadUser`,
			kind: "duplicate",
			confidence: 0.8,
			left: { path: rel(app.file), name: "fetchUserById#anon@2", line: 2 },
			right: { path: rel(canon.file), name: "loadUser", line: 1 },
		};
		const data = collectOverviewData({
			comp: { findings: [finding], appUtils: [appCand], canonUtils: [canonCand] },
			repoRoot,
			config: {},
		});
		const pair = data.pairs[0];
		expect(pair).toBeTruthy();
		const propLane = pair.connections.find((c: any) => c.connectionId === "same:prop:id");
		// The value-property lane connects the two RETURN rows (body), never the head.
		expect(propLane).toBeTruthy();
		const headLine = 1; // canon loadUser head is line 1
		for (const end of propLane.ends) {
			expect(end.items.map(Number)).not.toContain(headLine);
		}
		// Type members live in their own lane, not in the value-property lane.
		const typeLane = pair.connections.find((c: any) => c.connectionId === "same:type-prop:id");
		expect(typeLane).toBeTruthy();
	});
});
