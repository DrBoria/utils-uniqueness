import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { alignWeighed, alignForms } = require("../dist/matcher/ast-align.js");
const { matchBlocks } = require("../dist/matcher/ast-blocks.js");

// CONTENT BEFORE ORDER: a reordered body must pair each piece with its real
// duplicate, not the first same-form candidate in order. The u16 case:
// `initials` (L12) duplicated at R10, `displayName` (L13) at R9 — the ordered
// LCS paired L12↔R9 and called the real duplicate "unique".

// A minimal node: kind, label, children, start line. `var` declarations carry
// their declarator name as a child `ident` so similarity can tell them apart.
const ident = (name: string, line: number) => ({ kind: "ident", label: name, children: [], start: line });
const decl = (name: string, line: number, extra: unknown[] = []) => ({
	kind: "var",
	keyword: "const",
	label: "var",
	start: line,
	children: [{ kind: "var-decl", label: "v", start: line, children: [ident(name, line), ...extra] }],
});
const call = (name: string, line: number) => ({ kind: "call", label: name, start: line, children: [ident(name, line)] });

describe("alignWeighed — content wins over order", () => {
	it("pairs reordered declarations with their real duplicates", () => {
		// left: initials(12), displayName(13); right: displayName(9), initials(10)
		const left = [decl("initials", 12, [call("toUpperCase", 12)]), decl("displayName", 13, [call("trim", 13)])];
		const right = [decl("displayName", 9, [call("trim", 9)]), decl("initials", 10, [call("toUpperCase", 10)])];
		const pairs = alignWeighed(left, right);
		expect(pairs).toContainEqual([0, 1]); // initials ↔ initials
		expect(pairs).toContainEqual([1, 0]); // displayName ↔ displayName
	});

	it("keeps the ordered pairing for an in-order body", () => {
		const left = [decl("a", 1), decl("b", 2), decl("c", 3)];
		const right = [decl("a", 1), decl("b", 2), decl("c", 3)];
		expect(alignWeighed(left, right)).toEqual([[0, 0], [1, 1], [2, 2]]);
	});

	it("does not pair same-form pieces with different content below the floor", () => {
		const left = [decl("alpha", 1, [call("one", 1), call("two", 1), call("three", 1)])];
		const right = [decl("beta", 1, [call("x", 1)])];
		// similarity of the two subtrees is far below 0.5 → no content pair;
		// the ordered leftover pass may still pair the roots (same form), which
		// is the old behaviour for a genuinely partial copy.
		const pairs = alignWeighed(left, right);
		expect(pairs.length).toBeLessThanOrEqual(1);
	});

	it("an extra statement on one side shifts nothing below it", () => {
		const left = [decl("a", 1), decl("b", 2), decl("c", 3)];
		const right = [decl("extra", 1), decl("a", 2), decl("b", 3), decl("c", 4)];
		const pairs = alignWeighed(left, right);
		expect(pairs).toContainEqual([0, 1]);
		expect(pairs).toContainEqual([1, 2]);
		expect(pairs).toContainEqual([2, 3]);
	});
});

describe("alignForms — the plain ordered pass", () => {
	it("aligns same forms in order", () => {
		const left = [decl("a", 1), decl("b", 2)];
		const right = [decl("a", 1), decl("b", 2)];
		expect(alignForms(left, right)).toEqual([[0, 0], [1, 1]]);
	});
});

describe("matchBlocks — the u16 regression", () => {
	it("a reordered declaration is a FULL duplicate of its real twin, not 12%", () => {
		const leftBody = { kind: "block", label: "block", start: 10, children: [decl("isAdult", 11), decl("initials", 12, [call("toUpperCase", 12)]), decl("displayName", 13, [call("trim", 13)])] };
		const rightBody = { kind: "block", label: "block", start: 8, children: [decl("displayName", 9, [call("trim", 9)]), decl("initials", 10, [call("toUpperCase", 10)]), decl("isAdult", 11)] };
		const m = matchBlocks(leftBody, rightBody);
		const byLine = new Map(m.blocks.map((b: { left: { start: number }; right: { start: number } }) => [b.left.start, b.right.start]));
		expect(byLine.get(12)).toBe(10); // initials ↔ initials
		expect(byLine.get(13)).toBe(9); // displayName ↔ displayName
		expect(byLine.get(11)).toBe(11); // isAdult ↔ isAdult
		for (const b of m.blocks) {
			if (b.form === "var:const") expect(b.share).toBe(1);
		}
	});
});
