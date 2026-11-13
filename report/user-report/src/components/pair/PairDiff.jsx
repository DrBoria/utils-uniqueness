"use strict";

import React, { useState } from "react";
import { CodeDiff } from "@md-code/code-diff/view";
import { nameEvidence } from "./lenses";
import { textOf } from "./model";
import { langOf, tokensOf } from "./code/syntax";
import { GROUP_WEIGHT, saturate, percentOf } from "../../../../../evidence";
import { pairTheme } from "./theme";

// ── THE PAIR, DRAWN BY @md-code/code-diff ─────────────────────────────────
//
// The adapter. It only states FACTS and nothing about drawing:
//   • per row: the line `text`, the character `marks` that carry a shared name,
//     and the item id it holds in each column (`cells`);
//   • per row: whether it is in a band (`group`) and the `tone` it adds.
// The PACKAGE does the rest: `buildConnections` groups consecutive equal-group
// rows into connections, `buildSegments` cuts the text into painted pieces, and
// the board draws columns, corridors, bands, joins and the number plate.

const theme = {
	paper: pairTheme.chrome.panelAlt,
	// A marked range is a HIGHLIGHTER: the wash of a matched row, not the solid
	// band — a solid fill over every shared name turned the signature page into
	// red soup. The ink stays the panel's text so the word reads on the wash.
	paint: pairTheme.mark.same,
	paintInk: pairTheme.chrome.text,
	// The connection between the columns is a thin WHITE line, not a filled slab:
	// the colour of a ribbon comes from the theme, so the package stays colour-free.
	ribbon: pairTheme.chrome.text,
	panel: pairTheme.chrome.panel,
	edge: pairTheme.chrome.border,
	edgeStrong: pairTheme.chrome.borderStrong,
	text: pairTheme.chrome.text,
	dim: pairTheme.chrome.dim,
	faint: pairTheme.chrome.faint,
	mono: pairTheme.font.mono,
};

// One LIGHT colour per tone: the wash behind a row and the ribbon through the
// corridor are the SAME pale fill, so a lane is one continuous, non-shouting
// shape and never changes colour in the middle.
const tones = {
	same: { fill: pairTheme.wash.same, line: pairTheme.wash.same, hot: pairTheme.wash.hot },
	differs: { fill: pairTheme.wash.diff, line: pairTheme.wash.diff, hot: pairTheme.wash.hotDiff },
};

// ONE source of truth for the signature tab: the CORRESPONDENCES of shared names.
// The same picks drive BOTH the ribbons (connections) and the painted marks, so a
// highlighted word is always on a ribbon and a ribbon always joins highlighted
// words. Columns come from the DATA (`pair.columns`, `row.cells`, `byColumn`) and
// are addressed by index — no left/right. Other tabs group rows by their verdict.
// Nothing here words a match: every connection arrives with its label.

// Every character range a lane is about, from the pair's own name sites. The lane's
// OWN ID says what it compares — `same:param:e`, `same:name-word`, `same:prop:name` —
// so a lane underlines the kind of name it is about and nothing else. Nothing is
// searched for in the text: `column` is what the parser reported.
const nameRangesOf = (pair, conn) => {
	const names = pair?.analysis?.signature?.names ?? null;
	if (names === null) return [];
	const common = new Set(names.common ?? []);
	// The words are compared lowercased (that is how the two names were scored), so
	// the words painted are looked up lowercased too: `Plain` IS `plain`, and a name
	// whose every word corresponds paints as ONE range over the whole name.
	const sharedWords = new Set((names.words?.common ?? []).map((word) => String(word).toLowerCase()));
	const [, kind, ...rest] = String(conn.connectionId ?? "").split(":");
	// A lane is named after ONE of its names (`same:prop:actions`), but it stands for the
	// whole row it joins — the caption says "property assignments". Narrowing the marks
	// to the name in the id left `totalActions` and `cursor` marked on the row and owned
	// by no lane, so pointing at them lit nothing. The KIND is what makes a mark belong
	// to the lane; the id's last word is only the name the lane happens to be called by.
	const only = kind === "name-word" ? rest.join(":") || null : null;
	const out = [];

	// THE TEXT OF A ROW, by column and line: what follows a name is what tells two
	// `type` properties apart (`"dom-action"` vs `"domResponse"`).
	const textAt = (column, line) => {
		const row = (pair?.rows ?? []).find((entry) => String(entry.cells?.[column]?.no) === String(line));

		return textOf(row?.cells?.[column]) ?? "";
	};
	// WHAT MAKES TWO RANGES THE SAME NAME, not merely the same word: a property carries its
	// VALUE, everything else carries the name alone. Without the value every `type:` of a
	// block is one name, and the duplicate a reader points at is picked by luck.
	const keyOf = (column, line, from, to, name) => {
		if (kind !== "prop") return String(name);
		const value = /^\s*:\s*([^,}]*)/.exec(textAt(column, line).slice(to))?.[1]?.trim() ?? "";

		return `${name}\u0000${value}`;
	};

	const push = (end, line, from, to, name) => {
		out.push({ column: end.column, line: String(line), from, to, name: String(name), key: keyOf(Number(end.column), line, from, to, name) });
	};
	// WHAT the lane is about, as a range: the declaration form (`function`, `get`,
	// `() =>`) for a function, the word itself for everything else. The position
	// comes with the site — the view never looks for it in the row.
	const rangeOf = (site) => {
		const head = kind === "function" ? site.head : null;
		if (head) return { line: head.line, from: head.column - 1, to: head.columnEnd };

		return { line: site.line, from: site.column - 1, to: site.column - 1 + String(site.name).length };
	};

	for (const end of conn.ends) {
		const column = Number(end.column);
		const sites = names.byColumn?.[column] ?? [];
		const words = names.byColumnWords?.[column] ?? [];
		for (const item of end.items) {
			const line = Number(item);
			if (kind === "name-word") {
				for (const word of words) {
					if (word.line !== line || !sharedWords.has(String(word.name).toLowerCase())) continue;
					push(end, item, word.column - 1, word.column - 1 + String(word.name).length, word.name);
				}

				continue;
			}
			for (const site of sites) {
				if (site.line !== line) continue;
				if (!common.has(site.name)) continue;
				if (kind !== undefined && kind !== "name-word" && site.kind !== kind) continue;
				if (only !== null && site.name !== only) continue;
				const range = rangeOf(site);
				// A declaration form on another row than the id (a multi-line head) is not
				// this id's range: the lane names rows, and only this row's own form paints.
				if (range.line !== line) continue;
				push(end, item, range.from, range.to, site.name);
			}
		}
	}

	// ONE DUPLICATE PER RANGE. Two ranges with the same KEY are the same name written on
	// the two sides, so each is the other's twin — and a hover can light exactly that,
	// instead of the row, the lane, or the first name that happens to match.
	const byKey = new Map();
	for (const range of out) {
		const list = byKey.get(range.key) ?? [];
		list.push(range);
		byKey.set(range.key, list);
	}
	for (const list of byKey.values()) {
		// A name written twice on one side (`type: "domResponse"` in both catch blocks) is
		// still one pair per occurrence: take each side in order and pair them off.
		const sides = new Map();
		for (const range of list) {
			const side = sides.get(range.column) ?? [];
			side.push(range);
			sides.set(range.column, side);
		}
		const columns = [...sides.keys()];
		if (columns.length < 2) continue;
		const [leftColumn, rightColumn] = columns;
		const left = sides.get(leftColumn) ?? [];
		const right = sides.get(rightColumn) ?? [];
		for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
			const a = left[index];
			const b = right[index];
			if (a === undefined || b === undefined) continue;
			a.twin = { column: b.column, line: b.line, from: b.from, to: b.to };
			b.twin = { column: a.column, line: a.line, from: a.from, to: a.to };
		}
	}
	// SECOND PASS: BY NAME, IN ORDER. `text: \`Dragged …\`` and `text: \`Scrolled …\`` are the
	// same property twice with different values — the value cannot pair them, but their
	// position in the object can. Without this the duplicate was simply not shown.
	const byName = new Map();
	for (const range of out) {
		if (range.twin !== undefined) continue;
		const list = byName.get(range.name) ?? [];
		list.push(range);
		byName.set(range.name, list);
	}
	for (const list of byName.values()) {
		const sides = new Map();
		for (const range of list) {
			const side = sides.get(range.column) ?? [];
			side.push(range);
			sides.set(range.column, side);
		}
		const columns = [...sides.keys()];
		if (columns.length < 2) continue;
		const left = sides.get(columns[0]) ?? [];
		const right = sides.get(columns[1]) ?? [];
		for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
			const a = left[index];
			const b = right[index];
			if (a === undefined || b === undefined) continue;
			a.twin = { column: b.column, line: b.line, from: b.from, to: b.to };
			b.twin = { column: a.column, line: a.line, from: a.from, to: a.to };
		}
	}

	return out.map(({ column, line, from, to, twin }) => (twin === undefined ? { column, line, from, to } : { column, line, from, to, twin }));
};

const correspondencesOf = (pair, key = "connections") => {
	const chosen = new Set();
	const connections = [];

	for (const conn of pair?.[key] ?? []) {
		const marks = conn.marks ?? [];
		// STRUCTURE Pairs its constructs: the range a lane holds on the left and the range it
		// holds on the right are the same construct, so each is the other's twin.
		if (key === "structureConnections") {
			const left = marks.filter((mark) => mark.column === "0");
			const right = marks.filter((mark) => mark.column === "1");
			for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
				const a = left[index];
				const b = right[index];
				if (a === undefined || b === undefined) continue;
				a.twin = { column: b.column, line: b.line, from: b.from, to: b.to };
				b.twin = { column: a.column, line: a.line, from: a.from, to: a.to };
			}
		}
		connections.push({
			id: conn.connectionId,
			tone: "same",
			label: conn.label,
			ends: conn.ends.map((end) => ({ column: end.column, items: end.items })),
			// A lane carries the RANGES it is about, so the board can underline the exact
			// occurrence instead of washing the row. The signature lanes name rows and shared
			// names; the ranges of those names come with the pair (`names.sites`), one per
			// end, and are attached here — the page never searches a row for a word.
			marks: marks.length > 0 ? marks : key === "connections" ? nameRangesOf(pair, conn) : [],
		});
		for (const end of conn.ends) for (const id of end.items) chosen.add(`${end.column}\u0000${id}`);
	}

	return { connections, chosen };
};

// Prism says what a piece of text IS (`keyword`, `string`), this table says what
// it looks like. It lives here because the palette is the report's, not the
// package's: the package only receives `ink` colours.
const INK = {
	keyword: pairTheme.token.keyword,
	string: pairTheme.token.string,
	number: pairTheme.token.number,
	"class-name": pairTheme.token.className,
	"function-variable": pairTheme.token.function,
	operator: pairTheme.token.operator,
	"template-string": pairTheme.token.string,
	punctuation: pairTheme.chrome.dim,
	comment: pairTheme.token.comment,
	boolean: pairTheme.token.number,
	builtin: pairTheme.token.function,
};

const inkOf = (type) => INK[type] ?? undefined;

// Every mark is a COLUMN RANGE the data already located — `site.column` for a
// whole name, `word.column` for a shared word of a long function name. The view
// never searches the line for a substring; it paints `[from,to)` at a column and
// stops. `byColumnWords[column]` is always an array, and one name can contribute
// 1 word or several.
const marksOf = (row, column, pair, chosen) => {
	const cell = row.cells?.[column];
	if (!cell) return [];

	// A row is addressed by its ID (its line number), never by comparing rows.
	const id = String(cell.no ?? "");
	const { byColumn, byColumnWords, matched } = nameEvidence(pair);
	const marks = [];

	// Shared words of the two names: painted by their own COLUMNS, on both sides,
	// whatever syntax declared the name (`function`, `prop`, `var-decl`).
	for (const word of byColumnWords[column] ?? []) {
		if (word.line === cell.no) marks.push({ from: word.column - 1, to: word.column - 1 + word.name.length });
	}

	for (const site of byColumn[column] ?? []) {
		// A name is painted WHOLE only when the DATA gave it a lane. A name of one side alone
		// is painted by the WORDS it shares (`create` + `Adapter`), never as a match it does
		// not have — `entries` on a row with no `entries` on the other side is not one.
		if (!matched.includes(site.name)) continue;
		// Any other name is painted whole, and only when the DATA put this id into a
		// connection — the id is what decides.
		if (String(site.line) !== id || !chosen.has(`${column}\u0000${id}`)) continue;
		// A FUNCTION lane is about the form (`function`, `get`, `() =>`), not about the
		// name it binds — the name has a lane of its own (`function names`) and is
		// painted by its words. So the range painted here is the one the site hands
		// over, and the name is never the stand-in for it.
		if (site.head) {
			if (String(site.head.line) === id) marks.push({ from: site.head.column - 1, to: site.head.columnEnd });

			continue;
		}
		marks.push({ from: site.column - 1, to: site.column - 1 + site.name.length });
	}

	return marks;
};

// The adapter produces plain ITEMS — one per real line — and nothing else. It
// does not fold, does not hide, does not know the word "fold": the board hides
// whatever takes no part in a connection and folds those runs itself.
const columnOf = (list, index, total, pair, chosen, paint = true, marksAt = null, notesAt = null) => ({
	id: String(index),
	kind: "items",
	// Mirror the RIGHT HALF of the columns (their numbers on the outer edge): works
	// for any N — 2 columns mirror index 1, 4 columns mirror 2 and 3.
	mirrored: index >= Math.ceil(total / 2),
	// A COLUMN LISTS ITS OWN LINES. The pair's rows carry one cell per side, and a row
	// written only on the other side has no cell here: listing it anyway put empty rows in
	// the column — after a fold was opened the left column was half blank, the board was
	// twice as tall as the code, and the rows a lane names fell out of the mounted window,
	// so the lanes never reached the last column.
	items: list
		.filter((row) => row.cells?.[index] != null)
		.map((row) => {
			const id = String(row.cells[index].no);

			return {
				// The id is the LINE NUMBER of this column — the address a connection names.
				id,
				plate: String(row.cells[index].no),
				text: textOf(row.cells[index]),
				// THIS row's own tone, when it breaks the lane it belongs to (`pixels` in a
				// parameter list). Absent means "the lane's tone", which is the normal case.
				tone: pair?.rowTones?.[index]?.[id],
				// `paint: false` is the AST board: it shows AST structure only, so names that
				// belong to the signature group are not marked there. `marksAt` is the payload's
				// own ranges (the construct a structure/flow lane is about) — and the declared
				// names are painted on TOP of them: a shared name is a duplicate in every
				// tab, not only in the signature one.
				marks:
					marksAt === null
						? (paint ? marksOf(row, index, pair, chosen) : [])
						: [...(marksAt(row.cells[index].no) ?? []), ...(paint ? marksOf(row, index, pair, chosen) : [])],
				// The numbers the tab counts with. A RELATIVE position inside the row: the
				// board draws it above the character it stands over, never as a column.
				notes: notesAt === null ? [] : notesAt(id),
			};
		}),
});

// ── THE AST BOARD ──────────────────────────────────────────────────────────
//
// Five columns: code, tree, code (where the two sides intersect), tree, code.
// A row of the tree is a BLOCK — a matched construct (`if`, `call:log`, `var:const`,
// `return`, `func`) — never a leaf: an `Identifier` is part of the piece it sits in.
// `[kind, label, block, kids, start, end, syntax, column, columnEnd, matched]`, where
// `block` is the piece the node belongs to (-1 = a container inside one) and `matched`
// says the node was paired at all.
const SIDES = ["left", "right"];

const buildTree = (node, inherited, counter) => {
	if (!Array.isArray(node)) return null;
	const [kind, , block, kids, start, , syntax, column, columnEnd, matched] = node;
	const ownBlock = typeof block === "number" ? block : -1;
	const record = {
		id: `n${counter.at}`,
		kind: String(syntax ?? kind),
		line: String(start ?? ""),
		ownBlock,
		block: ownBlock >= 0 ? ownBlock : inherited,
		matched: matched === 1,
		from: typeof column === "number" ? column - 1 : null,
		to: typeof columnEnd === "number" ? columnEnd : null,
		children: [],
	};
	counter.at += 1;
	for (const kid of kids ?? []) {
		const child = buildTree(kid, record.block, counter);
		if (child) record.children.push(child);
	}

	return record;
};

const astRootOf = (pair, side) => buildTree(pair?.analysis?.ast?.[SIDES[side]] ?? null, -1, { at: 0 });

const eachNode = (node, visit) => {
	if (!node) return;
	visit(node);
	for (const child of node.children) eachNode(child, visit);
};

/** One tree row per block: the construct's own syntax name, as the parser reported it. */
const astItemsOf = (pair, side) => {
	const rows = [];
	eachNode(astRootOf(pair, side), (node) => {
		// `line` is the code line this CONSTRUCT is written on: pointing at the row means
		// pointing at that line, never at the whole block it belongs to.
		if (node.ownBlock >= 0) rows.push({ id: node.id, text: node.kind, line: node.line === "" ? undefined : node.line });
	});

	return rows;
};

/**
 * What the AST group actually MATCHED: one row per block, with the piece it is, the
 * nodes it covers and what it is worth. The rows come from the data (`ast.blocks`),
 * so the caption and the verdict count the same blocks.
 *
 * The pieces that were compared and did NOT correspond (`ast.unmatched`) get a row too,
 * with no number: they are in no percentage, and a board that lists their rows in the
 * tree while the middle column says nothing left them dangling.
 */
export const astMatchOf = (pair) =>
	[
		...(pair?.analysis?.ast?.blocks ?? []).map((block) => ({
			id: `m:${block.index}`,
			// The piece and, ONLY when it is not an exact match, its share. `2 / 2 nodes`
			// was a count nobody could use.
			text: block.percent === null ? block.form : `${block.form} · ${block.percent}%`,
		})),
		...(pair?.analysis?.ast?.unmatched ?? []).map((block) => ({ id: `m:${block.index}`, text: block.form })),
	];

const astColumnsOf = (list, pair, chosen, marksAtFor) => {
	// Each rendered column gets its OWN id and its share of the width — the board is
	// laid out as `2fr 1fr 1fr 1fr 2fr`: code twice as wide as a tree or the match.
	// The code column gets the LANE RANGES of this tab: each shared node underlines the
	// construct it came from, so a band is never drawn over a line with nothing to point at.
	const code = (side, id, mirrored) => ({ ...columnOf(list, side, 2, pair, chosen, false, marksAtFor(id)), id, mirrored, ratio: 2 });
	const tree = (side, id, mirrored) => ({ id, kind: "items", mirrored, ratio: 1, cap: true, items: astItemsOf(pair, side) });
	// The middle column is the MATCH, not the code: each row is one node name that is
	// shared, with how many times it occurs on each side.
	const match = {
		id: "2",
		kind: "items",
		mirrored: false,
		ratio: 1,
		// Each match row states the BLOCK it stands for and what that block is worth: a
		// longer piece and a rarer construct are stronger evidence, and the number is the
		// same arithmetic the verdict uses.
		items: astMatchOf(pair).map((entry) => ({ id: entry.id, text: entry.text })),
	};

	// 0 code · 1 tree · 2 match · 3 tree · 4 code
	return [code(0, "0", false), tree(0, "1", false), match, tree(1, "3", true), code(1, "4", true)];
};

/**
 * ONE LANE PER BLOCK — BOTH SIDES IN THE SAME LANE:
 *
 *   the block's rows  ←→  its construct  ←→  the match row  ←→  its construct  ←→  its rows
 *
 * A block index is ONE matched pair, so both sides of it are the same subject: the lane
 * has to name five ends, not one side at a time. Built per side, the pointer on the left
 * `call:toLowerCase` lit three columns and the duplicate on the right stayed dark — a
 * "duplicates" screen where the duplicate cannot be seen.
 *
 * `marks` are the ranges of every MATCHED node in the block's subtree, so a lane
 * underlines the whole construction it is about (`if` plus its body), never a bare row.
 */
const astConnectionsOf = (pair) => {
	// The pieces that were compared and did not correspond: they get a lane too, in the
	// `differs` tone and with no number — they are in no percentage, but their rows are on
	// the board and silence about them read as a bug.
	const unmatched = new Set((pair?.analysis?.ast?.unmatched ?? []).map((block) => block.index));
	// Per side: which block a construct belongs to, and the nodes under it.
	const sides = [0, 1].map((side) => {
		const byBlock = new Map();
		eachNode(astRootOf(pair, side), (node) => {
			if (node.ownBlock < 0) return;
			byBlock.set(node.ownBlock, { root: node, nodes: [], all: [] });
		});
		// A block's ranges are its whole matched SUBTREE, so the row underlines the piece
		// and not only its first token.
		for (const entry of byBlock.values()) {
			eachNode(entry.root, (node) => {
				entry.all.push(node);
				if (node.matched) entry.nodes.push(node);
			});
		}

		return { side, codeColumn: side === 0 ? "0" : "4", treeColumn: side === 0 ? "1" : "3", byBlock };
	});

	const rows = [];
	const blocks = new Set();
	for (const { byBlock } of sides) for (const block of byBlock.keys()) blocks.add(block);
	for (const block of [...blocks].sort((a, b) => a - b)) {
		const ends = [];
		const marks = [];
		for (const { codeColumn, treeColumn, byBlock } of sides) {
			const entry = byBlock.get(block);
			// An unpaired block exists on one side only: that side's ends are the whole lane.
			if (entry === undefined) continue;
			// A piece that did not correspond may have no matched node at all — the lane then
			// covers the rows it was written on, because that is what the reader has to see.
			const covered = entry.nodes.length > 0 ? entry.nodes : entry.all;
			const lines = [...new Set(covered.filter((node) => node.line !== "").map((node) => node.line))];
			for (const node of entry.nodes) {
				if (node.from === null || node.to === null || node.line === "") continue;
				marks.push({ column: codeColumn, line: node.line, from: node.from, to: node.to });
			}
			if (lines.length > 0) ends.push({ column: codeColumn, items: lines });
			ends.push({ column: treeColumn, items: [entry.root.id] });
		}
		if (ends.length === 0) continue;
		ends.push({ column: "2", items: [`m:${block}`] });
		// ONE BLOCK, ONE DUPLICATE: the range in the left code column and its range in the
		// right one are the same construct, so each carries the other and a hover lights both.
		const left = marks.filter((mark) => mark.column === "0");
		const right = marks.filter((mark) => mark.column === "4");
		for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
			const a = left[index];
			const b = right[index];
			if (a === undefined || b === undefined) continue;
			a.twin = { column: b.column, line: b.line, from: b.from, to: b.to };
			b.twin = { column: a.column, line: a.line, from: a.from, to: a.to };
		}
		rows.push({ id: `b:${block}`, tone: unmatched.has(block) ? "differs" : "same", label: null, ends, marks });
	}

	return rows;
};

export const PairDiff = ({ rows, pair, reveal = false, corridor = 220, fit = "scroll", mode = "signature" }) => {
	// Flatten the data's nesting back into plain lines; the board decides what to
	// show (a line in a connection → shown; otherwise → hidden by the board).
	const source = pair?.rows ?? rows;
	const list = source.flatMap((row) => (row.rows ? row.rows : [row]));
	const meta = pair?.columns ?? [];
	const ast = mode === "ast";
	// SWITCH on the tab: every group draws its OWN lanes, not the signature ones.
	const laneKey = mode === "structure" ? "structureConnections" : mode === "controlFlow" ? "controlFlowConnections" : "connections";
	const { connections, chosen } = correspondencesOf(pair, laneKey);
	// THE AST TAB HAS ITS OWN LANES, built here from the shared nodes. The marks it paints
	// must come from THAT list: reading the signature lanes painted a range that belonged
	// to another comparison (or nothing at all, which is why a band had no underline).
	const astLinks = ast ? astConnectionsOf(pair) : null;
	// Word marks belong to the SIGNATURE group: those are the names it compares. The
	// AST, structure and control-flow boards paint constructs, not identifiers.
	// NAMES belong to the signature group: it is the group that compares them.
	// Structure and control flow compare DECLARATIONS — `const` vs `let`, `function`
	// vs `=>`, how many calls — never what a variable is called.
	const paintNames = mode === "signature";
	// The payload's own ranges for this tab: the construct each lane is about (`if`,
	// `const`, `try`, `call`…), keyed by column and line so a row paints exactly what
	// the engine decided to point at — the CLI prints the same ranges.
	const laneMarks = new Map();
	for (const conn of astLinks ?? connections) {
		for (const mark of conn.marks ?? []) {
			const markKey = `${mark.column}\u0000${mark.line}`;
			const list = laneMarks.get(markKey) ?? [];
			list.push({ from: mark.from, to: mark.to });
			laneMarks.set(markKey, list);
		}
	}
	const marksAtFor = (column) =>
		mode === "signature"
			? null
			: mode === "controlFlow"
				? (line) => flowRanges.get(`${column}\u0000${String(line)}`) ?? []
				: (line) => laneMarks.get(`${column}\u0000${String(line)}`) ?? [];
	// ── THE NUMBERS ─────────────────────────────────────────────────────────
	//
	// Structure and control flow count in bare numbers, and a number belongs ABOVE
	// the row it counts — over the argument list for a call, over the start of the
	// row for a step. The payload hands them over already positioned (`from` is a
	// character offset inside the row), so the board only has to draw them.
	const notesAtFor = (column) => (mode === "signature" || mode === "ast" ? null : (id) => pair?.notes?.[mode]?.[column]?.[String(id)] ?? []);
	// ── THE ORDER, IN THE MIDDLE ────────────────────────────────────────────
	//
	// Control flow compares ONE sequence: the same steps in the same order on both sides,
	// so the number belongs in the MIDDLE of the board, written once.
	const numbers = mode === "controlFlow" && !ast ? pair?.flowNumbers ?? [] : [];
	// THE CONSTRUCT OF EVERY STEP, AS A RANGE IN THE CODE. `flowMarks` only carries the
	// ranges the engine happened to report (two lines in a whole file); the steps know where
	// each `const`, `new`, `if`, `call` and `return` starts — so the constructs that are
	// counted in the middle are underlined in the code, exactly as in the structure tab.
	const flowRanges = new Map();
	// The ranges of ONE STEP, both sides: the lane carries them, so pointing at a construct
	// can light it and its duplicate instead of only warming the lane.
	const flowStepMarks = new Map();
	for (const step of numbers) {
		const made = {};
		for (const [column, at] of [
			["0", step.leftStep],
			["1", step.rightStep],
		]) {
			// A construct that spans several lines starts here: the range covers the rest of
			// this line, so the word a reader points at is still in it.
			if (at == null) continue;
			const from = Number(at.column) - 1;
			const to = at.endLine != null ? Number.MAX_SAFE_INTEGER : Number(at.columnEnd);
			if (!Number.isFinite(from) || Number.isNaN(to) || to <= from) continue;
			made[column] = { column, line: String(at.line), from, to };
		}
		// THE STEP IS A PAIR: `const` here is the `const` over there, so each range carries
		// the other one. Hovering it lights both, not only the side the pointer is on.
		const left = made["0"];
		const right = made["1"];
		if (left !== undefined && right !== undefined) {
			left.twin = { column: right.column, line: right.line, from: right.from, to: right.to };
			right.twin = { column: left.column, line: left.line, from: left.from, to: left.to };
		}
		for (const range of Object.values(made)) {
			const key = `${range.column}\u0000${range.line}`;
			const ranges = flowRanges.get(key) ?? [];
			ranges.push(range);
			flowRanges.set(key, ranges);
		}
		flowStepMarks.set(step.id, Object.values(made));
	}
	// ONE STEP, ONE ROW, ONE RIBBON. `const x = new Y()` is a `var` AND a `new`; packing both
	// numbers into the row of one code line made the reader count two constructs on one line
	// while the code writes them one after another. Every step gets its own row.
	const flowConnections = numbers.map((step) => ({
		id: `flow:${step.id}`,
		tone: "same",
		label: null,
		ends: [{ column: "0", items: [String(step.left)] }, { column: "2", items: [step.id] }, { column: "1", items: [String(step.right)] }],
		marks: flowStepMarks.get(step.id) ?? [],
	}));
	for (const step of numbers) chosen.add(`2\u0000${step.id}`);
	const flowColumn =
		numbers.length === 0
			? null
			: {
					id: "2",
					kind: "items",
					mirrored: false,
					// A FIXED narrow strip: the numbers are a caption, and every pixel it takes is a
					// pixel the code loses. `2fr <160px> 2fr` keeps the code as wide as the board allows.
					width: 160,
					// The middle column has its OWN ids (`s:<line>:<n>`), because a number is not a
					// line: the connections name them, so they must differ from the code ids.
					items: numbers.map((step) => ({
						id: step.id,
						text: "",
						segments: [
							{ text: step.text, ink: pairTheme.chrome.text },
							{ text: ` ${step.kind}`, ink: pairTheme.chrome.dim },
						],
					})),
				};
	const columns = ast
		? astColumnsOf(list, pair, chosen, marksAtFor)
		: flowColumn === null
			? meta.map((_, index) => columnOf(list, index, meta.length, pair, chosen, paintNames, marksAtFor(String(index)), notesAtFor(String(index))))
			: [
					// The non-step rows fold away in all three columns at once: the fold runs are the
					// same, so the pills stand at the same height and the ribbons stay level.
					{ ...columnOf(list, 0, 2, pair, chosen, paintNames, marksAtFor("0"), notesAtFor("0")), ratio: 2 },
					flowColumn,
					{ ...columnOf(list, 1, 2, pair, chosen, paintNames, marksAtFor("1"), notesAtFor("1")), ratio: 2 },
				];
	// Prism stays here — the package only receives coloured tokens per column. The AST
	// board tokenizes only the two code columns: a tree row is a syntax name and a
	// match row is `kind · left / right`, and Prism would colour their digits and
	// slashes until the numbers stopped being readable.
	const plain = new Set(["1", "2", "3"]);
	const tokenize = (text, column) => (ast && plain.has(String(column)) ? [{ text }] : tokensOf(text, langOf(meta[Number(column)]?.path)).map((token) => ({ text: token.text, ink: inkOf(token.type) })));

	// A corridor after EVERY column but the last: N columns → N−1 corridors. The
	// count comes from the data, so 2 or 540 columns both work. The ribbons live in
	// the corridor: with no corridor they are painted behind the columns and vanish.
	const gap = ast ? 70 : mode === "controlFlow" ? Math.min(corridor, 110) : corridor;
	const corridors = columns.map((_, index) => (index < columns.length - 1 ? gap : undefined));

	return (
		<CodeDiff
			theme={theme}
			tones={tones}
			columns={columns}
				connections={astLinks ?? (mode === "controlFlow" ? flowConnections : connections)}			reveal={reveal}
			corridors={corridors}
			// The two trees scroll together on BOTH axes (columns 2 and 4 in the reader's
			// numbering); each code column scrolls with its own side; a tree never drags
			// code sideways.
			sync={ast ? [{ columns: ["1", "3"], axis: "xy" }, { columns: ["0", "4"], axis: "xy" }, { columns: ["0", "2", "4"], axis: "y" }] : [{ columns: columns.map((_, index) => String(index)), axis: "xy" }]}
			fit={fit}
			tokenize={tokenize}
		/>
	);
};

export default PairDiff;
