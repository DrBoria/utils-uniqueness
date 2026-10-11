"use strict";

// ---------------------------------------------------------------------------
// The complete vocabulary of node kinds emitted by the plain-tree builder
// (playgrounds/typescript.js → toPlainTree). This is the SINGLE source of
// truth for the kind language: every kind a tree can contain is listed here
// exactly once, grouped by the role it plays.
//
// This file holds ONLY the vocabulary. Each consumer that needs a selection
// of kinds (hasStructure, flowSequence, trash scoring, pure-predicate
// detection) owns its own Set next to the code that uses it.
// ---------------------------------------------------------------------------

// Expressions — value-producing nodes.
const EXPRESSION_KINDS = [
	"ident",
	"member",
	"index",
	"lit",
	"bin",
	"unary",
	"unary-post",
	"cond",
	"seq",
	"spread",
	"object",
	"prop",
	"array",
	"template",
	"call",
	"new",
	"await",
	"yield",
	"func",
];

// JSX — the shape of a render.
const JSX_KINDS = ["jsx", "jsx-attr", "jsx-spread", "jsx-expr"];

// Statements — control flow, declarations, and the catch-all for anything
// else the builder does not model explicitly.
const STATEMENT_KINDS = [
	"if",
	"for",
	"for-of",
	"while",
	"do-while",
	"switch",
	"case",
	"return",
	"throw",
	"try",
	"catch",
	"var",
	"var-decl",
	"assign",
	"block",
	"expr",
];

// The complete vocabulary: every kind the tree builder can emit, exactly once.
const KINDS = new Set([...EXPRESSION_KINDS, ...JSX_KINDS, ...STATEMENT_KINDS]);

module.exports = { KINDS, EXPRESSION_KINDS, JSX_KINDS, STATEMENT_KINDS };
