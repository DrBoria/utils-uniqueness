"use strict";

// ── AST MATCHER · the words ─────────────────────────────────────────────────

const PHRASES = Object.freeze({
	// `if:if L 63 ↔ R 58 · 62%` — no counts: a piece that corresponds exactly prints
	// only the piece, one that differs prints its share.
	block: "{form} L {left} ↔ R {right}{percent}",
	empty: "no shared block",
});

module.exports = { PHRASES };
