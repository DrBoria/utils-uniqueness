"use strict";

import { MARK, ROW, SIGNAL, SIGNAL_ORDER, CODE_KEYWORDS, CODE_BRANCH_WORDS } from "../../../constants";

// WHY A ROW IS "SIMILAR" — the four groups, marked ON THE CODE.
//
// A pair of different functions can still be similar, and the reader who sees
// two different names is right to ask "what exactly is the same here?". The
// answer is not four numbers in a separate panel; it is a mark per comparison
// group on the very lines those groups looked at:
//
//   signature   the declaration: parameter list and return type
//   structure   which constructs appear (`if`, `call`, `return`, `?.`...)
//   ast         the expression itself, with every name replaced by `$`
//   controlFlow branch and exit keywords, in order
//
// A group's mark is `same` when THAT group cannot tell the two rows apart, and
// `differs` when it can. That is what makes a 0.66 understandable: three groups
// painted green on the same rows and one red is literally "same shape, other
// operation".
//
// The marks are a READER'S AID computed from the two texts, not the matcher: the
// matcher works on normalized trees. They are labelled as such in the UI and the
// authoritative numbers always come from `decision`.

const SIGNAL_KEYS = SIGNAL_ORDER;

// Comments and string bodies are not expression structure: a changed message is
// not a changed operation, so they are blanked before any comparison.
const strip = (text) =>
	String(text ?? "")
		.replace(/`(?:\\.|[^`\\])*`/g, '""')
		.replace(/"(?:\\.|[^"\\])*"/g, '""')
		.replace(/'(?:\\.|[^'\\])*'/g, '""')
		.replace(/\/\/.*$/, "")
		.replace(/\/\*.*?\*\//g, "");

const words = (text) => strip(text).match(/[A-Za-z_$][\w$]*/g) ?? [];

// Every name becomes `$`: this is the "same expression, renamed" test the AST
// group performs on the tree.
const generalize = (text) => strip(text).replace(/[A-Za-z_$][\w$]*/g, (word) => (CODE_KEYWORDS.has(word) ? word : "$"));

const constructs = (text) => {
	const set = new Set();
	const stripped = strip(text);
	for (const word of words(stripped)) if (CODE_KEYWORDS.has(word)) set.add(word);
	for (const match of stripped.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) set.add(`call:${CODE_KEYWORDS.has(match[1]) ? match[1] : "$"}`);
	for (const match of stripped.matchAll(/(\?\.|=>|===|!==|==|!=|<=|>=|\+\+|--|\+=|-=|\?\?|\|\||&&|\?)/g)) set.add(match[1]);

	return set;
};

const branches = (text) => words(strip(text)).filter((word) => CODE_BRANCH_WORDS.has(word));

const sameSet = (a, b) => a.size === b.size && [...a].every((item) => b.has(item));

// The declaration part of a line: the parameter list plus whatever sits between
// `)` and `{` (the return type). `null` when the line is not a declaration head.
const signatureOf = (text) => {
	const stripped = strip(text);
	const open = stripped.indexOf("(");
	if (open === -1) return null;
	let depth = 0;
	for (let i = open; i < stripped.length; i += 1) {
		if (stripped[i] === "(") depth += 1;
		if (stripped[i] === ")") {
			depth -= 1;
			if (depth === 0) {
				const body = stripped.indexOf("{", i);
				const tail = body === -1 ? stripped.slice(i + 1) : stripped.slice(i + 1, body);

				return `${stripped.slice(open, i + 1)}${tail}`.replace(/\s+/g, " ").trim();
			}
		}
	}

	return null;
};

const textOf = (side) => (side?.words ? side.words.map((w) => w.text).join("") : side?.text ?? "");

const mark = (state) => (state ? state : null);

// One row → `{ signature, structure, ast, controlFlow }`, each `"same"`,
// `"differs"` or absent. Absent means "this group says nothing about this row"
// (a blank line, a comment, a row with no branch on either side).
//
// An EQUAL row is the strongest statement a group can make: the two lines are
// character-for-character identical, so every group agrees on it. Returning
// `null` here ("nothing to say") was a lie the reader kept catching: a 1.00 pair
// showed eleven identical rows and not one green mark.
const markRow = (row, index) => {
	if (row.type === ROW.Equal) {
		return {
			[SIGNAL.Signature]: MARK.Same,
			[SIGNAL.Structure]: MARK.Same,
			[SIGNAL.Ast]: MARK.Same,
			[SIGNAL.ControlFlow]: MARK.Same,
		};
	}

	const left = textOf(row.left);
	const right = textOf(row.right);
	const both = Boolean(row.left && row.right);

	const marks = {};
	if (index === 0) {
		const a = signatureOf(left);
		const b = signatureOf(right);
		if (a != null || b != null) marks[SIGNAL.Signature] = a === b ? MARK.Same : MARK.Differs;
	}

	const leftConstructs = constructs(left);
	const rightConstructs = constructs(right);
	if (leftConstructs.size > 0 || rightConstructs.size > 0) marks[SIGNAL.Structure] = sameSet(leftConstructs, rightConstructs) ? MARK.Same : MARK.Differs;

	const leftAst = generalize(left).replace(/\s+/g, " ").trim();
	const rightAst = generalize(right).replace(/\s+/g, " ").trim();
	if (leftAst || rightAst) marks[SIGNAL.Ast] = leftAst === rightAst ? MARK.Same : MARK.Differs;

	const leftFlow = branches(left);
	const rightFlow = branches(right);
	if (leftFlow.length > 0 || rightFlow.length > 0) marks[SIGNAL.ControlFlow] = leftFlow.join(",") === rightFlow.join(",") ? MARK.Same : MARK.Differs;

	void both;

	return Object.keys(marks).length > 0 ? marks : null;
};

// ── The MIDDLE pane: what the row says in COMMON, and where it diverges ─────
//
// A reader should not compare two columns in their head. This builds one line
// out of the two: the words both sides share stay as text, and every run that
// differs becomes a numbered slot ⟨n⟩. The same n sits on the red run on the
// left and on the green run on the right, so "what matches what" is a glance.
//
// `slots[n] = { left, right }` is kept so the tooltip (and the middle pane, when
// the fragments are short) can say `name → resolvePath` instead of a bare number.
const runsOf = (words) => {
	const runs = [];
	for (const word of words ?? []) {
		const last = runs[runs.length - 1];
		if (last && last.changed === word.changed) last.text += word.text;
		else runs.push({ changed: word.changed, text: word.text });
	}

	return runs;
};

const overlapOf = (row) => {
	// An identical row needs no text in the middle: the two panes already say
	// the same thing, and repeating it three times is noise. The green ≡ and the
	// green tint carry the whole message.
	if (row.type === ROW.Equal) return { head: "≡", parts: [] };
	// A one-sided row: the whole piece exists on one side only, so the middle
	// states that and nothing else.
	if (row.type === ROW.Remove) return { head: "−", parts: [{ text: "only in the local util" }], oneSide: "left" };
	if (row.type === ROW.Add) return { head: "+", parts: [{ text: "only in the canonical util" }], oneSide: "right" };

	const leftRuns = runsOf(row.left?.words);
	const rightRuns = runsOf(row.right?.words).filter((run) => run.changed);
	const parts = [];
	const slots = {};
	let n = 0;
	for (const run of leftRuns) {
		if (!run.changed) {
			const last = parts[parts.length - 1];
			if (last && last.slot == null) last.text += run.text;
			else parts.push({ text: run.text });
			continue;
		}
		n += 1;
		const right = rightRuns[n - 1]?.text ?? "";
		slots[n] = { left: run.text, right };
		parts.push({ slot: n, text: run.text, right });
	}

	return { head: "≠", parts, slots };
};

// ── What each MATCHER can point at IN THIS ROW ──────────────────────────────
//
// The graphics live where the code is: when a comparison group is selected, its
// annotation is printed under the row it talks about. That needs the row's own
// raw material per group — the constructs it contains, the flow steps it takes,
// and its normalized (names-away) form for the AST — so the browser only has to
// colour what it is given.
//
// Shipped for every row, not just changed ones: an identical row is where a
// group says "duplicate", and that is exactly what the reader must see.
const annotOf = (row) => {
	const leftText = textOf(row.left);
	const rightText = textOf(row.right);

	return {
		structure: { left: [...constructs(leftText)], right: [...constructs(rightText)] },
		flow: { left: branches(leftText), right: branches(rightText) },
		ast: { left: generalize(leftText).replace(/\s+/g, " ").trim(), right: generalize(rightText).replace(/\s+/g, " ").trim() },
		// The declaration head: parameter list and return type. `null` on a row
		// that is not a declaration, so the Signature view shows nothing there.
		signature: { left: signatureOf(leftText), right: signatureOf(rightText) },
	};
};

// Annotate a whole hunk list (folds are walked through) and count the marks, so
// the header can say "AST agrees on 2 of 11 compared rows" — a number tied to
// places instead of a bare 0.12.
// ── Is this LINE duplicated? ────────────────────────────────────────────────
//
// Not "did the LCS pair it with the same row on the other side" — that breaks
// whenever the alignment shifts by one line, and then a line that plainly exists
// in both files (say `limit?: number;`) came out as "unique". The question a
// reader asks is simpler: does this exact line appear in the other file?
//
// So both sides' trimmed lines are collected once, and each row is labelled with
// whether its text exists on the opposite side.
const lineSet = (list, side) => {
	const set = new Set();
	for (const row of list) {
		if (row.type === ROW.Fold || !row[side]) continue;
		const text = textOf(row[side]).trim();
		if (text) set.add(text);
	}

	return set;
};

const annotate = (rows) => {
	let index = 0;
	const counts = Object.fromEntries(SIGNAL_KEYS.map((key) => [key, { same: 0, differs: 0 }]));

	// Two sets, one per FILE: every line the left file shows, every line the
	// right file shows. A row is duplicated when its own text is in the other set.
	const leftLines = lineSet(rows, "left");
	const rightLines = lineSet(rows, "right");
	const sameOnOtherSide = (row) => {
		const leftText = row.left ? textOf(row.left).trim() : "";
		const rightText = row.right ? textOf(row.right).trim() : "";

		return {
			// A line is duplicated when the SAME text sits in the other side's set.
			dupLeft: Boolean(leftText) && rightLines.has(leftText),
			dupRight: Boolean(rightText) && leftLines.has(rightText),
		};
	};

	const walk = (list) =>
		list.map((row) => {
			if (row.type === ROW.Fold) return { ...row, rows: walk(row.rows) };
			const marks = markRow(row, index);
			index += 1;
			const overlap = overlapOf(row);
			const annot = annotOf(row);
			const dup = sameOnOtherSide(row);
			if (!marks) return { ...row, overlap, annot, ...dup };
			for (const [key, value] of Object.entries(marks)) counts[key][value as any] += 1;

			return { ...row, marks, overlap, annot, ...dup };
		});

	const annotated = walk(rows);

	return { rows: annotated, counts };
};

export {  annotate, markRow, signatureOf, constructs, generalize, branches, SIGNAL_KEYS  };
