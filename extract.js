"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { computeSignature, functionName, bodyTokens } = require("./signature");
const { map } = require("remeda");

let ts;
try {
	ts = require("typescript");
} catch {
	ts = null;
}

const isComponent = (node, sourceFile) => {
	const name = functionName(node, sourceFile);
	if (!/^[A-Z]/.test(name)) return false;
	const text = node.getText(sourceFile);
	return /<([A-Z][A-Za-z0-9]*)[\s/>]|<\/[A-Z]/.test(text);
};

const isTestCallback = (node) => {
	let p = node.parent;
	let hops = 0;
	while (p && hops < 4) {
		if (p.kind === ts.SyntaxKind.CallExpression && p.expression) {
			const callee = p.expression.getText();
			if (/^(describe|it|test|expect|beforeEach|afterEach|beforeAll|afterAll|play|setup|suite|assert)\b/.test(callee)) {
				return true;
			}
		}
		p = p.parent;
		hops += 1;
	}
	return false;
};

const isExported = (node) => {
	let p = node;
	while (p) {
		if (p.kind === ts.SyntaxKind.ExportDeclaration || p.kind === ts.SyntaxKind.ExportAssignment) return true;
		if (p.kind === ts.SyntaxKind.ModuleDeclaration) return false;
		p = p.parent;
	}
	return false;
};

const isTopLevelUtility = (node, sourceFile) => {
	let statement;
	if (node.kind === ts.SyntaxKind.FunctionDeclaration) {
		statement = node;
	} else if (
		(node.kind === ts.SyntaxKind.ArrowFunction || node.kind === ts.SyntaxKind.FunctionExpression) &&
		node.parent &&
		node.parent.kind === ts.SyntaxKind.VariableDeclaration
	) {
		const list = node.parent.parent;
		if (!list || list.kind !== ts.SyntaxKind.VariableDeclarationList) return false;
		statement = list.parent;
	} else {
		return false;
	}
	if (!statement) return false;
	let owner = statement.parent;
	if (owner && owner.kind === ts.SyntaxKind.ExportDeclaration) owner = owner.parent;
	return owner === sourceFile;
};

const collectFunctionNodes = (sourceFile, checker) => {
	const out = [];
	const visit = (node) => {
		const isFn =
			node.kind === ts.SyntaxKind.FunctionDeclaration ||
			node.kind === ts.SyntaxKind.ArrowFunction ||
			node.kind === ts.SyntaxKind.FunctionExpression;
		if (isFn) {
			if (isTopLevelUtility(node, sourceFile)) out.push(node);
			return;
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return out;
};

const extractFromFile = (filePath, opts = {}, shared = {}) => {
	if (!ts) return [];
	const checker = shared.checker || null;
	let sourceFile = shared.sourceFile || null;
	if (!sourceFile) {
		const text = fs.readFileSync(filePath, "utf8");
		sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
	}

	const requireExported = opts.requireExported === true;

	return map(collectFunctionNodes(sourceFile, checker), (node) => {
		const name = functionName(node, sourceFile);
		if (name === "<anonymous>") return null;
		if (isComponent(node, sourceFile)) return null;
		if (isTestCallback(node)) return null;
		if (requireExported && !isExported(node)) return null;

		const sig = computeSignature(node, checker, sourceFile);
		const bodyText = node.body ? node.body.getText(sourceFile) : "";
		const tokens = bodyTokens(bodyText);

		const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
		const endPos = node.getEnd ? node.getEnd() : node.getStart() + node.getText(sourceFile).length;
		const endLine = sourceFile.getLineAndCharacterOfPosition(endPos).line + 1;

		return {
			name,
			path: filePath,
			line: line + 1,
			endLine,
			column: character + 1,
			params: sig.params,
			returns: sig.returns,
			signatureKey: sig.signatureKey,
			bodyTokens: tokens,
			bodyTokenCount: tokens.length,
			exported: isExported(node),
		};
	}).filter(Boolean);
};

const extractFromFiles = (filePaths, opts = {}) => {
	if (!ts || filePaths.length === 0) return [];

	const norm = (p) => p.replace(/\\/g, "/").toLowerCase();
	let checker = null;
	const sourceFiles = new Map();
	try {
		const host = ts.createCompilerHost({ noEmit: true, skipLibCheck: true });
		const program = ts.createProgram(filePaths, { noEmit: true, skipLibCheck: true }, host);
		checker = program.getTypeChecker();
		for (const sf of program.getSourceFiles()) {
			if (sf.isDeclarationFile) continue;
			sourceFiles.set(norm(sf.fileName), sf);
		}
	} catch {
		checker = null;
	}

	const out = [];
	for (const f of filePaths) {
		try {
			out.push(...extractFromFile(f, opts, { checker, sourceFile: sourceFiles.get(norm(f)) || null }));
		} catch {
		}
	}
	return out;
};

module.exports = { extractFromFile, extractFromFiles, isComponent, isExported, isTestCallback };
