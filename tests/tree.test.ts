import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const require = createRequire(import.meta.url);
const { whenReady, parseFunctions } = require("../playgrounds/typescript.js");
const { buildAst, multisetJaccard, sequenceSimilarity } = require("../normalize/ast.js");

const countNodes = (n: any): number => (n ? 1 + (n.children || []).reduce((s: number, c: any) => s + countNodes(c), 0) : 0);

// Write a temp TS file and parse a named function's body tree.
const parseBody = async (fnName: string, source: string) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tree-test-"));
	const file = path.join(dir, "sample.ts");
	fs.writeFileSync(file, source, "utf8");
	const parsed = parseFunctions(file, { requireExported: false });
	const d = parsed.find((p) => p.name === fnName);
	if (!d) throw new Error(`function ${fnName} not found`);
	return d.bodyTree;
};

describe("toPlainTree — call receiver chain is preserved", () => {
	it("a chained method call is deeper than a bare 2-node tree", async () => {
		await whenReady({});
		const tree = await parseBody(
			"f",
			`export const f = (s: string): string => s.split("-").map((w) => w).join(" ");`,
		);

		// The receiver chain (s.split(...).map(...)) must be captured, so the
		// tree is far more than call -> lit.
		const count = (n: any): number => (n ? 1 + (n.children || []).reduce((s: number, c: any) => s + count(c), 0) : 0);
		expect(count(tree)).toBeGreaterThan(4);
	});

	it("two functions with the same terminal call but different receivers differ", async () => {
		await whenReady({});
		// Both end in .join("...") with one literal argument, but one joins a
		// 3-element array and the other chains split/map. Before the fix these
		// collapsed to the identical call->lit tree and scored AST 1.00.
		const a = await parseBody("a", `export const a = (x: string): string => [x, "b", "c"].join("&");`);
		const b = await parseBody("b", `export const b = (s: string): string => s.split("-").map((w) => w).join(" ");`);

		const seqSim = sequenceSimilarity(buildAst({ bodyTree: a }).sequence, buildAst({ bodyTree: b }).sequence);
		const { score } = multisetJaccard(buildAst({ bodyTree: a }).subtreeHashes, buildAst({ bodyTree: b }).subtreeHashes);

		expect(seqSim).toBeLessThan(1);
		expect(score).toBeLessThan(1);
	});
});

describe("toPlainTree — literal VALUES are part of the body fingerprint", () => {
	// Ground truth from the real run's false-positive clusters: one-liners that
	// differ ONLY in a string/number constant were collapsed to identical trees
	// (`row.status === "active"` vs `row.status === "entered-in-error"` both
	// became bin==[member,v,lit] and scored AST 1.00, conf 1.00). A constant is
	// logic, not a renameable name — so its value must survive into the tree.
	// Renamed IDENTIFIERS (RXNORM_SYSTEM vs SNOMED_SYSTEM), by contrast, are the
	// legitimate "same logic, different name" twins and must stay identical.
	it("two guards differing only in a string constant are NOT identical", async () => {
		await whenReady({});
		const a = await parseBody("a", `export const a = (r: { status: string }): boolean => r.status === "active";`);
		const b = await parseBody("b", `export const b = (r: { status: string }): boolean => r.status === "entered-in-error";`);

		const { score } = multisetJaccard(buildAst({ bodyTree: a }).subtreeHashes, buildAst({ bodyTree: b }).subtreeHashes);
		expect(score).toBeLessThan(1);
	});

	it("two guards differing only in a number constant are NOT identical", async () => {
		await whenReady({});
		const a = await parseBody("a", `export const a = (code: number): boolean => code === 404;`);
		const b = await parseBody("b", `export const b = (code: number): boolean => code === 412;`);

		const { score } = multisetJaccard(buildAst({ bodyTree: a }).subtreeHashes, buildAst({ bodyTree: b }).subtreeHashes);
		expect(score).toBeLessThan(1);
	});

	it("two identical one-liners (same constant) remain identical", async () => {
		await whenReady({});
		const a = await parseBody("a", `export const a = (r: { status: string }): boolean => r.status === "active";`);
		const b = await parseBody("b", `export const b = (r: { status: string }): boolean => r.status === "active";`);

		const { score } = multisetJaccard(buildAst({ bodyTree: a }).subtreeHashes, buildAst({ bodyTree: b }).subtreeHashes);
		expect(score).toBe(1);
	});

	it("two one-liners differing only in a renamed IDENTIFIER (not a literal) remain identical", async () => {
		await whenReady({});
		// RXNORM_SYSTEM vs SNOMED_SYSTEM are identifiers -> positionally renamed
		// to `v` -> equal. This is the legitimate "same logic, different name"
		// twin (real-run cluster 13: atc/rx/sct coding builders).
		const a = await parseBody("a", `export const a = (code: string, display: string) => ({ system: RXNORM_SYSTEM, code, display });`);
		const b = await parseBody("b", `export const b = (code: string, display: string) => ({ system: SNOMED_SYSTEM, code, display });`);

		const { score } = multisetJaccard(buildAst({ bodyTree: a }).subtreeHashes, buildAst({ bodyTree: b }).subtreeHashes);
		expect(score).toBe(1);
	});

	it("template literals keep their static text (real-run 'Url' cluster: notesUrl vs migrationStub)", async () => {
		await whenReady({});
		// Both are `return \`...\${...}\`` one-liners. Before the fix the static
		// text was dropped, so EVERY template one-liner collapsed to
		// template[ident] -> AST 1.00 -> a false 9-function "Url" cluster.
		const a = await parseBody("a", `export const a = (patientId: string) => \`/patients/\${patientId}?module=notes\`;`);
		const b = await parseBody("b", `export const b = (encounterId: string) => \`vitals-encounter-\${encounterId}\`;`);

		const { score } = multisetJaccard(buildAst({ bodyTree: a }).subtreeHashes, buildAst({ bodyTree: b }).subtreeHashes);
		expect(score).toBeLessThan(1);
	});

	it("a multi-line template (file stub) differs from a short URL template", async () => {
		await whenReady({});
		const a = await parseBody("a", `export const a = (patientId: string) => \`/patients/\${patientId}?module=notes\`;`);
		const b = await parseBody("b", `export const b = (name: string, patientId: string) => \`// core/ehr/_db/migrations/\${name}.ts
export const migration = { name, up: async () => { }, down: async () => { } };
\`;`);

		// Both are template[ident] in SHAPE, but the stub's static text
		// (the whole file body) must now be a lit child, so the trees are no
		// longer byte-identical fingerprints. Before the fix: AST 1.00.
		const { score } = multisetJaccard(buildAst({ bodyTree: a }).subtreeHashes, buildAst({ bodyTree: b }).subtreeHashes);
		expect(score).toBeLessThan(1);
	});

	it("identical templates remain identical", async () => {
		await whenReady({});
		const a = await parseBody("a", `export const a = (patientId: string) => \`/patients/\${patientId}?module=notes\`;`);
		const b = await parseBody("b", `export const b = (patientId: string) => \`/patients/\${patientId}?module=notes\`;`);

		const { score } = multisetJaccard(buildAst({ bodyTree: a }).subtreeHashes, buildAst({ bodyTree: b }).subtreeHashes);
		expect(score).toBe(1);
	});
});

describe("toPlainTree — switch case bodies are part of the body fingerprint", () => {
	// Ground truth from the real run's false-positive clusters: the parser read
	// `node.cases`, which does not exist on a TS SwitchStatement (the clauses
	// live under `node.caseBlock.clauses`), so EVERY switch collapsed to
	// `switch[ident]`. Three genuinely different normalizers — toAnswerType
	// (boolean/decimal/integer/date), noteStatusFromFhir (final/amended/
	// entered-in-error), normalizeEnrollmentStatus (ACTIVE/ENROLLED/...) —
	// all scored AST 1.00 and clustered together as "mutual copies".
	it("two switches with different cases are NOT identical", async () => {
		await whenReady({});
		const a = await parseBody(
			"a",
			`export const a = (type: string | undefined): string => {
  switch (type) {
    case "boolean":
    case "decimal":
      return type;
    default:
      return "string";
  }
};`,
		);
		const b = await parseBody(
			"b",
			`export const b = (status: string | null | undefined): string => {
  switch (status) {
    case "final":
      return "signed";
    case "amended":
      return "amended";
    default:
      return "draft";
  }
};`,
		);

		const { score } = multisetJaccard(buildAst({ bodyTree: a }).subtreeHashes, buildAst({ bodyTree: b }).subtreeHashes);
		expect(score).toBeLessThan(1);
	});

	it("identical switches remain identical", async () => {
		await whenReady({});
		const a = await parseBody(
			"a",
			`export const a = (type: string | undefined): string => {
  switch (type) {
    case "boolean":
      return type;
    default:
      return "string";
  }
};`,
		);
		const b = await parseBody(
			"b",
			`export const b = (type: string | undefined): string => {
  switch (type) {
    case "boolean":
      return type;
    default:
      return "string";
  }
};`,
		);

		const { score } = multisetJaccard(buildAst({ bodyTree: a }).subtreeHashes, buildAst({ bodyTree: b }).subtreeHashes);
		expect(score).toBe(1);
	});

	it("a switch's case bodies are present in the tree", async () => {
		await whenReady({});
		const tree = await parseBody(
			"f",
			`export const f = (x: string): string => {
  switch (x) {
    case "a":
      return "1";
    default:
      return "2";
  }
};`,
		);
		// Before the fix the whole body was just block->switch->ident (3 nodes).
		expect(countNodes(tree)).toBeGreaterThan(8);
	});
});

describe("toPlainTree — .tsx files parse as JSX, not garbage", () => {
	// Ground truth: .tsx files were parsed with ScriptKind.TS, so JSX fell into
	// error recovery and a component body like ProfileSection became the
	// nonsense tree bin:FirstAssignment[ident:as, lit:section]. Any two such
	// components then scored AST 1.00 against each other.
	it("a .tsx arrow with a JSX body produces a real tree, not error-recovery garbage", async () => {
		await whenReady({});
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tree-test-"));
		const file = path.join(dir, "sample.tsx");
		fs.writeFileSync(
			file,
			`export const sectionBody = ({ id, title, children }: { id: string; title: string; children: unknown }) => (
  <Panel.Section as="section" id={id} className="gap-4">
    <Panel.Section.Title>{title}</Panel.Section.Title>
    {children}
  </Panel.Section>
);`,
			"utf8",
		);
		const parsed = parseFunctions(file, { requireExported: false });
		const d = parsed.find((p) => p.name === "sectionBody");
		if (!d) throw new Error("sectionBody not found");
		const tree = d.bodyTree;
		// The tag names must survive into the tree.
		const labels = new Set<string>();
		const walk = (n: any) => {
			if (!n) return;
			labels.add(n.label || "");
			for (const c of n.children || []) walk(c);
		};
		walk(tree);
		expect(labels.has("Panel.Section")).toBe(true);
		expect(labels.has("Panel.Section.Title")).toBe(true);
	});

	it("two different JSX components are NOT identical trees", async () => {
		await whenReady({});
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tree-test-"));
		const file = path.join(dir, "sample.tsx");
		fs.writeFileSync(
			file,
			`export const panelA = ({ rows }: { rows: unknown[] }) => (
  <Panel.Section as="section">
    <ItemList items={rows} />
  </Panel.Section>
);
export const panelB = ({ title }: { title: string }) => (
  <Panel.Section as="section">
    <Panel.Section.Title as="h2">{title}</Panel.Section.Title>
  </Panel.Section>
);`,
			"utf8",
		);
		const parsed = parseFunctions(file, { requireExported: false });
		const a = parsed.find((p) => p.name === "panelA");
		const b = parsed.find((p) => p.name === "panelB");
		if (!a || !b) throw new Error("panelA/panelB not found");

		const { score } = multisetJaccard(buildAst({ bodyTree: a.bodyTree }).subtreeHashes, buildAst({ bodyTree: b.bodyTree }).subtreeHashes);
		expect(score).toBeLessThan(1);
	});
});
