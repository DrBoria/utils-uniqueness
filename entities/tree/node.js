"use strict";

// ── ONE NODE, AND THE ANSWERS THE PARSER ALREADY KNOWS ─────────────────────
//
// Everything here is a question about a single ts-morph node: where it starts,
// what it is called, which node writes its name, which token it is written with.
// Nothing here decides what a node MEANS for a matcher — that is the shapes
// table (`shapes.js`). One implementation per question, so `if`/`call`/`prop`
// never compute a position or a name in two slightly different ways.

const { ts } = require("ts-morph");
const { TREE_KIND: K } = require("../../constants");

const SK = ts.SyntaxKind;

// Parentheses, casts and non-null assertions are SPELLING, not structure:
// `() => ({...})` is an object literal with an opinion about how it is written.
const UNWRAPPED = new Set([SK.ParenthesizedExpression, SK.AsExpression, SK.TypeAssertionExpression, SK.NonNullExpression, SK.SatisfiesExpression]);

const unwrap = (node) => {
	let current = node;
	while (current && UNWRAPPED.has(current.getKind())) current = current.getExpression();

	return current;
};

// 1-based column of a character position. ts-morph exposes line numbers but not
// columns, so this is the one place that turns a character offset into a column.
const columnAt = (sourceFile, pos) => {
	const text = sourceFile.getFullText();
	let index = pos - 1;
	while (index >= 0 && text[index] !== "\n") index -= 1;

	return pos - index;
};

// WHERE a node is written: line and 1-based column.
const siteOf = (node) => {
	if (!node || typeof node.getStartLineNumber !== "function") return { line: null, column: null };

	return { line: node.getStartLineNumber(), column: columnAt(node.getSourceFile(), node.getStart()) };
};

// The NAME a node keeps as its label: a declaration's own name, an object key, a
// member's property. `null` when the node is not named — its caller decides.
const nameOfNode = (node) => {
	if (typeof node.getName === "function") return node.getName() || null;
	const nameNode = typeof node.getNameNode === "function" ? node.getNameNode() : null;

	return nameNode ? nameNode.getText() : null;
};

// The expression a call is made on: `s.split(…)` → `s`.
const receiverOf = (call) => {
	const expr = unwrap(call.getExpression ? call.getExpression() : null);
	if (expr && (expr.getKind() === SK.PropertyAccessExpression || expr.getKind() === SK.ElementAccessExpression)) return expr.getExpression();

	return null;
};

// The node that writes the NAME a call keeps as its label (`bridge.run` → `run`),
// so the painted word is the one the matcher compared.
const calleeNameNode = (node) => {
	const expr = unwrap(node.getExpression ? node.getExpression() : node.getTag ? node.getTag() : node);
	if (!expr) return null;
	if (expr.getKind() === SK.Identifier) return expr;
	if (expr.getKind() === SK.PropertyAccessExpression) return expr.getNameNode();
	if (expr.getKind() === SK.ElementAccessExpression) return expr.getExpression() ? calleeNameNode({ getExpression: () => expr.getExpression() }) : null;

	return null;
};

const targetNameNode = (node) => {
	const left = unwrap(node.getLeft ? node.getLeft() : null);
	if (!left) return null;
	if (left.getKind() === SK.Identifier) return left;
	if (left.getKind() === SK.PropertyAccessExpression) return left.getNameNode();

	return null;
};

// The callee as a NAME (`bridge.run` → `run`, `run` → `run`).
const calleeName = (call) => {
	const expr = unwrap(call.getExpression ? call.getExpression() : call.getTag ? call.getTag() : call);
	if (!expr) return "?";
	if (expr.getKind() === SK.Identifier) return expr.getText();
	if (expr.getKind() === SK.PropertyAccessExpression) return expr.getName();
	if (expr.getKind() === SK.ElementAccessExpression) return expr.getExpression() ? calleeName({ getExpression: () => expr.getExpression() }) : "?";

	return "?";
};

// A JSX tag as a dotted string ("Panel.Section"), so the tag — part of what a
// component renders — survives into the tree like a call target.
const jsxTagName = (tag) => {
	if (!tag) return "?";
	if (tag.getKind() === SK.Identifier) return tag.getText();
	if (tag.getKind() === SK.PropertyAccessExpression) return `${jsxTagName(tag.getExpression())}.${tag.getName()}`;
	if (tag.getKind() === SK.ElementAccessExpression) return `${jsxTagName(tag.getExpression())}[]`;

	return "?";
};

// The write target as a NAME (`a.b = …` → `b`, `a[0] = …` → `index`).
const assignTarget = (left) => {
	const target = unwrap(left);
	if (!target) return "?";
	if (target.getKind() === SK.Identifier) return target.getText();
	if (target.getKind() === SK.PropertyAccessExpression) return target.getName();
	if (target.getKind() === SK.ElementAccessExpression) return K.Index;

	return "?";
};

// A template's static text, as a `lit` node (the text is logic, not formatting).
const templatePart = (literal) => (literal && typeof literal.getLiteralText === "function" ? { kind: K.Lit, label: literal.getLiteralText(), children: [] } : null);

const opOf = (token) => {
	if (!token) return "?";
	if (typeof token === "string") return token;
	if (token.isKind) return ts.SyntaxKind[token.getKind()] || String(token);

	return String(token);
};

// The ONE token a construct is WRITTEN with: the name a call/new/assignment is
// labelled with, otherwise the node's FIRST CHILD — which for a statement is the
// keyword it starts with (`if`, `return`, `const`, `default`, `try`…). No
// kind→keyword table and no per-kind special case: the parser's own children
// answer it, so every construct that exists is paintable.
const labelTokenNode = (node) => {
	const kind = node.getKind();
	if (kind === SK.CallExpression || kind === SK.NewExpression || kind === SK.TaggedTemplateExpression) return calleeNameNode(node);
	if (kind === SK.AssignmentExpression) return targetNameNode(node);

	const first = node.getChildren ? node.getChildren()[0] : null;

	return first && first.getKind() !== SK.SyntaxList ? first : null;
};

// The SPAN of that token: where the construct is painted.
const labelSiteOf = (node) => {
	const token = labelTokenNode(node);
	if (!token) return null;
	const { line, column } = siteOf(token);

	return { line, column, length: token.getText().length };
};

module.exports = {
	SK,
	unwrap,
	columnAt,
	siteOf,
	nameOfNode,
	receiverOf,
	calleeName,
	calleeNameNode,
	targetNameNode,
	jsxTagName,
	assignTarget,
	templatePart,
	opOf,
	labelTokenNode,
	labelSiteOf,
};
