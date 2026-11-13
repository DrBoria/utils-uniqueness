"use strict";

// ── ONE WORD, THE RIGHT NUMBER ─────────────────────────────────────────────
//
// A caption says WHAT a lane is about, and the number it says it about is known:
// one row is one `parameter`, one pair of function names is one `function name`.
// Printing `parameters` over a single row claims a crowd that is not there — and
// `function names` over one name reads as a bug, because it is one.
//
// The vocabulary is small and regular (`parameter`, `variable declaration`,
// `property assignment`, `function name`, `return`), so the singular is derived
// from the phrase itself — no table of cases to keep in sync with the labels.

const IRREGULAR = Object.freeze({
	returns: "return",
	names: "name",
});

// `property assignments` → `property assignment`, `properties` → `property`.
const singularWord = (word) => {
	const known = IRREGULAR[word];
	if (known !== undefined) return known;
	if (/ies$/.test(word)) return `${word.slice(0, -3)}y`;
	if (/(ses|xes|ches|shes)$/.test(word)) return word.slice(0, -2);
	if (/ss$/.test(word)) return word;

	return /s$/.test(word) ? word.slice(0, -1) : word;
};

// The LAST word carries the number; the ones before it qualify it.
const singularOf = (phrase) => {
	const words = String(phrase).split(" ");
	if (words.length === 0) return String(phrase);
	words[words.length - 1] = singularWord(words[words.length - 1]);

	return words.join(" ");
};

/**
 * The phrase for a COUNT: `wordOf("parameters", 1)` → `parameter`,
 * `wordOf("function names", 2)` → `function names`.
 */
const wordOf = (phrase, count) => (count === 1 ? singularOf(phrase) : String(phrase));

module.exports = { wordOf, singularOf };
