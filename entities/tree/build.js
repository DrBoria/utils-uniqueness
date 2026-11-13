"use strict";

// ── THE PLAIN TREE ─────────────────────────────────────────────────────────
//
// One framework-agnostic node per piece of the body: `{ kind, label, children }`
// plus WHERE it is written (`start`, `end`, `column`) and the exact span of the
// token that stands for it (`labelSite`).
//
// The builder is a LOOP over the shapes table — no per-syntax branching here. A
// form the table does not name becomes `expr` with the parser's own kind name,
// so an unknown construct is reported as itself instead of silently dropped.

const { unwrap, siteOf, labelSiteOf } = require("./node");
const { SHAPES } = require("./shapes");
const { TREE_KIND: K } = require("../../constants");

const UNKNOWN = (node) => ({ kind: K.Expr, label: node.getKindName() || K.Expr, children: [] });

const inner = (node) => {
	const plain = unwrap(node);
	if (!plain) return null;

	const shape = SHAPES.get(plain.getKind());
	if (!shape) return UNKNOWN(plain);
	if (shape.skip) return null;
	// An expression statement IS its expression.
	if (shape.passthrough) return inner(plain.getExpression());

	return { kind: shape.kind, label: shape.label(plain), children: shape.children(plain, toPlainTree) };
};

// The node WITH its position. The line answers "which node is under this line?";
// the column and `labelSite` answer "WHERE in the line", so the report paints a
// construct at the place the parser saw it instead of searching for the word.
const toPlainTree = (node) => {
	const out = inner(node);
	if (!out) return null;

	const plain = unwrap(node);
	if (plain && typeof plain.getStartLineNumber === "function") {
		const { line, column } = siteOf(plain);
		out.start = line;
		out.end = plain.getEndLineNumber();
		out.column = column;
		out.labelSite = labelSiteOf(plain);
	}

	return out;
};

module.exports = { toPlainTree };
