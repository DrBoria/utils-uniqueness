"use strict";

// ── SIGNATURE MATCHER · the words ───────────────────────────────────────────
//
// Used by the markdown/CLI report. The format is a LEDGER, not a paragraph:
// every line names a fact, its number, and the lines it is about. Prose that
// restates the number ("2 of 3 match") is gone — the count IS the line.

const PHRASES = Object.freeze({
	// `params  #2 string≠number  #3 requestId only on the local side` — no counts:
	// full correspondence prints only the word, a partial one adds its share.
	params: "params{percent}",
	roleNote: "#{index} {left}≠{right}",
	onlyNote: "#{index} {name} only on the {side} side",
	// `types · 67%` + `#1 string≠number` — the parameter TYPE, position by position.
	types: "types{percent}",
	typeNote: "#{index} {left}≠{right}",
	// `name words create,Adapter` — what the two FUNCTION names share.
	nameWords: "name words{percent} {common}",
	// `name sites` — a header only: the share of WHOLE names is not part of the score
	names: "name sites",
	// `prop 0:17,22,23,24,28,29,30↔1:73,77,80,81,82`
	site: "{kind} 0:{left}↔1:{right}",
	// `return boolean:?≠generic:object`
	returns: "return {leftType}{arrow}{rightType}",

	// The parts of a declaration, as the signature view labels them.
	partFunctionName: "function name",
	partParameters: "parameters",
	partExternalParams: "external params",
	partInsideParams: "inside params",
	partReturnType: "return type",
});

module.exports = { PHRASES };
