"use strict";

const { Project, ts } = require("ts-morph");

// ---------------------------------------------------------------------------
// Function discovery — EVERY function: top-level, nested, callbacks, and
// anonymous arrows. There is no exported-only contract: all functions are
// comparable utilities.
// ---------------------------------------------------------------------------

// One shared Project across the whole scan. ts-morph caches parsed files, so
// re-adding the same path returns the same SourceFile (no re-parse).
const project = new Project({ useInMemoryFileSystem: false, compilerOptions: { target: ts.ScriptTarget.ES2022 } });
const fileCache = new Map();

const sourceFileFor = (fileAbs) => {
	const cached = fileCache.get(fileAbs);
	if (cached) return cached;
	const file = project.addSourceFileAtPath(fileAbs);
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

const toPlainTree = (node) => {
	node = unwrap(node);
	if (!node) return null;
	const kids = (arr) => (arr || []).map((c) => toPlainTree(c)).filter(Boolean);

	if (node.isKind(ts.SyntaxKind.CallExpression)) {
		const receiver = receiverOf(node);
		const receiverChild = receiver ? toPlainTree(receiver) : null;
		const children = receiverChild ? [receiverChild, ...kids(node.getArguments())] : kids(node.getArguments());
		return { kind: "call", label: calleeName(node), children };
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
	if (node.isKind(ts.SyntaxKind.ConditionalExpression)) return { kind: "cond", label: "cond", children: kids([node.getCondition(), node.getWhenTrue(), node.getWhenFalse()]) };
	if (node.isKind(ts.SyntaxKind.CommaExpression)) return { kind: "seq", label: "seq", children: kids(node.getOperands()) };
	if (node.isKind(ts.SyntaxKind.SpreadElement)) return { kind: "spread", label: "spread", children: kids([node.getExpression()]) };
	if (node.isKind(ts.SyntaxKind.ObjectLiteralExpression)) return { kind: "object", label: "object", children: kids(node.getProperties()) };
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
	if (node.isKind(ts.SyntaxKind.ArrayLiteralExpression)) return { kind: "array", label: "array", children: kids(node.getElements()) };
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
	if (node.isKind(ts.SyntaxKind.ArrowFunction) || node.isKind(ts.SyntaxKind.FunctionExpression)) return { kind: "func", label: "<fn>", children: node.getBody() ? kids([node.getBody()]) : [] };
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
	if (node.isKind(ts.SyntaxKind.VariableStatement)) return { kind: "var", label: "var", children: kids(node.getDeclarationList().getDeclarations()) };
	if (node.isKind(ts.SyntaxKind.VariableDeclaration)) return { kind: "var-decl", label: node.getName() || "?", children: node.getInitializer() ? kids([node.getInitializer()]) : [] };
	if (node.isKind(ts.SyntaxKind.AssignmentExpression)) return { kind: "assign", label: assignTarget(node.getLeft()), children: kids([node.getRight()]) };
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
	if (node.isKind(ts.SyntaxKind.Noop)) return null;
	return { kind: "expr", label: node.getKindName() || "expr", children: [] };
};

const opOf = (token) => {
	if (!token) return "?";
	if (typeof token === "string") return token;
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

const paramInfo = (p) => {
	const name = p.getName() || "?";
	const type = p.getType() ? sanitizeTypeText(p.getType().getText()) : "";
	return {
		name,
		type,
		hasDefault: !!p.getInitializer(),
		isRest: !!p.getDotDotDotToken(),
		isOptional: p.isOptional ? p.isOptional() : false,
	};
};

// 1-based column of a character position (ts-morph v24 exposes line numbers
// via getStartLineNumber/getEndLineNumber but not column).
const columnAt = (sourceFile, pos) => {
	const text = sourceFile.getFullText();
	let i = pos - 1;
	while (i >= 0 && text[i] !== "\n") i--;
	return pos - i;
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

	const line = node.getStartLineNumber();
	const endLine = node.getEndLineNumber();
	const column = columnAt(sourceFile, node.getStart());

	return {
		name,
		path: fileAbs,
		line,
		endLine,
		column,
		params,
		returnType,
		typeParams,
		flags: {
			async: !!isAsync,
			generator: !!isGenerator,
		},
		bodyTree,
		rawText: node.getBody() ? node.getBody().getText() : "",
	};
};

// ---------------------------------------------------------------------------
// Type-shape discovery — interfaces and object-literal type aliases.
//
// The same domain described twice (an interface in file A and a near-identical
// one in file B) is a duplicate just like a copied function body. These have
// no executable body, so their "body" is the member list itself: the tree is
// root(type) → prop(memberName) → lit(normalized member type), which flows
// through the exact same structure/AST/control-flow signals as function
// bodies. Alias-to-name (`type A = B`) and type-query aliases (`type T =
// SomeClass`) carry no shape of their own and are skipped — they are handled
// by entities-uniqueness.
// ---------------------------------------------------------------------------

const collectTypeNodes = (sourceFile) => {
	const out = [];
	const visit = (node) => {
		if (node.isKind(ts.SyntaxKind.InterfaceDeclaration) || node.isKind(ts.SyntaxKind.TypeAliasDeclaration)) {
			out.push(node);
		}
		node.forEachChild(visit);
	};
	visit(sourceFile);
	return out;
};

const typeTextOf = (typeNode) => {
	if (!typeNode) return "";
	return sanitizeTypeText(typeNode.getText()).replace(/\s+/g, " ").trim();
};

// One member of an interface / type literal as a plain-tree subtree:
// prop(memberName) → lit(normalized member type). Member names and types
// carry the shape; normalization keeps `prop`/`lit` labels (only ident /
// var-decl are positionally renamed), so two types with the same members
// score high on structure and AST.
const memberToTree = (member) => {
	const name = member.getName ? member.getName() : "?";
	let label = "";
	if (member.isKind(ts.SyntaxKind.PropertySignature)) {
		const typeNode = member.getTypeNode();
		label = typeTextOf(typeNode);
		if (member.getQuestionToken) label += member.getQuestionToken() ? "?" : "";
	} else if (member.isKind(ts.SyntaxKind.MethodSignature)) {
		const params = (member.getParameters() || []).map((p) => `${p.getName()}: ${typeTextOf(p.getTypeNode())}`).join(", ");
		const ret = member.getReturnType() ? `: ${typeTextOf(member.getReturnType())}` : "";
		label = `fn<${params}>${ret}`;
	} else if (member.isKind(ts.SyntaxKind.IndexSignature)) {
		label = "index";
	}
	return { kind: "prop", label: name || "?", children: label ? [{ kind: "lit", label, children: [] }] : [] };
};

// The members of an interface, including the members it inherits — a type
// that extends a base describes the base's members too, so a copy of the
// base must be comparable against the full shape.
const inheritedMembers = (node, acc = [], seen = new Set()) => {
	const heritage = node.getHeritageClauses ? node.getHeritageClauses() : [];
	for (const clause of heritage) {
		for (const typeNode of clause.getTypeNodes()) {
			// A heritage type is an ExpressionWithTypeArguments whose
			// expression is the base name (e.g. `extends Disposable`).
			const expr = typeNode.isKind(ts.SyntaxKind.ExpressionWithTypeArguments) ? typeNode.getExpression() : typeNode;
			const baseName = expr && expr.isKind(ts.SyntaxKind.Identifier) ? expr.getText() : null;
			if (!baseName || seen.has(baseName)) continue;
			seen.add(baseName);
			const target = node.getSourceFile().getDescendantsOfKind(ts.SyntaxKind.InterfaceDeclaration).find((i) => i.getName() === baseName);
			if (target) inheritedMembers(target, acc, seen);
		}
	}
	acc.push(...node.getMembers());
	return acc;
};

const buildTypeDescriptor = (node, sourceFile, fileAbs) => {
	const name = node.getName() || "?";

	let members = null;
	if (node.isKind(ts.SyntaxKind.InterfaceDeclaration)) {
		members = inheritedMembers(node);
	} else if (node.isKind(ts.SyntaxKind.TypeAliasDeclaration)) {
		const typeNode = node.getTypeNode();
		// Only object-literal aliases describe a shape. Aliases whose text
		// references a class (type T = SomeClass) or another named type carry
		// no own shape.
		if (typeNode && typeNode.isKind(ts.SyntaxKind.TypeLiteral) && !typeNode.getDescendantsOfKind(ts.SyntaxKind.TypeQuery).length) {
			members = typeNode.getMembers();
		}
	}
	if (!members || members.length === 0) return null;

	const children = members.map(memberToTree);
	const bodyTree = { kind: "type", label: name, children };
	// The member list as a compact, order-sensitive signature: two types with
	// the same members in the same order get an exact signature match.
	const returnType = `{${children.map((c) => `${c.label}:${(c.children[0] && c.children[0].label) || "?"}`).join(";")}}`;

	const line = node.getStartLineNumber();
	const endLine = node.getEndLineNumber();
	const column = columnAt(sourceFile, node.getStart());

	return {
		name,
		path: fileAbs,
		line,
		endLine,
		column,
		params: [],
		returnType,
		typeParams: (node.getTypeParameters ? (node.getTypeParameters() || []).map((tp) => (tp.getName ? tp.getName() : "")) : []),
		flags: {
			async: false,
			generator: false,
		},
		bodyTree,
		rawText: node.getText(),
	};
};

// Collects EVERY function in the file — exported, non-exported, nested,
// anonymous callbacks — plus every interface / object-literal type alias.
// Unnamed functions get synthetic names (see functionName) and are compared
// by structure, not by name.
const parseFunctions = (fileAbs) => {
	const sourceFile = sourceFileFor(fileAbs);

	const out = [];
	for (const node of collectFunctionNodes(sourceFile)) {
		if (isComponent(node, sourceFile)) continue;
		out.push(buildDescriptor(node, sourceFile, fileAbs));
	}
	for (const node of collectTypeNodes(sourceFile)) {
		const descriptor = buildTypeDescriptor(node, sourceFile, fileAbs);
		if (descriptor) out.push(descriptor);
	}
	return out;
};

// ---------------------------------------------------------------------------
// Partial duplicates: a contiguous block of statements inside a function body.
// Mirrors component-uniqueness `parseParts`.
// ---------------------------------------------------------------------------

const MIN_PART_STATEMENTS = 3;

const parseParts = (fileAbs, opts = {}) => {
	const sourceFile = sourceFileFor(fileAbs);
	const out = [];

	const visit = (node) => {
		if (node.isKind(ts.SyntaxKind.Block) && node.getStatements().length >= MIN_PART_STATEMENTS) {
			const owner = ownerFunctionName(node, sourceFile);
			const line = node.getStartLineNumber();
			const endLine = node.getEndLineNumber();
			const column = columnAt(sourceFile, node.getStart());
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

module.exports = {
	available: () => true,
	whenReady: async () => {},
	parseFunctions,
	parseParts,
	setLiveSource,
	functionName,
	toPlainTree,
};
