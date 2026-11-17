"use strict";

import { PHRASES } from "./phrases";

// ── SIGNATURE MATCHER · the parts of a declaration ─────────────────────────
//
// The viewer must not invent names for a piece of code. "param · frontendBridge"
// was the view guessing: it found a parameter name inside a row and printed it,
// so the same name labelled lines that declare nothing. The names below are what
// a reader calls these things, and they are produced HERE so the page can only
// print them:
//
//   function name    the head row that carries the identifier
//   external params  the declared parameter list of the function
//   inside params    the fields of a parameter object (`params: { … }`)
//   return type      from the closing `)` to the opening `{` of the body
//
// The window is ONE range for both sides. Computing it per side folded 20 lines
// on the left and 11 on the right, so the two columns showed rows that had
// nothing to do with each other.

const open = (text) => (String(text ?? "").match(/\(/g) ?? []).length;
const close = (text) => (String(text ?? "").match(/\)/g) ?? []).length;

// The last row of the declaration: where the PAREN depth returns to zero and the
// body opens. `params: {` opens a brace long before that, so "the first line with
// a brace" is not the end of anything.
const endOf = (texts) => {
	let depth = 0;
	let seen = false;

	for (let index = 0; index < texts.length; index += 1) {
		const text = String(texts[index] ?? "");
		if (!seen) {
			if (!text.trim()) continue;
			seen = true;
		}
		depth += open(text) - close(text);
		if (depth <= 0 && /\{\s*$/.test(text.trim())) return index;
	}

	return texts.length - 1;
};

// Not every span is a declaration: a compared pair can be an arrow body, a
// block, or one expression. `{result} => {` has no parameter list, and calling
// its row a `return type` was noise.
const isDeclaration = (texts) => {
	const first = texts.find((text) => String(text ?? "").trim() !== "");

	return Boolean(first) && open(first) > 0;
};

// One label per row, in order.
//
// The brace that matters is the one INSIDE the parameter list. Tracking braces
// blindly made the body of `function f(a, b) {` look like a parameter object, so
// the whole function body was labelled `inside params`. Here a `{` only opens
// parameters while the paren depth is above zero; a `{` at paren depth zero is
// the body, and the declaration is over.
//
// The head is named by what it actually carries: a named function declaration
// has a `function name`, an arrow head like `async ({ env, level }) =>` has
// `parameters` and no name at all.
const labelsOf = (texts, end) => {
	const labels = [];
	let paren = 0;
	let object = 0;

	for (let index = 0; index <= end; index += 1) {
		const text = String(texts[index] ?? "");
		const before = object;

		for (const char of text) {
			if (char === "(") paren += 1;
			else if (char === ")") paren -= 1;
			else if (char === "{" && paren > 0) object += 1;
			else if (char === "}" && object > 0) object -= 1;
		}

		let label: any = PHRASES.partExternalParams;
		if (index === 0) label = /\bfunction\b/.test(text) ? PHRASES.partFunctionName : PHRASES.partParameters;
		else if (before > 0 && object > 0) label = PHRASES.partInsideParams;
		else if (before > 0 && object === 0) label = PHRASES.partExternalParams;
		else if (/^\s*\)/.test(text)) label = PHRASES.partReturnType;

		labels.push(label);
	}

	return labels;
};

// `{ kind, end, parts, labels }`.
//   kind   "declaration" | "code" — "code" means the signature tab has nothing
//          to say about this span: no folding, no ribbons, just the code.
//   end    the last row of the declaration, the SAME for both sides.
const declarationOf = ({ left, right }) => {
	if (!isDeclaration(left) && !isDeclaration(right)) {
		return { kind: "code", end: Math.max(left.length, right.length) - 1, parts: [], labels: [] };
	}

	// The window comes from the side that HAS a declaration. Taking the max of
	// both sides let an anonymous arrow's body (`… });` five rows down) stretch
	// the window over the function body, so a signature tab showed statements.
	const declared = isDeclaration(left) ? left : right;
	const end = Math.max(0, Math.min(endOf(declared), Math.max(left.length, right.length) - 1));
	const labels = labelsOf(declared, end);

	// A row present only on the other side still needs a label, so no row is ever
	// unlabelled and no ribbon is captionless.
	while (labels.length <= end) labels.push(labels[labels.length - 1] ?? "external params");

	const parts = [];
	for (const [index, label] of labels.entries()) {
		const last = parts[parts.length - 1];
		if (last && last.label === label) last.to = index;
		else parts.push({ index, label, from: index, to: index });
	}

	return { kind: "declaration", end, parts, labels };
};

export {  declarationOf, labelsOf, endOf, isDeclaration  };
