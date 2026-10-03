"use strict";

const path = require("node:path");
const { pipe, map, filter, sort, reduce } = require("remeda");

let ts;
try {
	ts = require("typescript");
} catch {
	ts = null;
}

const KEYWORDS = new Set([
	"return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue",
	"throw", "try", "catch", "finally", "new", "typeof", "instanceof", "in", "of", "void",
	"delete", "yield", "await", "async", "function", "class", "extends", "super", "this",
	"true", "false", "null", "undefined", "const", "let", "var", "import", "export", "default",
	"from", "as", "static", "get", "set", "map", "filter", "reduce", "find", "some", "every",
	"push", "pop", "shift", "unshift", "splice", "slice", "concat", "join", "split", "replace",
	"match", "test", "exec", "trim", "toLowerCase", "toUpperCase", "includes", "startsWith",
	"endsWith", "indexOf", "lastIndexOf", "padStart", "padEnd", "repeat", "charAt", "charCodeAt",
	"length", "keys", "values", "entries", "has", "get", "set", "add", "delete", "clear",
	"Promise", "resolve", "reject", "then", "catch", "finally", "Array", "Object", "String",
	"Number", "Boolean", "Math", "JSON", "Date", "Set", "Map", "RegExp", "Error", "console",
	"log", "warn", "error", "info", "fetch", "then", "forEach", "flatMap", "flat", "sort",
	"reverse", "fill", "copyWithin", "assign", "create", "freeze", "entries", "from", "is",
]);

const isKeyword = (t) => KEYWORDS.has(t);

const genericRenameMap = (typeParams) =>
	pipe(
		typeParams || [],
		map((tp, i) => {
			const name = tp.name ? tp.name.text : "";
			return name ? [name, `T${i}`] : null;
		}),
		filter(Boolean),
		reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
	);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeTypeText = (text, rename) =>
	pipe(
		String(text || ""),
		(s) => Object.entries(rename).reduce((out, [from, to]) => (from ? out.replace(new RegExp(`\\b${escapeRe(from)}\\b`, "g"), to) : out), s),
		(s) => s.replace(/\s+/g, " ").replace(/\s*([<>,()|&?:])\s*/g, "$1").trim(),
	);

const functionName = (node, sourceFile) => {
	if (node.name && node.name.text) return node.name.text;
	const parent = node.parent;
	if (parent) {
		if (parent.kind === ts.SyntaxKind.VariableDeclaration && parent.name && parent.name.getText) {
			return parent.name.getText(sourceFile);
		}
		if (parent.kind === ts.SyntaxKind.PropertyAssignment && parent.name && parent.name.getText) {
			return parent.name.getText(sourceFile);
		}
	}
	return "<anonymous>";
};

const computeSignature = (node, checker, sourceFile) => {
	const name = functionName(node, sourceFile);

	let typeParams = [];
	if (node.typeParameters) typeParams = node.typeParameters;
	else if (node.parent && node.parent.kind === ts.SyntaxKind.FunctionDeclaration && node.parent.typeParameters) {
		typeParams = node.parent.typeParameters;
	}
	const rename = genericRenameMap(typeParams);

	const params = pipe(
		node.parameters || [],
		map((p) => {
			if (p.type) {
				return normalizeTypeText(p.type.getText(sourceFile), rename);
			}
			if (checker) {
				try {
					const t = checker.getTypeAtLocation(p.name);
					return normalizeTypeText(checker.typeToString(t, undefined, ts.TypeFormatFlags.NoTruncation), rename);
				} catch {
					return "?";
				}
			}
			return "?";
		}),
	);

	let returns = "?";
	if (checker) {
		try {
			const sig = checker.getSignatureFromDeclaration(node);
			if (sig) {
				const rt = checker.getTypeOfSignatureReturnType(sig);
				returns = normalizeTypeText(checker.typeToString(rt, undefined, ts.TypeFormatFlags.NoTruncation), rename);
			}
		} catch {
		}
	}
	if (returns === "?" && node.type) {
		returns = normalizeTypeText(node.type.getText(sourceFile), rename);
	}

	const signatureKey = `${params.join("|")}::${returns}`;
	return { name, params, returns, signatureKey };
};

const bodyTokens = (bodyText) =>
	pipe(
		String(bodyText || ""),
		(s) => s.replace(/`(?:[^`\\]|\\.)*`/g, " `TPL` ").replace(/"(?:[^"\\]|\\.)*"/g, " STR ").replace(/'(?:[^'\\]|\\.)*'/g, " STR ").replace(/\/\/[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " "),
		(s) => s.split(/[^A-Za-z0-9_$]+/).filter(Boolean),
		filter((t) => !/^[a-z_$]/.test(t) || isKeyword(t)),
		sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
	);

const rawTokens = (text) => {
	const out = [];
	for (const m of String(text || "").matchAll(/`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_$][A-Za-z0-9_$]*|0x[0-9a-fA-F]+|\d+(?:\.\d+)?|[^\sA-Za-z0-9_$]/g)) {
		const t = m[0];
		if (t.startsWith("`")) {
			for (const w of t.slice(1, -1).matchAll(/[A-Za-z_$][A-Za-z0-9_$]*|\d+(?:\.\d+)?/g)) out.push(`t${w[0]}`);
		} else if (t.startsWith('"') || t.startsWith("'")) {
			out.push("STR");
		} else if (!t.startsWith("//") && !t.startsWith("/*")) {
			out.push(t);
		}
	}
	return out;
};

const distinctiveRatio = (text) => {
	const toks = rawTokens(text);
	if (toks.length === 0) return 0;
	const distinctive = pipe(
		toks,
		filter((t) => /^[0-9]/.test(t) || /^STR$/.test(t) || /^t[A-Za-z0-9_$]/.test(t) || (/^[a-z_$]/.test(t) && !isKeyword(t))),
		(x) => x.length,
	);
	return distinctive / toks.length;
};

const jaccard = (a, b) => {
	if (!a.length && !b.length) return 1;
	if (!a.length || !b.length) return 0;
	let i = 0;
	let j = 0;
	let inter = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			inter += 1;
			i += 1;
			j += 1;
		} else if (a[i] < b[j]) {
			i += 1;
		} else {
			j += 1;
		}
	}
	const union = a.length + b.length - inter;
	return union === 0 ? 0 : inter / union;
};

module.exports = { computeSignature, functionName, bodyTokens, jaccard, normalizeTypeText, distinctiveRatio };
