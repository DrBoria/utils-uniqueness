"use strict";

// ── AST MATCHER · the CLI/markdown text ─────────────────────────────────────
//
// ONE LINE PER BLOCK: what the piece is (`if`, `call:log`, `var:const`), the rows it
// covers on each side, how many nodes it matched, and what that is worth. Nothing
// about leaves: an `Identifier` is part of the block it belongs to, not a row of its
// own — the same rule the board follows, from the same model.

import { PHRASES } from "./phrases";
import { fill } from "../../errorTypes/vocabulary/phrases";

// [kind, label, block, kids, start, …] — the rows a block covers on one side.
const linesOf = (node, block, out = []) => {
	if (!Array.isArray(node)) return out;
	const [, , index, kids, start] = node;
	if (index === block && typeof start === "number" && start > 0) out.push(start);
	for (const child of kids) linesOf(child, block, out);

	return out;
};

const span = (values) => {
	const unique = [...new Set(values)].sort((a: any, b: any) => a - b);
	if (unique.length === 0) return "—";

	return unique.length === 1 ? String(unique[0]) : `${unique[0]}–${unique[unique.length - 1]}`;
};

const text = (model) => {
	if (!model) return [];
	const blocks = model.blocks ?? [];
	const unmatched = model.unmatched ?? [];
	if (blocks.length === 0 && unmatched.length === 0) return [PHRASES.empty];

	const rows = blocks.map((block) =>
		fill(PHRASES.block, {
			form: block.form,
			left: span(linesOf(model.left, block.index)),
			right: span(linesOf(model.right, block.index)),
			percent: block.percent === null ? "" : ` · ${block.percent}%`,
		}),
	);
	// THE PIECES THAT DID NOT CORRESPOND: they are in no percentage, but their rows
	// are on the board, so the CLI says them too (no number) — same rule as the board.
	const unmatchedRows = unmatched.map((block) =>
		fill(PHRASES.block, {
			form: block.form,
			left: span(linesOf(model.left, block.index)),
			right: span(linesOf(model.right, block.index)),
			percent: "",
		}),
	);

	return [[...rows, ...unmatchedRows].join("  ")];
};

export {  text  };
