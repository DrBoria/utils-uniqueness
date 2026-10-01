"use strict";

/**
 * signature.js
 *
 * Utility-function signature machinery shared by the rule and the scanner.
 *
 * A Signature is the normalized, rename-insensitive description of one
 * function:
 *
 *   {
 *     name:   "inTimeOrder",
 *     params: ["Temporal.ZonedDateTime", "Temporal.ZonedDateTime"], // normalized param types
 *     returns: "boolean",                                          // normalized return type
 *     generic: "T0",                                               // normalized generic arity marker
 *   }
 *
 * Two functions are signature-duplicates when their normalized param-type
 * list AND return type are identical — i.e. one is a drop-in for the other.
 * Generic type parameters are renamed positionally (T, S, U -> T0, T1, T2)
 * so `f<T>(x: T): T` and `g<S>(y: S): S` match.
 *
 * The normalized body token stream is computed separately (extract.js) for
 * the body-similarity tier.
 */

const path = require("node:path");

let ts;
try {
	ts = require("typescript");
} catch {
	ts = null;
}

/**
 * Build a positional rename map for a function's type parameters.
 * `function f<T, S, U>(...)` -> { T: "T0", S: "T1", U: "T2" }.
 *
 * @param {ts.TypeParameterDeclaration[]} typeParams
 * @returns {Record<string, string>}
 */
function genericRenameMap(typeParams) {
	const map = {};
	(typeParams || []).forEach((tp, i) => {
		const name = tp.name ? tp.name.text : "";
		if (name) map[name] = `T${i}`;
	});
	return map;
}

/**
 * Normalize a type's source text: apply the generic rename map, collapse
 * whitespace, and strip redundant spaces around punctuation.
 *
 * @param {string} text raw type text
 * @param {Record<string, string>} rename generic rename map
 * @returns {string}
 */
function normalizeTypeText(text, rename) {
	let out = String(text || "");
	for (const [from, to] of Object.entries(rename)) {
		if (!from) continue;
		out = out.replace(new RegExp(`\\b${escapeRe(from)}\\b`, "g"), to);
	}
	return out
		.replace(/\s+/g, " ")
		.replace(/\s*([<>,()|&?:])\s*/g, "$1")
		.trim();
}

function escapeRe(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compute the normalized signature of a function declaration node.
 *
 * @param {ts.Node} node a FunctionDeclaration, ArrowFunction, or FunctionExpression
 * @param {ts.TypeChecker} checker the TS type checker
 * @param {ts.SourceFile} sourceFile the owning source file
 * @returns {{name:string, params:string[], returns:string, signatureKey:string}}
 */
function computeSignature(node, checker, sourceFile) {
	const name = functionName(node, sourceFile);

	let typeParams = [];
	if (node.typeParameters) typeParams = node.typeParameters;
	else if (node.parent && node.parent.kind === ts.SyntaxKind.FunctionDeclaration && node.parent.typeParameters) {
		typeParams = node.parent.typeParameters;
	}
	const rename = genericRenameMap(typeParams);

	const params = (node.parameters || []).map((p) => {
		if (p.type) {
			return normalizeTypeText(p.type.getText(sourceFile), rename);
		}
		// No annotation: infer from the checker when available.
		if (checker) {
			try {
				const t = checker.getTypeAtLocation(p.name);
				return normalizeTypeText(checker.typeToString(t, undefined, ts.TypeFormatFlags.NoTruncation), rename);
			} catch {
				return "?";
			}
		}
		return "?";
	});

	let returns = "?";
	if (checker) {
		try {
			const sig = checker.getSignatureFromDeclaration(node);
			if (sig) {
				const rt = checker.getTypeOfSignatureReturnType(sig);
				returns = normalizeTypeText(checker.typeToString(rt, undefined, ts.TypeFormatFlags.NoTruncation), rename);
			}
		} catch {
			// fall through to annotation
		}
	}
	if (returns === "?" && node.type) {
		returns = normalizeTypeText(node.type.getText(sourceFile), rename);
	}

	const signatureKey = `${params.join("|")}::${returns}`;
	return { name, params, returns, signatureKey };
}

/**
 * Resolve a function's display name. Arrow functions assigned to a binding
 * use the binding name; function declarations use their id; anonymous
 * functions get a positional placeholder.
 *
 * @param {ts.Node} node the function node
 * @param {ts.SourceFile} sourceFile
 * @returns {string}
 */
function functionName(node, sourceFile) {
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
}

/**
 * Tokenize a function body into a normalized stream for similarity.
 * Identifiers are dropped (they rename freely); keywords, literals, and
 * punctuation are kept. String/template literal contents are blanked.
 *
 * @param {string} bodyText raw body source text
 * @returns {string[]} sorted token multiset (as a joined string)
 */
function bodyTokens(bodyText) {
	const text = String(bodyText || "")
		.replace(/`(?:[^`\\]|\\.)*`/g, " `TPL` ")
		.replace(/"(?:[^"\\]|\\.)*"/g, " STR ")
		.replace(/'(?:[^'\\]|\\.)*'/g, " STR ")
		.replace(/\/\/[^\n]*/g, " ")
		.replace(/\/\*[\s\S]*?\*\//g, " ");
	const tokens = text.split(/[^A-Za-z0-9_$]+/).filter(Boolean);
	const kept = tokens.filter((t) => !/^[a-z_$]/.test(t) || isKeyword(t));
	return kept.sort();
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

function isKeyword(t) {
	return KEYWORDS.has(t);
}

/**
 * Tokenize a code fragment keeping EVERY token (identifiers included).
 * Used to measure how "distinctive" a fragment is: a real duplicated helper
 * (a mapper, an error handler) is full of identifiers, property names and
 * literals, whereas boilerplate like `if (x) return true; else return false;`
 * is almost entirely keywords and punctuation. Template literals are split
 * into their content words (prefixed `t`) so the SQL/labels inside them
 * count as content; plain strings collapse to a single `STR` marker.
 *
 * @param {string} text raw source text
 * @returns {string[]} token list (identifiers, keywords, numbers, punctuation, t-words)
 */
function rawTokens(text) {
	const out = [];
	for (const m of String(text || "").matchAll(/`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_$][A-Za-z0-9_$]*|0x[0-9a-fA-F]+|\d+(?:\.\d+)?|[^\sA-Za-z0-9_$]/g)) {
		const t = m[0];
		if (t.startsWith("`")) {
			for (const w of t.slice(1, -1).matchAll(/[A-Za-z_$][A-Za-z0-9_$]*|\d+(?:\.\d+)?/g)) out.push(`t${w[0]}`);
		} else if (t.startsWith('"') || t.startsWith("'")) {
			out.push("STR");
		} else if (t.startsWith("//") || t.startsWith("/*")) {
			// comments carry no content signal
		} else {
			out.push(t);
		}
	}
	return out;
}

/**
 * Fraction of a fragment's tokens that are "distinctive": identifiers
 * (lowercase-starting, not a keyword), numbers, string markers, and the
 * words inside template literals (SQL, messages, labels — literal content).
 * High value = content-specific; low value = structural boilerplate.
 *
 * @param {string} text raw source text
 * @returns {number} 0..1
 */
function distinctiveRatio(text) {
	const toks = rawTokens(text);
	if (toks.length === 0) return 0;
	let distinctive = 0;
	for (const t of toks) {
		if (/^[0-9]/.test(t)) {
			distinctive += 1;
		} else if (/^STR$/.test(t)) {
			distinctive += 1;
		} else if (/^t[A-Za-z0-9_$]/.test(t)) {
			distinctive += 1;
		} else if (/^[a-z_$]/.test(t) && !isKeyword(t)) {
			distinctive += 1;
		}
	}
	return distinctive / toks.length;
}

/**
 * Jaccard similarity over two sorted token arrays (multiset intersection /
 * union). Both arrays must already be sorted.
 *
 * @param {string[]} a sorted tokens
 * @param {string[]} b sorted tokens
 * @returns {number} 0..1
 */
function jaccard(a, b) {
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
}

module.exports = { computeSignature, functionName, bodyTokens, jaccard, normalizeTypeText, distinctiveRatio };
