"use strict";

// ── SIGNATURE MATCHER · the CLI/markdown text ───────────────────────────────
//
// A ledger, not a paragraph: one line per fact, and every fact carries the
// lines it is about. There is no header — the group's name is printed by the
// report next to the first line, and repeating it here said the same thing
// twice.

const { PHRASES } = require("./phrases");
const { fill } = require("../../errorTypes/vocabulary/phrases");

// ` · 67%` while the piece does not fully correspond, nothing when it does —
// a piece that corresponds exactly has no number to show.
const shareOf = (same, total) => (total > 0 && same < total ? ` · ${Math.round((same / total) * 100)}%` : "");

// `a, b, c` — a position list, deduplicated and in line order.
const lines = (values) => [...new Set(values)].sort((a, b) => a - b).join(",");

// kind → the lines it is written on, for one side.
const sitesOf = (sites, out = new Map()) => {
	for (const site of sites ?? []) {
		if (!site || site.line == null || !site.kind) continue;
		const list = out.get(site.kind) ?? [];
		list.push(site.line);
		out.set(site.kind, list);
	}

	return out;
};

const text = (model) => {
	if (!model) return [];

	const lines_ = [];
	const same = model.params.filter((row) => row.same).length;
	const notes = [];
	for (const row of model.params) {
		if (row.same) continue;
		if (row.left && row.right) notes.push(fill(PHRASES.roleNote, { index: row.index + 1, left: row.left.role, right: row.right.role }));
		else {
			const one = row.left ?? row.right;
			notes.push(fill(PHRASES.onlyNote, { index: row.index + 1, name: one?.name ?? "?", side: row.left ? "local" : "canonical" }));
		}
	}
	lines_.push([fill(PHRASES.params, { percent: shareOf(same, model.params.length) }), ...notes].join("  "));

		// THE TYPES, position by position: `types 3/4`, with the position that differs.
		const typeNotes = [];
		let sameTypes = 0;
		for (const row of model.params) {
			if (!row.left || !row.right) continue;
			const leftType = row.left.type || "?";
			const rightType = row.right.type || "?";
			if (leftType === rightType) sameTypes += 1;
			else typeNotes.push(fill(PHRASES.typeNote, { index: row.index + 1, left: leftType, right: rightType }));
		}
		if (model.params.length > 0) lines_.push([fill(PHRASES.types, { percent: shareOf(sameTypes, model.params.length) }), ...typeNotes].join("  "));

		// THE WORDS the two FUNCTION names share — the same words the board paints.
		const wordSets = model.names.words ?? { left: [], right: [], common: [] };
		if (wordSets.common.length > 0) {
			lines_.push(
				fill(PHRASES.nameWords, {
					percent: shareOf(wordSets.common.length, Math.max(wordSets.left.length, wordSets.right.length)),
					common: wordSets.common.join(","),
				}),
			);
		}
	// Names are POSITIONS and nothing else — the same ones the board paints. A list
	// of words would be a second vocabulary the reader has to search the text for,
	// and the page could not draw it. Kinds on the SAME lines are merged: `function`
	// and `param` both start on the declaration line.
	const names = model.names;
	const left = sitesOf(names.sites.left);
	const right = sitesOf(names.sites.right);
	const kinds = [...left.keys()].filter((kind) => right.has(kind)).sort();
	const merged = new Map();
	for (const kind of kinds) {
		const key = `${lines(left.get(kind))}|${lines(right.get(kind))}`;
		merged.set(key, [...(merged.get(key) ?? []), kind]);
	}
	if (merged.size > 0) {
		lines_.push(
			[
				fill(PHRASES.names, {}),
				...[...merged.entries()].map(([key, list]) => {
					const [leftLines, rightLines] = key.split("|");
					return fill(PHRASES.site, { kind: list.join(","), left: leftLines, right: rightLines });
				}),
			].join("  "),
		);
	}

	lines_.push(
		fill(PHRASES.returns, {
			leftType: model.left.returns.type ?? "?",
			rightType: model.right.returns.type ?? "?",
			arrow: model.left.returns.type === model.right.returns.type ? " ≡ " : " ≠ ",
		}),
	);

	return lines_;
};

module.exports = { text };
