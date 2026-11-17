"use strict";

// ── THE MODEL OF A PAIR ───────────────────────────────────────────────────
//
// The blocks are NOT the diff engine's hunks and NOT "lines that happen to sit
// next to each other". They are the units the DECISION MAKER compared: every
// row carries `marks[signal]` — the verdict of one matcher on the pair of cells
// in that row (`same` / `differs`). A block is a maximal run of consecutive
// rows that the selected matcher calls `same`.
//
// Everything else — a cell the matcher calls `differs`, a cell with one side
// only, a cell the matcher says nothing about — is not a correspondence: it is
// printed, but not tinted and not joined by a band. That is the whole rule.

export const textOf = (side) =>
	side?.words ? side.words.map((word) => word.text).join("") : (side?.text ?? "");

export const rowsOf = (pair) => (pair?.rows ?? []).filter((row) => row.type !== "fold");

const labelOf = (text) => {
	const flat = String(text ?? "").trim().replace(/\s+/g, " ");

	if (flat === "") return "(blank)";

	return flat.length > 28 ? `${flat.slice(0, 28)}…` : flat;
};

export const buildRuns = (rows, signal, lens) => {
	const runs = [];
	let current = null;

	rows.forEach((row, index) => {
		// A lens may state the correspondence itself — the signature lens does,
		// because its unit is the declaration, not one line's verdict.
		const same = lens?.same ? lens.same(row, index) : Boolean(row.left) && Boolean(row.right) && row.marks?.[signal] === "same";
		// Two lines are the same block only if the matcher reads them the same way.
		const group = lens?.group ? lens.group("left", index) : "all";
		// A lens may also say what the correspondence LOOKS like: the signature
		// tab joins the name and every parameter whether they match or not, and
		// the ribbon says which case it is with its colour.
		const verdict = lens?.verdict ? lens.verdict(row, index) : "same";
		const continues = current && current.group === group;

		if (!same) {
			current = null;

			return;
		}
		if (continues) {
			current.to = index;
			if (verdict === "differs") current.tone = "differs";
		} else {
			current = { id: `run${runs.length}`, from: index, to: index, signal, group, tone: verdict === "differs" ? "differs" : "same" };
			runs.push(current);
		}
	});

	// The neck used to sit in the middle of every block, so all ribbons crossed
	// on one horizontal line. An even block hangs its label from the top, an odd
	// one from the bottom: the crossings spread out and stay readable.
	return runs.map((run, index) => ({
		...run,
		anchor: index % 2 === 0 ? "top" : "bottom",
		label: labelOf(textOf(rows[run.from].left)),
	}));
};

// Which run a row belongs to, per side — the renderer uses it to decide whether
// a line is tinted and which band it carries.
export const runIndex = (rows, runs) => {
	const map = { left: new Map(), right: new Map() };
	for (const run of runs) {
		for (let i = run.from; i <= run.to; i += 1) {
			map.left.set(i, run.id);
			map.right.set(i, run.id);
		}
	}

	return map;
};
