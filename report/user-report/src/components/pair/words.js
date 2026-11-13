"use strict";

// ── WHAT GETS PAINTED INSIDE A LINE ────────────────────────────────────────
//
// A fragment is not "the same characters on both sides" — `export async function`
// is the same in every TypeScript file and painting it said nothing about the
// pair, while `level?: string` was left bare because the line-level diff had
// called that row identical and produced no fragments at all.
//
// The rule here is the reader's rule: paint the token the DECISION MAKER says
// declares a name. Nothing in this file decides what a keyword is — the word
// list lives in the engine (`constants.js → KEYWORDS`), and the decision maker
// already used it when it produced the name sites. A view that kept its own list
// could disagree with the verdict it is drawing.

// Words, string literals, whitespace runs and punctuation runs — joining them
// gives the line back. A string literal is ONE token: `"text"` is a value, and
// cutting it into `"`, `text`, `"` made the word `text` look like a name and get
// highlighted as one.
export const TOKEN_RE = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|\s+|[^A-Za-z_$\s]+/g;

// A word the matched-name model says is part of the name. `common` holds the
// lower-cased words both names share IN ORDER, which is exactly what may be
// painted: in `handleGetConsole` / `handleSearchConsole`, `handle` and `Console`
// are the duplicate, `Get` / `Search` is the difference.
export const nameSegments = (word, common) => {
	const parts = String(word).match(/[A-Z]+(?![a-z])|[A-Z][a-z0-9]*|[a-z0-9]+/g) ?? [word];

	return parts.map((text) => ({ text, paint: common.includes(text.toLowerCase()) }));
};

// The tokens of one side of a row, whatever the diff engine kept.
export const wordsOf = (side) => {
	if (!side) return null;
	if (side.words) return side.words;
	if (side.text == null) return null;

	return (String(side.text).match(TOKEN_RE) ?? []).map((text) => ({ text, changed: false }));
};
