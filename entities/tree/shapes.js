"use strict";

// ── WHAT A NODE IS, AND WHAT HANGS UNDER IT — AS DATA ──────────────────────
//
// One row per syntactic form: the normalized `kind` the matchers speak, how the
// label is read, and how the children are collected. The builder (`build.js`) is
// a loop over this table; there is no `if` chain to extend, and a form that is
// not listed falls back to the parser's own kind name.
//
// The rows are DATA, not logic: label readers and child collectors are the small
// named answers in `node.js`, reused by every row that needs them.

const { TREE_KIND: K } = require("../../constants");
const { SK, calleeName, assignTarget, jsxTagName, templatePart, receiverOf, opOf } = require("./node");

const kids = (list, map) => (list || []).map((child) => map(child)).filter(Boolean);

// The forms whose label IS their kind (`if`, `return`, `object`…).
const named = (kind, children) => ({ kind, label: () => kind, children });

const SHAPES = new Map([
	// ── CALLS ────────────────────────────────────────────────────────────
	[SK.CallExpression, {
		kind: K.Call,
		label: (node) => calleeName(node),
		children: (node, map) => {
			const receiver = receiverOf(node);
			return [...(receiver ? [map(receiver)] : []), ...kids(node.getArguments(), map)];
		},
	}],
	[SK.NewExpression, { kind: K.New, label: (node) => calleeName({ getExpression: () => node.getExpression() }), children: (node, map) => kids(node.getArguments(), map) }],
	[SK.TaggedTemplateExpression, { kind: K.Call, label: (node) => calleeName({ getExpression: () => node.getTag() }), children: () => [{ kind: K.Template, label: K.Template, children: [] }] }],

	// ── NAMES AND ACCESS ─────────────────────────────────────────────────
	[SK.Identifier, { kind: K.Ident, label: (node) => node.getText(), children: () => [] }],
	[SK.PropertyAccessExpression, { kind: K.Member, label: (node) => node.getName(), children: (node, map) => kids([node.getExpression()], map) }],
	[SK.ElementAccessExpression, { kind: K.Index, label: () => K.Index, children: (node, map) => kids([node.getExpression(), node.getArgumentExpression()], map) }],

	// ── JSX ──────────────────────────────────────────────────────────────
	[SK.JsxElement, {
		kind: K.Jsx,
		label: (node) => jsxTagName(node.getOpeningElement().getTagNameNode()),
		children: (node, map) => kids([...node.getOpeningElement().getAttributes(), ...node.getJsxChildren()], map),
	}],
	[SK.JsxSelfClosingElement, { kind: K.Jsx, label: (node) => jsxTagName(node.getTagNameNode()), children: (node, map) => kids(node.getAttributes(), map) }],
	[SK.JsxAttribute, { kind: K.JsxAttr, label: (node) => (node.getNameNode() ? node.getNameNode().getText() : "?"), children: (node, map) => kids([node.getInitializer()], map) }],
	[SK.JsxSpreadAttribute, named(K.JsxSpread, (node, map) => kids([node.getExpression()], map))],
	[SK.JsxExpression, named(K.JsxExpr, (node, map) => kids([node.getExpression()], map))],
	[SK.JsxText, { kind: K.Lit, label: (node) => node.getText().replace(/\s+/g, " ").trim(), children: () => [] }],

	// ── OPERATORS ────────────────────────────────────────────────────────
	[SK.BinaryExpression, { kind: K.Bin, label: (node) => opOf(node.getOperatorToken()), children: (node, map) => kids([node.getLeft(), node.getRight()], map) }],
	[SK.PrefixUnaryExpression, { kind: K.Unary, label: (node) => opOf(node.getOperatorToken()), children: (node, map) => kids([node.getOperand()], map) }],
	[SK.PostfixUnaryExpression, { kind: K.UnaryPost, label: (node) => opOf(node.getOperatorToken()), children: (node, map) => kids([node.getOperand()], map) }],
	[SK.ConditionalExpression, named(K.Cond, (node, map) => kids([node.getCondition(), node.getWhenTrue(), node.getWhenFalse()], map))],
	[SK.CommaExpression, named(K.Seq, (node, map) => kids(node.getOperands(), map))],
	[SK.SpreadElement, named(K.Spread, (node, map) => kids([node.getExpression()], map))],

	// ── LITERALS AND CONTAINERS ──────────────────────────────────────────
	[SK.ObjectLiteralExpression, named(K.Object, (node, map) => kids(node.getProperties(), map))],
	[SK.PropertyAssignment, { kind: K.Prop, label: (node) => node.getName() || "?", children: (node, map) => kids([node.getInitializer()], map) }],
	[SK.ShorthandPropertyAssignment, { kind: K.Prop, label: (node) => node.getName() || "?", children: (node, map) => kids([node.getInitializer()], map) }],
	[SK.ArrayLiteralExpression, named(K.Array, (node, map) => kids(node.getElements(), map))],
	[SK.NumericLiteral, { kind: K.Lit, label: (node) => node.getText(), children: () => [] }],
	[SK.StringLiteral, { kind: K.Lit, label: (node) => node.getText(), children: () => [] }],
	[SK.TrueKeyword, named(K.Lit, () => [])],
	[SK.FalseKeyword, named(K.Lit, () => [])],
	[SK.NullKeyword, named(K.Lit, () => [])],
	[SK.ThisKeyword, named(K.Lit, () => [])],

	// ── TEMPLATES ────────────────────────────────────────────────────────
	[SK.TemplateExpression, {
		kind: K.Template,
		label: () => K.Template,
		children: (node, map) => [templatePart(node.getHead()), ...node.getTemplateSpans().flatMap((span) => [map(span.getExpression()), templatePart(span.getLiteral())])].filter(Boolean),
	}],
	[SK.NoSubstitutionTemplateLiteral, { kind: K.Template, label: () => K.Template, children: (node) => [templatePart(node)].filter(Boolean) }],

	// ── FUNCTIONS ────────────────────────────────────────────────────────
	[SK.ArrowFunction, { kind: K.Func, label: () => "<fn>", children: (node, map) => kids([node.getBody()], map) }],
	[SK.FunctionExpression, { kind: K.Func, label: () => "<fn>", children: (node, map) => kids([node.getBody()], map) }],

	// ── STATEMENTS ───────────────────────────────────────────────────────
	[SK.IfStatement, named(K.If, (node, map) => kids([node.getExpression(), node.getThenStatement(), node.getElseStatement()], map))],
	[SK.ForStatement, named(K.For, (node, map) => kids([node.getInitializer(), node.getCondition(), node.getIncrementor(), node.getStatement()], map))],
	[SK.ForOfStatement, named(K.ForOf, (node, map) => kids([node.getInitializer(), node.getExpression(), node.getStatement()], map))],
	[SK.ForInStatement, named(K.ForOf, (node, map) => kids([node.getInitializer(), node.getExpression(), node.getStatement()], map))],
	[SK.WhileStatement, named(K.While, (node, map) => kids([node.getExpression(), node.getStatement()], map))],
	[SK.DoStatement, named(K.DoWhile, (node, map) => kids([node.getStatement(), node.getExpression()], map))],
	[SK.SwitchStatement, named(K.Switch, (node, map) => kids([node.getExpression(), ...(node.getCaseBlock() ? node.getCaseBlock().getClauses() : [])], map))],
	[SK.CaseClause, named(K.Case, (node, map) => kids(node.getStatements(), map))],
	[SK.DefaultClause, named(K.Case, (node, map) => kids(node.getStatements(), map))],
	[SK.ReturnStatement, named(K.Return, (node, map) => kids([node.getExpression()], map))],
	[SK.ThrowStatement, named(K.Throw, (node, map) => kids([node.getExpression()], map))],
	[SK.TryStatement, named(K.Try, (node, map) => kids([node.getTryBlock(), node.getCatchClause(), node.getFinallyBlock()], map))],
	[SK.CatchClause, named(K.Catch, (node, map) => kids([node.getBlock()], map))],
	[SK.VariableStatement, named(K.Var, (node, map) => kids(node.getDeclarationList().getDeclarations(), map))],
	[SK.VariableDeclaration, { kind: K.VarDecl, label: (node) => node.getName() || "?", children: (node, map) => kids([node.getInitializer()], map) }],
	[SK.AssignmentExpression, { kind: K.Assign, label: (node) => assignTarget(node.getLeft()), children: (node, map) => kids([node.getRight()], map) }],
	[SK.Block, named(K.Block, (node, map) => kids(node.getStatements(), map))],

	// ── EXPRESSIONS ──────────────────────────────────────────────────────
	[SK.AwaitExpression, named(K.Await, (node, map) => kids([node.getExpression()], map))],
	[SK.YieldExpression, named(K.Yield, (node, map) => kids([node.getExpression()], map))],
	// An expression statement IS its expression: the `;` is punctuation.
	[SK.ExpressionStatement, { passthrough: true }],
	[SK.Noop, { skip: true }],
]);

// `nameOfNode` is part of the surface the builder reads for a DECLARATION even
// when the row above does not use it; exporting it here keeps one source.
module.exports = { SHAPES };
