"use strict";

// ── STRUCTURE MATCHER · the CLI/markdown text ───────────────────────────────
//
// Counts, then the lines: `call 5↔6` says the bodies do not agree on how many
// calls they make, `0:12,16,21,27,30↔1:66,…` says where they are. Nothing here
// says "both have a call" — that fact does not decide anything.

const { PHRASES } = require("./phrases");
const { countLabel } = require("./count");
const { fill } = require("../../errorTypes/vocabulary/phrases");

const lines = (values) => [...new Set(values ?? [])].sort((a, b) => a - b).join(",");

const text = (model) => {
	if (!model) return [];
	if (model.kinds.length === 0) return [PHRASES.empty];

	// The number that decides, then the counts behind it, then the lines.
	const head = fill(PHRASES.summary, {
		score: Math.round(model.score * 100) / 100,
		percent:
			model.totalCount > 0 && model.sharedCount < model.totalCount
				? ` · ${Math.round((model.sharedCount / model.totalCount) * 100)}%`
				: "",
	});
	// The same count the board prints on the lane, from the same function.
	const parts = model.counts.map((row) =>
		fill(PHRASES.site, {
			label: countLabel(row.kind, row.left, row.right),
			leftLines: lines(model.leftSites.get(row.kind)),
			rightLines: lines(model.rightSites.get(row.kind)),
		}),
	);
	const line = [head, ...parts].join("  ");
	const only = [];

	if (model.leftSites.size > 0) {
		const localOnly = model.counts.filter((row) => row.right === 0).map((row) => `${row.kind} ${row.left}`);
		if (localOnly.length > 0) only.push(fill(PHRASES.onlyLeft, { list: localOnly.join(", ") }));
	}
	if (model.rightSites.size > 0) {
		const canonicalOnly = model.counts.filter((row) => row.left === 0).map((row) => `${row.kind} ${row.right}`);
		if (canonicalOnly.length > 0) only.push(fill(PHRASES.onlyRight, { list: canonicalOnly.join(", ") }));
	}

	return only.length > 0 ? [line, only.join("  ")] : [line];
};

module.exports = { text };
