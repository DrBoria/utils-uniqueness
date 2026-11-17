"use strict";

import { textOf } from "./model";

// ── LENSES ────────────────────────────────────────────────────────────────
//
// Every tab answers a different question about the same code, so every tab gets
// its own LENS: which lines it keeps visible, and what it highlights inside
// them. Nothing here is per-tab special-cased in the renderer — the view asks
// the lens, the lens decides.
//
//   signature   — keep the declaration head and its parameter list, everything
//                 below is folded. Inside a line, the fragments that are the
//                 SAME on both sides are highlighted (the duplicated symbols).
//   structure   — keep lines that contain a structural construct, fold the rest.
//   ast         — keep everything; the tree lives in its own two columns.
//   controlFlow — keep lines that carry a branch, fold the rest — the script of
//                 the function without its signature.

const hasStructure = (row, side) => (row.annot?.structure?.[side]?.length ?? 0) > 0;
const hasFlow = (row, side) => (row.annot?.flow?.[side]?.length ?? 0) > 0;

// The AST form of one line with the names taken away, and the NODE it starts
// with. The node is what a ribbon can be named after: `fun`, `block`, `return`,
// `if` — the same word the tree column shows.
const astOf = (row, side) => row?.annot?.ast?.[side] ?? "";
const astNode = (row, side) => (astOf(row, side).match(/^[^\s(]+/) ?? [""])[0];

// ── THE PARTS OF A DECLARATION ─────────────────────────────────────────────
//
// A block is one part of the declaration — `function name`, `external params`,
// `inside params`, `return type`. The labels come from the generator
// (`report/matchers/signature/declaration.js`), not from this file: a view that
// names things by looking for words in the row text labelled three object fields
// with the name of a parameter they do not declare.

const partsOf = (pair) => pair?.declaration ?? null;

// The name evidence the decision maker sent with the pair: the names both sides
// declare, and where each one is written. ONE accessor, so the two places that
// need it cannot drift.
export const nameEvidence = (pair) => {
	const names = pair?.analysis?.signature?.names ?? null;

	// `words` is what the function NAMES share (`resolve`, `element`): the same
	// evidence the caption prints, so the words it names are the words painted.
	return {
		common: names?.common ?? [],
		// The names that HAVE a lane on both sides (same kind, both directions). `common`
		// is only "declared by both" — `entries` is a property on one side and a parameter
		// on the other, and painting it claimed a match no ribbon draws.
		matched: names?.matched ?? names?.common ?? [],
		words: names?.words?.common ?? [],
		sites: names?.sites ?? { left: [], right: [] },
		// Name positions by COLUMN INDEX (the data layer provides it); consumers
		// that must not know left/right use this.
		byColumn: names?.byColumn ?? [names?.sites?.left ?? [], names?.sites?.right ?? []],
		// Shared words of each function name, with COLUMNS. Always an array; one
		// long name can hold 1 shared word or several.
		byColumnWords: names?.byColumnWords ?? [names?.wordSites?.left ?? [], names?.wordSites?.right ?? []],
	};
};

// Which COMMON names are DECLARED on a row, and what kind of name each is. The
// names and their lines come from the normalizer (`nameSites`), the "shared"
// decision from the signature matcher (`names.common`), so the view only joins
// two facts it was given.
//
// A name belongs to its declaration. `result` in `{ text: result }` is a value,
// and if it counts as a name there, it counts on a line that introduces nothing.
const sitesOn = (sites, no, common) => (no == null || !common.length ? [] : sites.filter((site) => site.line === no && common.includes(site.name)));

// `var-decl` and `prop` are different things to a reader: a variable name is a
// stronger duplicate signal than an object key. The label says which one, so
// consecutive rows of the same kind can merge into one ribbon and different kinds
// stay apart. The WORDS come with the site, from the syntax kind that made it.
const namesIn = (row, sites, common) => {
	if (!row) return { names: [], label: null };

	const hits = [...sitesOn(sites.left, row.left?.no, common), ...sitesOn(sites.right, row.right?.no, common)];
	const names = [...new Set(hits.map((site) => site.name))];
	const label = hits.map((site) => site.label).find(Boolean) ?? (names.length ? "names" : null);

	return { names, label };
};

const labelAt = (declaration, index) => {
	if (!declaration?.labels) return null;

	return declaration.labels[index] ?? null;
};

export const lensFor = (mode, rows, pair, expanded = false) => {
	if (mode === "signature") {
		const declaration = partsOf(pair);
		// A compared span is not always a declaration (an arrow body, a block, one
		// expression). Then this tab has nothing to fold and nothing to band: it
		// shows the code and leaves the marks alone. The same applies when the two
		// sides do not start on the same kind of line — a function head against an
		// anonymous arrow has no name to compare, and folding hid everything.
		const declared =
			declaration?.kind === "declaration" && Boolean(rows[0]?.left) && Boolean(rows[0]?.right);
		// One window for BOTH sides — otherwise the left folds 20 lines and the
		// right 11, and the two columns show unrelated rows.
		const end = declared ? declaration.end : rows.length - 1;
		// Names both sides use: a row that carries them IS a duplicate, so it is
		// shown and banded even though it sits below the declaration. That was the
		// whole gap — the signature matcher scores these names, so the tab must
		// show them.
		const { common, sites } = nameEvidence(pair);
		const shared = (index) => namesIn(rows[index], sites, common);
		const shares = (index) => shared(index).names.length > 0;

		// THE TONE IS A MONOTONIC FUNCTION OF THE MEASURED SCORE. The signature group
		// scored this pair (`analysis.signature.score`); a row that corresponds takes
		// `same` (red, duplicate) when that score is at least half, and `differs`
		// (green, the text breaks the correspondence) below it. The SAME threshold for
		// every pair, so a 50% match can never read "more unique" than a 33% one — the
		// old verdict painted the whole declaration span red regardless of the score,
		// which is exactly the "33% is a duplicate but 50% is unique?" contradiction.
		const score = pair?.analysis?.signature?.names?.score ?? (common.length > 0 ? 1 : 0);
		const tone = score >= 0.5 ? "same" : "differs";

		return {
			keep: (side, index) => expanded || index <= end || shares(index),
			fragments: true,
			same: (row, index) => (declared && index <= end && Boolean(row.left) && Boolean(row.right)) || shares(index),
			verdict: (row, index) =>
				(declared && index <= end) || rows[index]?.marks?.signature === "same" ? tone : "differs",
			// The label is the group: consecutive rows of the same part — including a
			// run of rows that declare the same kind of name — merge into ONE ribbon,
			// and a change of part starts a new one with a gap between them.
			group: (side, index) =>
				`${labelAt(declaration, index) ?? shared(index).label ?? "body"}|${rows[index]?.marks?.signature === "same" ? tone : "differs"}`,
		};
	}

	// A block is not "consecutive kept lines" — it is consecutive lines the matcher
	// sees the SAME way. Two neighbouring lines belong to one block only when the
	// constructs (or the flow steps) they carry are identical, so a declaration is
	// never glued to an `if`, and an `if` never to a `try`.
	if (mode === "structure") {
		return {
			keep: (side, index) => expanded || hasStructure(rows[index], side),
			fragments: false,
			group: (side, index) => [...(rows[index].annot?.structure?.[side] ?? [])].sort().join(","),
		};
	}

	if (mode === "controlFlow") {
		return {
			keep: (side, index) => expanded || hasFlow(rows[index], side),
			fragments: false,
			group: (side, index) => (rows[index].annot?.flow?.[side] ?? []).join(","),
		};
	}

	// The AST tab compares the expression tree node by node. A ribbon is therefore
	// one run of rows that carry the SAME node (`block`, `return`, `if` …) and get
	// the same verdict from this group — one shape is not glued to the next, so the
	// reader can name the pair of pieces a ribbon connects instead of guessing
	// which of the whole body matched which.
	return {
		keep: () => true,
		fragments: false,
		same: (row) => astOf(row, "left") !== "" && astOf(row, "left") === astOf(row, "right"),
		verdict: (row) => (row?.marks?.ast === "differs" ? "differs" : "same"),
		group: (side, index) => `${astNode(rows[index], side)}|${rows[index]?.marks?.ast === "differs" ? "differs" : "same"}`,
	};
};

// The visible items of one column: rows the lens keeps, and one folded marker
// for every run of rows it drops. Folding, not deleting — the reader still sees
// that something was skipped and how much.
export const itemsFor = (rows, side, lens) => {
	const items = [];
	let fold = null;

	const close = () => {
		if (fold) items.push(fold);
		fold = null;
	};

	rows.forEach((row, index) => {
		// A folded block the DATA carries is a marker of its own: the rows exist
		// under it, so it must appear in the column (and in the connection) where it
		// sits — collapsed, but present.
		if (row.type === "fold") {
			close();
			const inner = row.rows ?? [];
			items.push({
				kind: "fold",
				key: `f${index}`,
				from: index,
				to: index,
				count: inner.length || 1,
				comparable: inner.filter((child) => child.left && child.right).length,
			});
			return;
		}

		const visible = Boolean(row[side]) && lens.keep(side, index);

		if (visible) {
			close();
			items.push({ kind: "row", index, row });

			return;
		}
		if (fold) {
			fold.to = index;
			fold.count += 1;
			if (row.left && row.right) fold.comparable += 1;
		} else {
			fold = { kind: "fold", key: `f${index}`, from: index, to: index, count: 1, comparable: row.left && row.right ? 1 : 0 };
		}
	});
	close();

	return items;
};

// ── CAPTIONS ──────────────────────────────────────────────────────────────
//
// The caption of a block is NOT a piece of the source line. It is what the
// matcher said about that block: the parameters of the signature, the constructs
// it found, the steps of the flow. Copying the first line of the block only told
// the reader what the code already said, and told them nothing about why the
// block is here.

const unique = (list) => [...new Set(list)];

const unionOf = (rows, run, pick) => {
	const out = [];
	for (let index = run.from; index <= run.to; index += 1) out.push(...pick(rows[index]));

	return unique(out);
};

const short = (text, limit = 40) => (text.length > limit ? `${text.slice(0, limit)}…` : text);

// Which parameter DECLARES this block. Walking up from the block until a
// parameter name appears is the only thing the model allows: it says what the
// parameters are, not which lines they start on.
export const captionFor = (mode, rows, run, pair) => {
	if (mode === "signature") {
		const model = pair?.analysis?.signature ?? null;
		const leftName = model?.left?.name ?? "";
		const rightName = model?.right?.name ?? "";
		// The label the generator gave the first row of this block. The view adds
		// nothing to it: a row below the declaration is captioned with the KIND of
		// name the matcher found on both sides — `variable names` reads differently
		// from `property names`, because it is a different claim.
		const { common, sites } = nameEvidence(pair);
		const names = [];
		for (let index = run.from; index <= run.to; index += 1) names.push(...namesIn(rows[index], sites, common).names);
		const uniqueNames = [...new Set(names)];
		const kind = namesIn(rows[run.from], sites, common).label;
		const label = labelAt(partsOf(pair), run.from) ?? (kind ? `${kind} · ${uniqueNames.length} shared` : "body");

		if (label !== "function name") return label;

		// What the names have in common, said plainly. `handleGetConsole ≠
		// handleSearchConsole` alone left the reader asking "and what is shared
		// then?" — the shared words are the answer, and they are already in the
		// model, in order.
		const { words } = nameEvidence(pair);

		return short(words.length ? `${label} · common: ${words.join(" + ")}` : `${label} · no common words`, 58);
	}

	if (mode === "structure") {
		const kinds = unionOf(rows, run, (row) => row.annot?.structure?.left ?? []);

		return kinds.length ? short(kinds.join(" · ")) : "no construct";
	}

	if (mode === "controlFlow") {
		const steps = unionOf(rows, run, (row) => row.annot?.flow?.left ?? []);

		return steps.length ? short(steps.join(" → ")) : "no branch";
	}

	if (mode === "ast") {
		const nodes = unionOf(rows, run, (row) => (astNode(row, "left") ? [astNode(row, "left")] : []));

		return nodes.length ? short(nodes.join(" · ")) : "no node";
	}

	return "";
};
