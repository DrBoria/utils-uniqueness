"use strict";

// The words of an identifier AND where each one sits. One splitter for the whole
// family: `nameWords` (what the decision maker compares) and `wordSites` (what
// the report paints) both read these spans, so a painted word is by construction
// a word that was compared — the report cannot drift from the decision.
const pascalSpans = (s) => {
	const text = String(s || "");
	const out = [];
	let start = -1;
	const flush = (end) => {
		if (start < 0) return;
		out.push({ text: text.slice(start, end), start, end });
		start = -1;
	};
	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i];
		if (!/[A-Za-z0-9]/.test(ch)) {
			flush(i);
			continue;
		}
		if (start < 0) {
			start = i;
			continue;
		}
		// `fooBar` breaks before `B`; `HTTP` stays whole, exactly as before.
		if (/[a-z0-9]/.test(text[i - 1]) && /[A-Z]/.test(ch)) {
			flush(i);
			start = i;
		}
	}
	flush(text.length);
	return out;
};

const pascalWords = (s) => pascalSpans(s).map((span) => span.text);

// The same words, each with the COLUMN it starts at in the source line. The view
// paints these columns verbatim — it never searches the line for a substring.
const wordSites = (name, column) => pascalSpans(name).map((span) => ({ text: span.text, column: column + span.start, end: column + span.end }));

// ── NAME SIMILARITY ─────────────────────────────────────────────────────────
//
// A function name is a SEQUENCE of words, not a bag of them: `handleGetConsole`
// and `handleSearchConsole` share `handle` and `console` *in the same order*, so
// they are two thirds of one name. Comparing sets (the old `nameWordSim`) threw
// the order away and called it a half.
//
// The score is the Dice coefficient over the longest common SUBSEQUENCE of
// words, so order is both rewarded and required: `getConsole` and `consoleGet`
// share the words but not the order, and score 0 here.

const nameWords = (name) => pascalWords(name).map((word) => word.toLowerCase());

// The matched words, in order. Names are a handful of words, so the O(n·m)
// table is cheaper than any cleverer method and impossible to get wrong.
const lcsWords = (a, b) => {
	const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
	for (let i = 1; i <= a.length; i += 1) {
		for (let j = 1; j <= b.length; j += 1) {
			table[i][j] = a[i - 1] === b[j - 1] ? table[i - 1][j - 1] + 1 : Math.max(table[i - 1][j], table[i][j - 1]);
		}
	}

	const out = [];
	let i = a.length;
	let j = b.length;
	while (i > 0 && j > 0) {
		if (a[i - 1] === b[j - 1]) {
			out.push(a[i - 1]);
			i -= 1;
			j -= 1;
		} else if (table[i - 1][j] >= table[i][j - 1]) {
			i -= 1;
		} else {
			j -= 1;
		}
	}

	return out.reverse();
};

// `{ left, right, common, score, same }` — `left`/`right` are the word sequences,
// `common` the words that matched IN ORDER, `score` in [0, 1].
const nameSimilarity = (leftName, rightName) => {
	const left = nameWords(leftName);
	const right = nameWords(rightName);
	const common = lcsWords(left, right);
	const total = left.length + right.length;
	const same = String(leftName ?? "") === String(rightName ?? "");

	return {
		left,
		right,
		common,
		score: same ? 1 : total === 0 ? 0 : (2 * common.length) / total,
		same,
	};
};

// ── NAMES OF A WHOLE FUNCTION ───────────────────────────────────────────
//
// One multiset for the whole surface, built from the candidate's NAME SITES: the
// function's own name, its parameters, and every name its body declares
// (`normalize/tree.js → names`). Redefinitions count — a name declared twice
// contributes two.
//
// Shared by the matcher that scores it and by the report that prints it, so the
// sentence and the picture can never describe the same number differently.

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

const namesOf = (candidate) => {
	const bag = new Map();
	for (const site of candidate?.names ?? []) {
		// A name is an identifier. A destructuring pattern (`{ env, level }`) and a
		// synthetic owner name (`registerConsoleTools#anon@174`) are not, and adding
		// them put whole objects into the bag as if they were identifiers.
		if (!IDENTIFIER.test(site.name)) continue;
		bag.set(site.name, (bag.get(site.name) ?? 0) + 1);
	}

	return bag;
};

// Dice over multisets: shared names, counted as often as both sides have them.
const bagSimilarity = (a, b) => {
	let totalA = 0;
	let totalB = 0;
	for (const count of a.values()) totalA += count;
	for (const count of b.values()) totalB += count;
	if (totalA + totalB === 0) return 0;

	let shared = 0;
	for (const [name, count] of a) shared += Math.min(count, b.get(name) ?? 0);

	return (2 * shared) / (totalA + totalB);
};

const commonNames = (a, b) => [...a.keys()].filter((name) => b.has(name)).sort();

export {  pascalSpans, pascalWords, nameWords, wordSites, lcsWords, nameSimilarity, namesOf, bagSimilarity, commonNames  };
