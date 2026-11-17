"use strict";

import * as path from "node:path";
import { Project, ts } from "ts-morph";
import { columnAt, siteOf } from "../normalize/node-position";

// ---------------------------------------------------------------------------
// Function discovery — EVERY function: top-level, nested, callbacks, and
// anonymous arrows. There is no exported-only contract: all functions are
// comparable utilities.
// ---------------------------------------------------------------------------

// One shared Project across the whole scan. ts-morph caches parsed files, so
// re-adding the same path returns the same SourceFile (no re-parse).
//
// The project is built from the repo's OWN tsconfig, because parameter and
// return types come from the type checker: `paths`, `baseUrl` and module
// resolution live there, and a program that does not know them reads an aliased
// import as `any`. Two functions that take the same type then stop looking
// alike, and a real duplicate is never reported. The config is discovered from
// the parsed file (the nearest `tsconfig.json`), or set explicitly with
// `setTsConfig` when the project keeps it somewhere else.
let project = null;
let projectConfig = null;
let explicitConfig = null;
let fileCache = new Map();

const setTsConfig = (configPath) => {
	const next = configPath ? path.resolve(configPath) : null;
	if (next === explicitConfig) return;
	explicitConfig = next;
	project = null;
	fileCache = new Map();
};

const configFor = (fileAbs) => {
	// The file's OWN tree first: a monorepo has a tsconfig per package, and the
	// nearest one is the one that describes this file. The explicit path is the
	// fallback for a project whose config does not sit above its sources.
	return ts.findConfigFile(path.dirname(fileAbs), ts.sys.fileExists) || explicitConfig;
};

const projectFor = (fileAbs) => {
	const config = configFor(fileAbs);
	if (project && config === projectConfig) return project;
	projectConfig = config;
	project = config
		? new Project({ tsConfigFilePath: config, useInMemoryFileSystem: false })
		: new Project({ useInMemoryFileSystem: false, compilerOptions: { target: ts.ScriptTarget.ES2022 } });
	fileCache = new Map();

	return project;
};

const sourceFileFor = (fileAbs) => {
	const cached = fileCache.get(fileAbs);
	if (cached) return cached;
	const file = projectFor(fileAbs).addSourceFileAtPath(fileAbs);
	fileCache.set(fileAbs, file);

	return file;
};

// The editor lints the in-memory buffer (ESLint `lintText`), which can differ
// from the on-disk file. The rule passes the live source here before parsing
// so the current buffer — not the disk state — is what gets analyzed.
const setLiveSource = (fileAbs, text) => {
	const sourceFile = sourceFileFor(fileAbs);
	if (sourceFile.getFullText() !== text) sourceFile.replaceWithText(text);
};

const isComponent = (node, sourceFile) => {
	const name = functionName(node, sourceFile);
	if (!/^[A-Z]/.test(name)) return false;
	const text = node.getText();
	return /<([A-Z][A-Za-z0-9]*)[\s/>]|<\/[A-Z]/.test(text);
};

const collectFunctionNodes = (sourceFile) => {
	const out = [];
	const visit = (node) => {
		const isFn =
			node.isKind(ts.SyntaxKind.FunctionDeclaration) ||
			node.isKind(ts.SyntaxKind.ArrowFunction) ||
			node.isKind(ts.SyntaxKind.FunctionExpression);
		if (isFn) {
			out.push(node);
			// Keep recursing: functions may nest inside other functions.
			node.forEachChild(visit);
			return;
		}
		node.forEachChild(visit);
	};
	visit(sourceFile);
	return out;
};

// The NODE that writes the callable's name. A `function foo` has one; an arrow
// passed as an object value takes its name from the property. This is the node
// the reported `name` came from, so its position is the name's position.
const nameNodeFor = (node) => {
	if (typeof node.getNameNode === "function" && node.getNameNode()) return node.getNameNode();
	const parent = node.getParent();
	if (parent && (parent.isKind(ts.SyntaxKind.VariableDeclaration) || parent.isKind(ts.SyntaxKind.PropertyAssignment))) return parent.getNameNode ? parent.getNameNode() : null;

	return null;
};

const functionName = (node, sourceFile) => {
	if (node.getName && node.getName()) return node.getName();
	const parent = node.getParent();
	if (parent) {
		if (parent.isKind(ts.SyntaxKind.VariableDeclaration)) {
			const name = parent.getName();
			if (name) return name;
		}
		if (parent.isKind(ts.SyntaxKind.PropertyAssignment)) {
			const name = parent.getName();
			if (name) return name;
		}
	}
	// Unnamed function (e.g. an arrow passed to .map()): give it a synthetic
	// owner-scoped name so it is still collected and compared by everything
	// else (structure, not name).
	let owner = "<top>";
	let p = node.getParent();
	while (p) {
		if (p.isKind(ts.SyntaxKind.FunctionDeclaration) && p.getName()) {
			owner = p.getName();
			break;
		}
		if (p.isKind(ts.SyntaxKind.ArrowFunction) || p.isKind(ts.SyntaxKind.FunctionExpression)) {
			const n = functionName(p, sourceFile);
			if (n !== "<anonymous>") {
				owner = n;
				break;
			}
		}
		p = p.getParent();
	}
	return `${owner}#anon@${node.getStartLineNumber()}`;
};

// ---------------------------------------------------------------------------
// Plain-tree mapping (TS AST → framework-agnostic node tree)
// Node: { kind, label, children: [] }
// ---------------------------------------------------------------------------

const unwrap = (node) => {
	while (
		node &&
		(node.isKind(ts.SyntaxKind.ParenthesizedExpression) ||
			node.isKind(ts.SyntaxKind.AsExpression) ||
			node.isKind(ts.SyntaxKind.TypeAssertionExpression) ||
			node.isKind(ts.SyntaxKind.NonNullExpression) ||
			node.isKind(ts.SyntaxKind.SatisfiesExpression))
	) {
		node = node.getExpression();
	}
	return node;
};

const calleeName = (call) => {
	const expr = unwrap(call.getExpression());
	if (!expr) return "?";
	if (expr.isKind(ts.SyntaxKind.Identifier)) return expr.getText();
	if (expr.isKind(ts.SyntaxKind.PropertyAccessExpression)) return expr.getName();
	if (expr.isKind(ts.SyntaxKind.ElementAccessExpression)) return expr.getExpression() ? calleeName({ getExpression: () => expr.getExpression() }) : "?";
	return "?";
};

// A JSX tag as a dotted string ("Panel.Section"), so the tag name — part of
// what a component renders — survives into the tree like a call target.
const jsxTagName = (tag) => {
	if (!tag) return "?";
	if (tag.isKind(ts.SyntaxKind.Identifier)) return tag.getText();
	if (tag.isKind(ts.SyntaxKind.PropertyAccessExpression)) return `${jsxTagName(tag.getExpression())}.${tag.getName()}`;
	if (tag.isKind(ts.SyntaxKind.ElementAccessExpression)) return `${jsxTagName(tag.getExpression())}[]`;
	return "?";
};

// The static text of a template head/middle/tail literal. Like string and
// number literals (Fix 5), a template's text is part of the logic: two
// templates that differ only in their static parts are different functions.
// Emitted as a `lit` node so normalization keeps the text (labels are only
// renamed for `ident`/`var-decl`/`assign`).
const templatePart = (lit) => (lit && typeof lit.getLiteralText === "function" ? { kind: "lit", label: lit.getLiteralText(), children: [] } : null);

// The object a method is called on (the receiver), so method-call chains
// like `s.split("-").map(f).join(" ")` keep their structure instead of
// collapsing to just the terminal call + its literal arguments.
const receiverOf = (call) => {
	const expr = unwrap(call.getExpression());
	if (expr && expr.isKind(ts.SyntaxKind.PropertyAccessExpression)) return expr.getExpression();
	if (expr && expr.isKind(ts.SyntaxKind.ElementAccessExpression)) return expr.getExpression();
	return null;
};

const toPlainTreeInner = (node) => {
	node = unwrap(node);
	if (!node) return null;
	const kids = (arr) => (arr || []).map((c) => toPlainTree(c)).filter(Boolean);

	if (node.isKind(ts.SyntaxKind.CallExpression)) {
		const receiver = receiverOf(node);
		const receiverChild = receiver ? toPlainTree(receiver) : null;
		const children = receiverChild ? [receiverChild, ...kids(node.getArguments())] : kids(node.getArguments());
		return { kind: "call", label: calleeName(node), arity: typeof node.getArguments === "function" ? node.getArguments().length : 0, ...callSpan(node), children };
	}
	if (node.isKind(ts.SyntaxKind.NewExpression)) return { kind: "new", label: calleeName({ getExpression: () => node.getExpression() }), children: kids(node.getArguments()) };
	if (node.isKind(ts.SyntaxKind.TaggedTemplateExpression)) return { kind: "call", label: calleeName({ getExpression: () => node.getTag() }), children: [{ kind: "template", label: "template", children: [] }] };
	if (node.isKind(ts.SyntaxKind.AwaitExpression)) return { kind: "await", label: "await", children: kids([node.getExpression()]) };
	if (node.isKind(ts.SyntaxKind.YieldExpression)) return { kind: "yield", label: "yield", children: node.getExpression() ? kids([node.getExpression()]) : [] };
	if (node.isKind(ts.SyntaxKind.Identifier)) return { kind: "ident", label: node.getText(), children: [] };
	if (node.isKind(ts.SyntaxKind.PropertyAccessExpression)) return { kind: "member", label: node.getName(), children: kids([node.getExpression()]) };
	if (node.isKind(ts.SyntaxKind.ElementAccessExpression)) return { kind: "index", label: "index", children: kids([node.getExpression(), node.getArgumentExpression()]) };
	if (node.isKind(ts.SyntaxKind.JsxElement)) {
		// Keep the tag name and the attribute names (shape of the render),
		// plus the children. Attribute VALUES are expressions too, so they
		// stay as children of the attribute node.
		return { kind: "jsx", label: jsxTagName(node.getOpeningElement().getTagNameNode()), children: [...kids(node.getOpeningElement().getAttributes()), ...kids(node.getJsxChildren())] };
	}
	if (node.isKind(ts.SyntaxKind.JsxSelfClosingElement)) return { kind: "jsx", label: jsxTagName(node.getTagNameNode()), children: kids(node.getAttributes()) };
	if (node.isKind(ts.SyntaxKind.JsxAttribute)) {
		const nameNode = node.getNameNode();
		return { kind: "jsx-attr", label: nameNode ? nameNode.getText() : "?", children: node.getInitializer() ? kids([node.getInitializer()]) : [] };
	}
	if (node.isKind(ts.SyntaxKind.JsxSpreadAttribute)) return { kind: "jsx-spread", label: "jsx-spread", children: kids([node.getExpression()]) };
	if (node.isKind(ts.SyntaxKind.JsxExpression)) return { kind: "jsx-expr", label: "jsx-expr", children: node.getExpression() ? kids([node.getExpression()]) : [] };
	if (node.isKind(ts.SyntaxKind.JsxText)) {
		// Static text between tags is part of the render, like a literal.
		return { kind: "lit", label: node.getText().replace(/\s+/g, " ").trim(), children: [] };
	}
	if (node.isKind(ts.SyntaxKind.BinaryExpression)) return { kind: "bin", label: opOf(node.getOperatorToken()), children: kids([node.getLeft(), node.getRight()]) };
	if (node.isKind(ts.SyntaxKind.PrefixUnaryExpression)) return { kind: "unary", label: opOf(node.getOperatorToken()), children: kids([node.getOperand()]) };
	if (node.isKind(ts.SyntaxKind.PostfixUnaryExpression)) return { kind: "unary-post", label: opOf(node.getOperatorToken()), children: kids([node.getOperand()]) };
	if (node.isKind(ts.SyntaxKind.ConditionalExpression)) return { kind: "cond", label: "cond", column: tokenColumn(node.getQuestionToken()), columnEnd: tokenColumn(node.getQuestionToken()), children: kids([node.getCondition(), node.getWhenTrue(), node.getWhenFalse()]) };
	if (node.isKind((ts.SyntaxKind as any).CommaExpression)) return { kind: "seq", label: "seq", children: kids(node.getOperands()) };
	if (node.isKind(ts.SyntaxKind.SpreadElement)) return { kind: "spread", label: "spread", children: kids([node.getExpression()]) };
	if (node.isKind(ts.SyntaxKind.ObjectLiteralExpression)) return { kind: "object", label: "object", ...literalSpan(node), children: kids(node.getProperties()) };
	if (node.isKind(ts.SyntaxKind.PropertyAssignment)) {
		// Keep the property name (part of the object's shape, like a member
		// property name) and the value expression as a child. Before this,
		// PropertyAssignment fell into the default case and its value was
		// dropped, so any two object builders with the same property count
		// collapsed to identical trees (the emptyTotals false-positive).
		const name = node.getName();
		return { kind: "prop", label: name || "?", children: node.getInitializer() ? kids([node.getInitializer()]) : [] };
	}
	if (node.isKind(ts.SyntaxKind.ShorthandPropertyAssignment)) {
		const name = node.getName();
		return { kind: "prop", label: name || "?", children: node.getInitializer() ? kids([node.getInitializer()]) : [] };
	}
	if (node.isKind(ts.SyntaxKind.ArrayLiteralExpression)) return { kind: "array", label: "array", ...literalSpan(node), children: kids(node.getElements()) };
	if (node.isKind(ts.SyntaxKind.TemplateExpression)) {
		// Keep BOTH the interpolation expressions and the static text
		// between them: the text is logic, like a literal value (Fix 5).
		// `/patients/${id}?module=notes` vs `vitals-encounter-${id}`
		// differ in the static parts; dropping them made every template
		// one-liner an identical tree (the false 9-fn "Url" cluster).
		const parts = [templatePart(node.getHead())];
		for (const span of node.getTemplateSpans()) {
			parts.push(toPlainTree(span.getExpression()));
			parts.push(templatePart(span.getLiteral()));
		}
		return { kind: "template", label: "template", children: parts.filter(Boolean) };
	}
	if (node.isKind(ts.SyntaxKind.NoSubstitutionTemplateLiteral)) return { kind: "template", label: "template", children: [templatePart(node)] };
	if (node.isKind(ts.SyntaxKind.ArrowFunction) || node.isKind(ts.SyntaxKind.FunctionExpression)) {
		// The DECLARATION form is the construct: `function` or `=>`.
		return { kind: "func", label: "<fn>", ...funcSpan(node), children: node.getBody() ? kids([node.getBody()]) : [] };
	}
	if (node.isKind(ts.SyntaxKind.IfStatement)) {
		return { kind: "if", label: "if", children: [toPlainTree(node.getExpression()), toPlainTree(node.getThenStatement()), node.getElseStatement() ? toPlainTree(node.getElseStatement()) : null].filter(Boolean) };
	}
	if (node.isKind(ts.SyntaxKind.ForStatement)) {
		return { kind: "for", label: "for", children: [node.getInitializer() ? toPlainTree(node.getInitializer()) : null, node.getCondition() ? toPlainTree(node.getCondition()) : null, node.getIncrementor() ? toPlainTree(node.getIncrementor()) : null, toPlainTree(node.getStatement())].filter(Boolean) };
	}
	if (node.isKind(ts.SyntaxKind.ForOfStatement) || node.isKind(ts.SyntaxKind.ForInStatement)) {
		return { kind: "for-of", label: "for-of", children: [toPlainTree(node.getInitializer()), toPlainTree(node.getExpression()), toPlainTree(node.getStatement())].filter(Boolean) };
	}
	if (node.isKind(ts.SyntaxKind.WhileStatement)) return { kind: "while", label: "while", children: kids([node.getExpression(), node.getStatement()]) };
	if (node.isKind(ts.SyntaxKind.DoStatement)) return { kind: "do-while", label: "do-while", children: kids([node.getStatement(), node.getExpression()]) };
	if (node.isKind(ts.SyntaxKind.SwitchStatement)) {
		// The clauses live under the case block, NOT a `cases` property.
		// Before this fix every switch collapsed to `switch[ident]`, so any
		// two switch-based normalizers scored AST 1.00 (the Status/Identifiers
		// false clusters).
		return { kind: "switch", label: "switch", children: [toPlainTree(node.getExpression()), ...kids(node.getCaseBlock() ? node.getCaseBlock().getClauses() : [])] };
	}
	if (node.isKind(ts.SyntaxKind.CaseClause) || node.isKind(ts.SyntaxKind.DefaultClause)) return { kind: "case", label: "case", children: kids(node.getStatements()) };
	if (node.isKind(ts.SyntaxKind.ReturnStatement)) return { kind: "return", label: "return", children: node.getExpression() ? kids([node.getExpression()]) : [] };
	if (node.isKind(ts.SyntaxKind.ThrowStatement)) return { kind: "throw", label: "throw", children: kids([node.getExpression()]) };
	if (node.isKind(ts.SyntaxKind.TryStatement)) {
		return { kind: "try", label: "try", children: [toPlainTree(node.getTryBlock()), node.getCatchClause() ? toPlainTree(node.getCatchClause()) : null, node.getFinallyBlock() ? toPlainTree(node.getFinallyBlock()) : null].filter(Boolean) };
	}
	if (node.isKind(ts.SyntaxKind.CatchClause)) return { kind: "catch", label: "catch", children: kids([node.getBlock()]) };
	// A destructuring declaration is NOT a plain one: `const { postMessage } = ctx`
// binds by PATTERN, and the reader checks the braces, not the name. Its kind says
// so, and its column points at the `{` — the same position the page paints.
        if (node.isKind(ts.SyntaxKind.VariableStatement)) {
                const declarations = node.getDeclarationList().getDeclarations();
                const pattern = declarations.find((decl) => {
                        const name = decl.getNameNode();

                        return name && name.isKind(ts.SyntaxKind.ObjectBindingPattern, ts.SyntaxKind.ArrayBindingPattern);
                });
                if (pattern) {
                        const name = pattern.getNameNode();
                        const span = patternSpan(name);

                        return {
                                kind: "var-destr",
                                label: "var-destr",
                                column: span.column,
                                columnEnd: span.columnEnd,
                                // A pattern can open on one line and close on another; the closing
                                // brace is still part of the construct, so its line travels too.
                                endLine: name && typeof name.getEndLineNumber === "function" ? name.getEndLineNumber() : undefined,
                                children: kids(declarations),
                        };
                }

                // A plain declaration is marked on the NAME it binds (`requestId`), and the
                // name travels with the node: two declarations are the same declaration only
                // when they bind the same name.
                // The CONSTRUCT is the `const` keyword: that is what a reader checks in
                // the structure tab. The bound NAME is data for pairing, not a mark.
                // The KEYWORD is kept as its own fact: `const`, `let` and `var` are three
                // different declarations, and control flow must not treat them as one step.
                const keyword = node.getDeclarationList().getChildren()[0] ?? null;

                return {
                        kind: "var",
                        label: "var",
                        name: declarations.map((decl) => decl.getName()).join(","),
                        keyword: keyword && typeof keyword.getText === "function" ? keyword.getText() : undefined,
                        column: tokenColumn(keyword),
                        columnEnd: keyword && typeof keyword.getEnd === "function" ? columnAt(node.getSourceFile(), keyword.getEnd()) - 1 : undefined,
                        children: kids(declarations),
                };
        }
	if (node.isKind(ts.SyntaxKind.VariableDeclaration)) return { kind: "var-decl", label: node.getName() || "?", children: node.getInitializer() ? kids([node.getInitializer()]) : [] };
	if (node.isKind((ts.SyntaxKind as any).AssignmentExpression)) return { kind: "assign", label: assignTarget(node.getLeft()), children: kids([node.getRight()]) };
	if (node.isKind(ts.SyntaxKind.Block)) return { kind: "block", label: "block", children: kids(node.getStatements()) };
	if (node.isKind(ts.SyntaxKind.ExpressionStatement)) return toPlainTree(node.getExpression());
	if (node.isKind(ts.SyntaxKind.NumericLiteral) || node.isKind(ts.SyntaxKind.StringLiteral)) {
		// A literal's VALUE is logic, not a renameable name. Before this, every
		// string/number collapsed to an anonymous `lit` node, so any two one-
		// liners differing only in a constant (`x === "active"` vs
		// `x === "entered-in-error"`, `code === 404` vs `code === 412`) scored
		// AST 1.00 and clustered as "copies". Identifiers are still positionally
		// renamed (RXNORM_SYSTEM vs SNOMED_SYSTEM -> equal), so genuine
		// "same logic, different name" twins are unaffected.
		return { kind: "lit", label: node.getText(), children: [] };
	}
	if (node.isKind(ts.SyntaxKind.TrueKeyword) || node.isKind(ts.SyntaxKind.FalseKeyword) || node.isKind(ts.SyntaxKind.NullKeyword) || node.isKind(ts.SyntaxKind.ThisKeyword)) {
		return { kind: "lit", label: "lit", children: [] };
	}
	if (node.isKind((ts.SyntaxKind as any).Noop)) return null;
	return { kind: "expr", label: node.getKindName() || "expr", children: [] };
};

const opOf = (token) => {
	if (!token) return "?";
	if (typeof token === "string") return token;
	// The OPERATOR ITSELF (`&&`, `!==`, `instanceof`). The syntax-kind name
	// (`BarBarToken`, `54`) is a different operator for every spelling of the same
	// token, so equivalent code compared unequal.
	if (typeof token.getText === "function") return token.getText();
	if (token.isKind) return ts.SyntaxKind[token.getKind()] || String(token);
	return String(token);
};

const assignTarget = (left) => {
	const n = unwrap(left);
	if (!n) return "?";
	if (n.isKind(ts.SyntaxKind.Identifier)) return n.getText();
	if (n.isKind(ts.SyntaxKind.PropertyAccessExpression)) return n.getName();
	if (n.isKind(ts.SyntaxKind.ElementAccessExpression)) return "index";
	return "?";
};

// ---------------------------------------------------------------------------
// Signature extraction (raw — canonicalization happens in normalize/signature)
// ---------------------------------------------------------------------------

// ts-morph renders module-qualified types as `import("<absolute path>").Name`
// when a full type checker is attached, but as bare `Name` otherwise. The path
// is environment-specific, so two parses of the same code produce different
// signature keys; strip the import prefix so both contexts compare equal.
const sanitizeTypeText = (text) => String(text || "").replace(/import\("[^"]*"\)\./g, "").replace(/import\("[^"]*"\)/g, "import");

const paramInfo = (p) => ({
	name: p.getName() || "?",
	type: p.getType() ? sanitizeTypeText(p.getType().getText()) : "",
	hasDefault: !!p.getInitializer(),
	isRest: !!p.getDotDotDotToken(),
	isOptional: p.isOptional ? p.isOptional() : false,
	// Where the parameter is written. Without a position the page can only search
	// for the word, and a word is not a declaration.
	...siteOf(p),
});

// WHERE a node is written (line + 1-based column): columnAt/siteOf live in
// normalize/node-position, shared with entities/tree/node.ts.
// The 1-based column of a TOKEN the parser already resolved (`?`, `=>`). Same
// arithmetic as `siteOf`, for the few kinds whose interesting position is not the
// node start.
const tokenColumn = (token) => {
	if (!token || typeof token.getStart !== "function") return undefined;

	return columnAt(token.getSourceFile(), token.getStart());
};

// The span of a binding pattern on ONE line: where the `{` starts and where the
// `}` ends. A mark paints the whole pattern, both braces included, because that is
// the construct — the initializer is somebody else's node.
const patternSpan = (pattern) => {
        if (!pattern || typeof pattern.getStart !== "function") return { column: undefined, columnEnd: undefined };
        const file = pattern.getSourceFile();

        return {
                column: columnAt(file, pattern.getStart()),
                // The closing brace has a column whether or not it shares the line; that is
                // `endLine`'s business, not a reason to drop it.
                columnEnd: columnAt(file, pattern.getEnd()) - 1,
        };
};

// The name belongs to the `function declarations` lane only as a label; the
// RANGE a reader needs there is the form itself.
const headOf = (node, nameNode) => {
	const file = node.getSourceFile();
	const kids = typeof node.getChildren === "function" ? node.getChildren() : [];
	// `async` is a MODIFIER, and modifiers arrive as one `SyntaxList` — so the tokens
	// of the head are read one level deep, not from the direct children only.
	// The kind is asked of the node (`getKind`), because ts-morph nodes do not carry
	// the compiler's `kind` field.
	const kindOf = (child) => (typeof child.getKind === "function" ? child.getKind() : child.kind);
	const tokens = kids.flatMap((child) => (kindOf(child) === ts.SyntaxKind.SyntaxList ? child.getChildren() : [child]));
	const find = (kind) => tokens.find((child) => kindOf(child) === kind);
	const spanOf = (from, to) => ({
		line: from.getStartLineNumber(),
		column: columnAt(file, from.getStart()),
		columnEnd: columnAt(file, to.getEnd()) - 1,
	});

	// `async function f()` — the modifier is part of what the form reads as.
	const keyword = find(ts.SyntaxKind.FunctionKeyword);
	if (keyword) {
		const asyncKeyword = find(ts.SyntaxKind.AsyncKeyword);

		return asyncKeyword && asyncKeyword.getStartLineNumber() === keyword.getStartLineNumber() ? spanOf(asyncKeyword, keyword) : spanOf(keyword, keyword);
	}
	// `get value()` / `set value(v)` — the accessor word is the form.
	const accessor = find(ts.SyntaxKind.GetKeyword) ?? find(ts.SyntaxKind.SetKeyword);
	if (accessor) return spanOf(accessor, accessor);
	// `async (a, b) => …` — the modifier, the parameter list and the arrow, when
	// they share a row.
	const arrow = find(ts.SyntaxKind.EqualsGreaterThanToken);
	if (arrow) {
		const open = find(ts.SyntaxKind.OpenParenToken);
		const asyncKeyword = find(ts.SyntaxKind.AsyncKeyword);
		const from = asyncKeyword && asyncKeyword.getStartLineNumber() === arrow.getStartLineNumber() ? asyncKeyword : open;

		return from && from.getStartLineNumber() === arrow.getStartLineNumber() ? spanOf(from, arrow) : spanOf(arrow, arrow);
	}

	// A method or a function expression with no keyword: the name IS the form.
	return nameNode ? { ...siteOf(nameNode), columnEnd: columnAt(file, nameNode.getEnd()) - 1 } : null;
};

// A destructured pattern declares its KEYS, not one name: `{ target, width }`
// introduces `target` and `width`, exactly like `const { target } = options`
// introduces them in a body. So they are variable declarations, each with its
// own position — a pattern is not a name, but the names inside it are real.
/**
 * The reader's words for a syntax kind, derived from the kind itself: no table of
 * cases to maintain. `VariableDeclaration` → "variable declarations".
 */
const humanizeKind = (syntaxKind) => String(ts.SyntaxKind[syntaxKind] ?? syntaxKind)
	.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
	.toLowerCase()
	.replace(/^\s+|\s+$/g, "");
const pluralOf = (syntaxKind) => {
	const text = humanizeKind(syntaxKind);

	return text.endsWith("s") ? text : `${text}s`;
};

const bindingSites = (nameNode, kind, syntaxKind) => {
	if (!nameNode || typeof nameNode.getElements !== "function") return [];

	return nameNode.getDescendantsOfKind(ts.SyntaxKind.BindingElement).map((element) => ({
		name: element.getName(),
		kind,
		label: pluralOf(syntaxKind),
		...siteOf(element),
	}));
};

// One declaration site: a plain name at its own position, or every key a
// destructuring pattern binds.
const siteFor = (nameNode, kind, syntaxKind) => {
	if (!nameNode) return [];
	if (/^[A-Za-z_$][\w$]*$/.test(nameNode.getText())) return [{ name: nameNode.getText(), kind, label: pluralOf(syntaxKind), ...siteOf(nameNode) }];

	return bindingSites(nameNode, kind, syntaxKind);
};

// EVERY name the declaration introduces, wherever it is written: its own name,
// the parameters of the function AND of the callbacks written inside it, the
// variables it declares, the keys of the objects it writes, and the keys of the
// type literals in its annotations (`handler: (provider: unknown) => void`
// introduces `handler` and `provider` too). The body tree covers the body; the
// declaration half — parameters and type annotations — is not in the tree, so
// it is read here, once.
const declaredSitesOf = (node) => {
	const sites = [];
	const nameNodeOf = (owner) => (typeof owner.getNameNode === "function" ? owner.getNameNode() : null);

	sites.push(...siteFor(nameNodeOf(node), "function", ts.SyntaxKind.FunctionDeclaration).map((site) => ({ ...site, head: headOf(node, nameNodeOf(node)) })));
	// ONLY the function's OWN parameters are its signature. `entries.map(([key, value]) => …)`
	// declares `key`/`value` in the BODY, and calling them "parameters" put a row of a `map`
	// under the same lane as the signature it has nothing to do with.
	const ownParams = node.getParameters?.() ?? [];
	const ownParamNames = new Set(ownParams.map((param) => nameNodeOf(param)));
	for (const param of ownParams) sites.push(...siteFor(nameNodeOf(param), "param", ts.SyntaxKind.Parameter));
	for (const param of node.getDescendantsOfKind(ts.SyntaxKind.Parameter)) {
		const nameNode = nameNodeOf(param);
		if (nameNode === null || ownParamNames.has(nameNode)) continue;
		sites.push(...siteFor(nameNode, "callback-param", ts.SyntaxKind.Parameter).map((site) => ({ ...site, label: "callback parameters" })));
	}
	for (const decl of node.getDescendantsOfKind(ts.SyntaxKind.VariableDeclaration)) sites.push(...siteFor(nameNodeOf(decl), "var-decl", ts.SyntaxKind.VariableDeclaration));
	for (const prop of node.getDescendantsOfKind(ts.SyntaxKind.PropertyAssignment)) sites.push(...siteFor(nameNodeOf(prop), "prop", ts.SyntaxKind.PropertyAssignment));
	// A TYPE-position member (`{ id: string }` in a return type or an `as` cast) is a
	// DIFFERENT kind from a value property (`{ id: payload.id }`). Sharing `prop` let a
	// declaration header's return-type members join the body's property lane — a ribbon
	// from the function head to the body. `type-prop` keeps them in their own category.
	for (const sig of node.getDescendantsOfKind(ts.SyntaxKind.PropertySignature)) sites.push(...siteFor(nameNodeOf(sig), "type-prop", ts.SyntaxKind.PropertySignature));
	// The name a copy also WRITES: `result = …`, `options.limit = …`. Not a
	// declaration, so it was absent from the name bag entirely — one whole half of
	// an object being filled in was invisible to signature. The name of a member
	// assignment is the MEMBER (`limit`, the same name `prop` sites carry), not the
	// whole expression.
	for (const assign of node.getDescendantsOfKind((ts.SyntaxKind as any).AssignmentExpression)) {
		const left = assign.getLeft();
		const target = left.isKind(ts.SyntaxKind.PropertyAccessExpression) && typeof left.getNameNode === "function" ? left.getNameNode() : left;
		sites.push(...siteFor(target, "assign", (ts.SyntaxKind as any).AssignmentExpression));
	}

	return sites;
};

// ---------------------------------------------------------------------------
// THE RETURN — what the function hands back.
//
// Compared on its own: a `number` and the SAME number are different amounts of
// evidence, a returned object is not the same evidence as the same object, and
// `return undefined` is stronger than no `return` at all. Only the SHAPE of the
// value is described here, with methods and callees collapsed to `fn`/`v.name`;
// the keys of a returned object are already counted as names elsewhere, so they
// are not counted twice by this signal.
// ---------------------------------------------------------------------------

const calleeShapeOf = (expr) => {
	if (!expr) return "?";
	if (expr.isKind(ts.SyntaxKind.PropertyAccessExpression)) return `${calleeShapeOf(expr.getExpression())}.${expr.getName()}`;
	if (expr.isKind(ts.SyntaxKind.Identifier)) return "v";

	return "?";
};

const shapeOfExpr = (expr) => {
	if (!expr) return { role: "undefined", shape: "undefined" };
	if (expr.isKind(ts.SyntaxKind.Identifier)) return expr.getText() === "undefined" ? { role: "undefined", shape: "undefined" } : { role: "ident", shape: "v" };
	if (expr.isKind(ts.SyntaxKind.ObjectLiteralExpression)) {
		const parts = expr.getProperties().map((prop) => {
			const name = prop.getName ? prop.getName() : "?";
			// A method inside the returned object is `fn`: its body is not the return's
			// business (and a copy is compared by its own AST group).
			if (prop.isKind(ts.SyntaxKind.MethodDeclaration)) return `${name}:fn`;
			if (prop.isKind(ts.SyntaxKind.PropertyAssignment)) return `${name}:${shapeOfExpr(prop.getInitializer()).shape}`;
			if (prop.isKind(ts.SyntaxKind.ShorthandPropertyAssignment)) return `${name}:v`;
			if (prop.isKind(ts.SyntaxKind.SpreadAssignment)) return `...:${shapeOfExpr(prop.getExpression()).shape}`;

			return `${name}:?`;
		});

		return { role: "object", shape: `{${parts.sort().join(",")}}` };
	}
	if (expr.isKind(ts.SyntaxKind.ArrayLiteralExpression)) return { role: "array", shape: `[${expr.getElements().map((item) => shapeOfExpr(item).shape).join(",")}]` };
	if (expr.isKind(ts.SyntaxKind.StringLiteral) || expr.isKind(ts.SyntaxKind.NoSubstitutionTemplateLiteral)) return { role: "string", shape: `str:${expr.getText()}` };
	if (expr.isKind(ts.SyntaxKind.NumericLiteral)) return { role: "number", shape: `num:${expr.getText()}` };
	if (expr.isKind(ts.SyntaxKind.PrefixUnaryExpression) && expr.getOperand().isKind(ts.SyntaxKind.NumericLiteral)) return { role: "number", shape: `num:${expr.getText().replace(/\s+/g, "")}` };
	if (expr.isKind(ts.SyntaxKind.TrueKeyword) || expr.isKind(ts.SyntaxKind.FalseKeyword)) return { role: "boolean", shape: expr.getText() };
	if (expr.isKind(ts.SyntaxKind.ArrowFunction) || expr.isKind(ts.SyntaxKind.FunctionExpression)) return { role: "fn", shape: "fn" };
	if (expr.isKind(ts.SyntaxKind.CallExpression)) return { role: "call", shape: `call:${calleeShapeOf(expr.getExpression())}(${expr.getArguments().map((arg) => shapeOfExpr(arg).shape).join(",")})` };
	if (expr.isKind(ts.SyntaxKind.NewExpression)) return { role: "call", shape: `new:${calleeShapeOf(expr.getExpression())}` };
	if (expr.isKind(ts.SyntaxKind.PropertyAccessExpression)) return { role: "expr", shape: calleeShapeOf(expr) };

	return { role: "expr", shape: expr.getText().replace(/\s+/g, " ") };
};

// Every `return` written in the function's body — including the ones inside inline
// callbacks it hands to other calls (the `async (…) => { … return … }` that comes
// back with the value). Those are part of what a copy copies: skipping them made
// the whole return of a tool-registering function invisible to signature.
const returnsOf = (fn) => {
	const body = fn.getBody();
	if (!body) return [];

	return body
		.getDescendantsOfKind(ts.SyntaxKind.ReturnStatement)
		.map((ret) => ({ ...shapeOfExpr(ret.getExpression()), line: ret.getStartLineNumber() }));
};

// ---------------------------------------------------------------------------
// Descriptor builder
// ---------------------------------------------------------------------------

const buildDescriptor = (node, sourceFile, fileAbs) => {
	const name = functionName(node, sourceFile);
	const params = (node.getParameters() || []).map((p) => paramInfo(p));
	const typeParams = (node.getTypeParameters() || []).map((tp) => (tp.getName ? tp.getName() : ""));

	// The return type, not the whole callable type. `node.getType().getText()`
	// on an arrow yields `(iso: string) => Day` — the full signature — which
	// leaks the parameter types into the return-role classification (both a
	// `Day`-returning and a `string`-returning function would read as "string").
	// The call signature's return type is the actual return type.
	const callSig = node.getType() && node.getType().getCallSignatures ? node.getType().getCallSignatures() : [];
	const returnType = callSig.length && callSig[0].getReturnType() ? sanitizeTypeText(callSig[0].getReturnType().getText()) : "";
	const isAsync = node.getModifiers().some((m) => m.isKind(ts.SyntaxKind.AsyncKeyword));
	const isGenerator = typeof node.getAsteriskToken === "function" ? node.getAsteriskToken() != null : false;

	const bodyTree = node.getBody() ? toPlainTree(node.getBody()) : null;

	const { line, column } = siteOf(node);
	const endLine = node.getEndLineNumber();

		// The names the DECLARATION introduces, with their exact positions — see
		// `declaredSitesOf`. The body tree contributes its own (normalize/tree.js).
		const declared = declaredSitesOf(node);

		return {
		name,
		path: fileAbs,
		line,
		endLine,
		column,
		params,
		declaredSites: declared,
		// WHERE the reported `name` is written. The report never searches the line
		// for it: the decision maker hands over the position it read the name from.
		nameSite: nameNodeFor(node) ? { name, ...siteOf(nameNodeFor(node)) } : null,
		returnType,
		typeParams,
		returnValues: returnsOf(node),
		flags: {
			async: !!isAsync,
			generator: !!isGenerator,
		},
		bodyTree,
		rawText: node.getBody() ? node.getBody().getText() : "",
	};
};


// Collects EVERY function in the file — exported, non-exported, nested,
// anonymous callbacks. Unnamed functions get synthetic names (see functionName)
// and are compared by structure, not by name. Interfaces and type aliases are
// not functions and are not compared here: they belong to entities-uniqueness.
const parseFunctions = (fileAbs) => {
	const sourceFile = sourceFileFor(fileAbs);

	const out = [];
	for (const node of collectFunctionNodes(sourceFile)) {
		if (isComponent(node, sourceFile)) continue;
		out.push(buildDescriptor(node, sourceFile, fileAbs));
	}
	return out;
};

// ---------------------------------------------------------------------------
// Partial duplicates: a contiguous block of statements inside a function body.
// Mirrors component-uniqueness `parseParts`.
// ---------------------------------------------------------------------------

import { MIN_PART_STATEMENTS } from "../constants";

const parseParts = (fileAbs, opts = {}) => {
	const sourceFile = sourceFileFor(fileAbs);
	const out = [];

	const visit = (node) => {
		if (node.isKind(ts.SyntaxKind.Block) && node.getStatements().length >= MIN_PART_STATEMENTS) {
			const owner = ownerFunctionName(node, sourceFile);
			const { line, column } = siteOf(node);
			const endLine = node.getEndLineNumber();
			const bodyTree = toPlainTree(node);
			if (bodyTree && bodyTree.children && bodyTree.children.length >= MIN_PART_STATEMENTS) {
				out.push({
					owner,
					rootTag: "block",
					name: `${owner}#block`,
					path: fileAbs,
					line,
					endLine,
					column,
					partial: true,
					bodyTree,
					rawText: node.getText(),
				});
			}
		}
		node.forEachChild(visit);
	};
	visit(sourceFile);
	return out;
};

const ownerFunctionName = (node, sourceFile) => {
	let p = node.getParent();
	while (p) {
		if (p.isKind(ts.SyntaxKind.FunctionDeclaration)) return p.getName() || "<fn>";
		if ((p.isKind(ts.SyntaxKind.ArrowFunction) || p.isKind(ts.SyntaxKind.FunctionExpression)) && p.getParent()) {
			const n = functionName(p, sourceFile);
			if (n !== "<anonymous>") return n;
		}
		p = p.getParent();
	}
	return "<fn>";
};

// A tree node carries its own source lines AND the column it starts at, 1-based
// and relative to the snippet that was parsed. The line answers "which node is
// under this line of code?"; the column answers "WHERE in the line", so a name
// can be painted at the exact place it is declared instead of every place the
// same word occurs (`options.provider` used to be painted as if `options` were
// the declared name).
// The 0-based index just past the mark of a node: through the `(` for a call, up
// to the end of the first token for anything else. Positions come from the
// parser, so no layer above has to look the word up in the line.
// A call is marked as a CALL: from the method/function name through its closing
// `)` — `append(change)`, not `changeLog`.
// The LINE and the 1-based COLUMN of a character offset, from the text itself. A
// mark is "a range on a row", so an offset must be answered with both — looking
// only at the column silently mixes rows of a multi-line expression.
const posInfo = (file, pos) => {
	const text = file.getFullText();
	let line = 1;
	let start = 0;
	for (let index = 0; index < pos; index += 1) {
		if (text[index] === "\n") {
			line += 1;
			start = index + 1;
		}
	}

	return { line, column: pos - start + 1 };
};

const callSpan = (node) => {
	if (!node || typeof node.getEnd !== "function") return {};
	const callee = typeof node.getExpression === "function" ? node.getExpression() : null;
	if (!callee || typeof callee.getEnd !== "function") return {};
	// A call is marked on its ARGUMENT LIST — `(200)`, `()`, `(["active"])` — because
	// that is the boundary of the call and nothing else: `z.number().int().min(200)`
	// is three calls, three pairs of parens. A mark is a range on ONE row, so a call
	// whose `(` and `)` sit on different rows gets no mark rather than a wrong one.
	const file = node.getSourceFile();
	const open = posInfo(file, callee.getEnd());
	const close = posInfo(file, node.getEnd());

	// The mark is the ARGUMENT LIST — `(200)`, `()`, `(["active"])`. When the call is
	// written over several rows the list has no single range, and the mark is the
	// opening `(` alone: a range cannot cross a row, and no other layer should guess.
	if (open.line === close.line) return { line: open.line, column: open.column, columnEnd: close.column - 1 };

	// Written over several rows: BOTH parens are marked, the closing one on its own row.
	return { line: open.line, column: open.column, columnEnd: close.column - 1, endLine: close.line };
};

// The span of an object/array literal: the OPENING bracket on the row the literal
// starts, and the CLOSING bracket's column plus the row it sits on (`endLine`). A
// literal is often written over several rows; both brackets are the construct, so
// both are marked — the closing one on its own row when it differs. Same convention
// as `callSpan`/`patternSpan`: `columnEnd` is the closing bracket's column, `endLine`
// the row it closes on (absent when both brackets share a row).
const literalSpan = (node) => {
	if (!node || typeof node.getStart !== "function" || typeof node.getEnd !== "function") return {};
	const file = node.getSourceFile();
	const open = posInfo(file, node.getStart());
	const close = posInfo(file, node.getEnd() - 1);

	return { column: open.column, columnEnd: close.column, ...(close.line !== open.line ? { endLine: close.line } : {}) };
};

// A function is marked by HOW it is declared, never by its name: `function` for a
// function expression, `=>` for an arrow. That is the fact structure compares.
const funcSpan = (node) => {
	const children = typeof node.getChildren === "function" ? node.getChildren() : [];
	const isArrow = node.isKind(ts.SyntaxKind.ArrowFunction);
	const token = isArrow
		? children.find((child) => child.isKind?.(ts.SyntaxKind.EqualsGreaterThanToken))
		: children.find((child) => child.isKind?.(ts.SyntaxKind.FunctionKeyword));
	if (!token) return {};
	const file = node.getSourceFile();

	return { column: columnAt(file, token.getStart()), columnEnd: columnAt(file, token.getEnd()) - 1 };
};

const spanEndOf = (node, column) => {
	if (!node || typeof node.getEnd !== "function") return undefined;
	const file = node.getSourceFile();
	// `call` is marked through its `(`, everything else by its first CHILD — the
	// keyword token (`if`, `try`, `new`, `return`). The compiler nodes here have no
	// `getFirstToken`, so the first child is the token.
	const tail =
		node.isKind(ts.SyntaxKind.CallExpression) && typeof node.getExpression === "function"
			? node.getExpression()
			: typeof node.getChildren === "function" && node.getChildren().length > 0
				? node.getChildren()[0]
				: node;
	if (!tail || typeof tail.getEnd !== "function") return undefined;
	// A construct that closes on another row is marked by its first token only: a
	// range cannot cross a row.
	const sameRow = tail.getStartLineNumber?.() === tail.getEndLineNumber?.();
	const end = sameRow ? columnAt(file, tail.getEnd()) - 1 : column;

	return end > column ? end : column;
};

const toPlainTree = (node) => {
	const out = toPlainTreeInner(node);
	if (!out) return null;
	const plain = unwrap(node);
	if (plain && typeof plain.getStartLineNumber === "function") {
		const { line, column } = siteOf(plain);
		// A kind that named its own ROW wins: a call inside a chain is written where its
		// NAME is, not where the chain begins (`z`).
		out.start = typeof out.line === "number" ? out.line : line;
		out.end = plain.getEndLineNumber();
		// A kind that named its own column wins: `cond` points at the `?`, not at the
		// start of the condition.
		out.column = out.column ?? column;
		// HOW WIDE the mark is — measured by the parser, never searched for in the
		// text: a call is marked through its `(` (`append(`), everything else by its
		// first token (`try`, `return`, `await`).
		out.columnEnd = out.columnEnd ?? spanEndOf(plain, out.column);
	}
	// The NODE NAME a reader knows: `VariableDeclaration`, `FunctionDeclaration`, …
	// Taken from the syntax kind itself, so there is nothing to keep in sync.
	if (plain && typeof plain.getKindName === "function") out.syntax = plain.getKindName();

	return out;
};

const available = () => true;
const whenReady = async (_config?) => {};
export { available, whenReady, parseFunctions, parseParts, setLiveSource, setTsConfig, functionName, toPlainTree };
