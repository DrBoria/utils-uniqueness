"use strict";

// ── STRUCTURE MATCHER · the words ───────────────────────────────────────────

const PHRASES = Object.freeze({
	// `0.71` — the score is the whole statement: full correspondence adds no number.
	summary: "{score}{percent}",
	// `call 0:12,16,21,27,30↔1:66,70,73,76,77,79,82` — the counts are gone: a piece
	// that corresponds exactly prints no number, one that differs prints its share.
	site: "{label} 0:{leftLines}↔1:{rightLines}",
	// `only: while (local 1), try (canonical 2)`
	onlyLeft: "only local: {list}",
	onlyRight: "only canonical: {list}",
	empty: "no constructs",
});

module.exports = { PHRASES };
