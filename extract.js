"use strict";

/**
 * extract.js
 *
 * Extracts candidate utility functions from a TypeScript source file using
 * the TypeScript compiler API. A "utility function" here is a top-level or
 * module-level function / arrow-function binding that is NOT a React
 * component (no JSX return, name not PascalCase-with-JSX) and NOT a test /
 * story callback.
 *
 * For each candidate we compute:
 *   - the normalized signature (signature.js)
 *   - the normalized body token stream (signature.js#bodyTokens)
 *   - source location (line/column) for reporting
 *
 * The result is a list of FunctionRecord objects the matcher and the rule
 * both consume.
 */

const fs = require("node:fs");
const path = require("node:path");

const { computeSignature, functionName, bodyTokens } = require("./signature");

let ts;
try {
	ts = require("typescript");
} catch {
	ts = null;
}

/**
 * Is this function node a React component (PascalCase name + JSX in body)?
 * Components are out of scope for this rule (RDU covers them).
 *
 * @param {ts.Node} node the function node
 * @param {ts.SourceFile} sourceFile
 * @returns {boolean}
 */
function isComponent(node, sourceFile) {
	const name = functionName(node, sourceFile);
	if (!/^[A-Z]/.test(name)) return false;
	const text = node.getText(sourceFile);
	return /<([A-Z][A-Za-z0-9]*)[\s/>]|<\/[A-Z]/.test(text);
}

/**
 * Is this function a test/story callback (describe/it/test/expect/beforeEach
 * / beforeEach / play / setup)?
 *
 * @param {ts.Node} node the function node
 * @returns {boolean}
 */
function isTestCallback(node) {
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
}

/**
 * Is this function exported (directly or via a re-export)? Only exported
 * functions are importable duplicates; private helpers are internal detail.
 *
 * @param {ts.Node} node the function node
 * @returns {boolean}
 */
function isExported(node) {
	let p = node;
	while (p) {
		if (p.kind === ts.SyntaxKind.ExportDeclaration || p.kind === ts.SyntaxKind.ExportAssignment) return true;
		if (p.kind === ts.SyntaxKind.ModuleDeclaration) return false;
		p = p.parent;
	}
	return false;
}

/**
 * Is this function a top-level module utility? A utility is a function whose
 * owning declaration sits directly under the source file:
 *   - a `function foo() {}` declaration, or
 *   - a `const foo = () => {}` / `const foo = function(){}` initializer.
 *
 * Arrow functions nested inside an object literal (`{ render: (r) => … }`),
 * a callback, or another function are NOT top-level utilities — they are
 * structural parts of a component/record, not standalone helpers. This is a
 * purely structural test (no name matching).
 *
 * @param {ts.Node} node the function node
 * @param {ts.SourceFile} sourceFile
 * @returns {boolean}
 */
function isTopLevelUtility(node, sourceFile) {
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
}

/**
 * Collect the top-level function candidates in a source file.
 *
 * @param {ts.SourceFile} sourceFile
 * @param {ts.TypeChecker} checker
 * @returns {Array} raw candidate nodes
 */
function collectFunctionNodes(sourceFile, checker) {
	const out = [];
	const visit = (node) => {
		const isFn =
			node.kind === ts.SyntaxKind.FunctionDeclaration ||
			node.kind === ts.SyntaxKind.ArrowFunction ||
			node.kind === ts.SyntaxKind.FunctionExpression;
		if (isFn) {
			if (isTopLevelUtility(node, sourceFile)) out.push(node);
			return; // do not descend into nested functions for top-level scan
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return out;
}

/**
 * Extract utility-function records from a single file.
 *
 * @param {string} filePath absolute path
 * @param {object} [opts]
 * @param {boolean} [opts.requireExported] only exported functions
 * @returns {Array<object>} FunctionRecord[]
 */
function extractFromFile(filePath, opts = {}, shared = {}) {
	if (!ts) return [];
	const checker = shared.checker || null;
	let sourceFile = shared.sourceFile || null;
	if (!sourceFile) {
		const text = fs.readFileSync(filePath, "utf8");
		sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
	}

	const requireExported = opts.requireExported === true;
	const records = [];

	for (const node of collectFunctionNodes(sourceFile, checker)) {
		const name = functionName(node, sourceFile);
		if (name === "<anonymous>") continue;
		if (isComponent(node, sourceFile)) continue;
		if (isTestCallback(node)) continue;
		if (requireExported && !isExported(node)) continue;

		const sig = computeSignature(node, checker, sourceFile);
		const bodyText = node.body ? node.body.getText(sourceFile) : "";
		const tokens = bodyTokens(bodyText);

		const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
		const endPos = node.getEnd ? node.getEnd() : node.getStart() + node.getText(sourceFile).length;
		const endLine = sourceFile.getLineAndCharacterOfPosition(endPos).line + 1;

		records.push({
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
		});
	}

	return records;
}

/**
 * Extract from many files at once.
 *
 * @param {string[]} filePaths absolute paths
 * @param {object} [opts]
 * @returns {Array<object>}
 */
function extractFromFiles(filePaths, opts = {}) {
	const out = [];
	if (!ts || filePaths.length === 0) return out;

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

	for (const f of filePaths) {
		try {
			out.push(...extractFromFile(f, opts, { checker, sourceFile: sourceFiles.get(norm(f)) || null }));
		} catch {
			// unreadable / unparseable file — skip
		}
	}
	return out;
}

module.exports = { extractFromFile, extractFromFiles, isComponent, isExported, isTestCallback };
