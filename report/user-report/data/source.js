"use strict";

// Reading the two sides of a diff.
//
// A span is `{ startLine, endLine, lines: [{ no, text }], missing }` — the real
// lines of the file at the numbers the parser reported, so the viewer shows the
// code AS THE FILE HAS IT (a diff of pretty-printed snippets would lie about
// line numbers and indent).
//
// Files are read once per run and kept: a canonical util may be the right-hand
// side of twenty pairs, and reading it twenty times is twenty chances to
// disagree with itself.

const fs = require("node:fs");

const { notice } = require("../../notices");
const { PHRASES, fill } = require("../../errorTypes/vocabulary/phrases");

const cache = new Map();

const readLines = (absPath) => {
	if (cache.has(absPath)) return cache.get(absPath);
	let lines = null;
	try {
		lines = fs.readFileSync(absPath, "utf8").split(/\r?\n/);
	} catch (err) {
		notice(fill(PHRASES.notRead, { path: absPath, reason: err && err.message ? err.message : String(err) }));
	}
	cache.set(absPath, lines);

	return lines;
};

const spanOf = (absPath, startLine, endLine) => {
	const all = readLines(absPath);
	if (!all) return { startLine: startLine ?? 1, endLine: endLine ?? startLine ?? 1, lines: [], missing: true };

	const from = Math.max(1, Number(startLine ?? 1));
	const to = Math.min(all.length, Number(endLine ?? from));
	const lines = [];
	for (let no = from; no <= to; no += 1) lines.push({ no, text: all[no - 1] ?? "" });

	return { startLine: from, endLine: to, lines, missing: false };
};

// The place a finding points at, resolved to real source.
const spanOfPlace = (place) => {
	if (!place || !place.path) return null;

	return spanOf(place.path, place.line, place.endLine ?? place.line);
};

module.exports = { readLines, spanOf, spanOfPlace };
