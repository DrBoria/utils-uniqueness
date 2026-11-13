"use strict";

const { ROW, DIFF_CONTEXT, MAX_WORD_TOKENS, WORD_TOKEN_RE } = require("../../../constants");

// The diff engine behind the viewer.
//
// Two levels, the same split WebStorm makes:
//   LINE  — an LCS over the two bodies, so a moved/renamed line is shown as a
//           change at the same row instead of a delete+add block;
//   WORD  — inside a changed row, an LCS over tokens, so the reader sees the
//           ONE identifier that differs (``money`` vs ``cash``) instead of two
//           fully-red lines.
//
// Unchanged runs are FOLDED (`{ type: "fold", rows }`), exactly like the diff
// viewer's collapsible sections: the reader opens the middle of a long identical
// body only when they want to.
//
// Nothing here knows about utilities, verdicts or the report — it takes two
// arrays of lines and returns rows. That makes it testable on its own and
// reusable by the nested "called function" diffs.



// Tokenize a line into words / runs of space / single punctuation marks. The
// separators are kept, so joining the tokens of a row gives the line back.


const splitTokens = (text) => String(text ?? "").match(WORD_TOKEN_RE) ?? [];

// Classic LCS table. Bodies are small (tens of lines), so the O(n·m) table is
// cheaper than any cleverer algorithm and impossible to get subtly wrong.
const lcsMatrix = (a, b) => {
	const rows = a.length + 1;
	const cols = b.length + 1;
	const table = new Uint16Array(rows * cols);
	for (let i = 1; i < rows; i += 1) {
		for (let j = 1; j < cols; j += 1) {
			table[i * cols + j] = a[i - 1] === b[j - 1] ? table[(i - 1) * cols + (j - 1)] + 1 : Math.max(table[(i - 1) * cols + j], table[i * cols + (j - 1)]);
		}
	}

	// The path back through the table: `equal` where the two items matched,
	// otherwise the direction with the larger prefix count.
	const ops = [];
	let i = a.length;
	let j = b.length;
	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
			ops.push({ type: ROW.Equal, left: i - 1, right: j - 1 });
			i -= 1;
			j -= 1;
		} else if (j > 0 && (i === 0 || table[i * cols + (j - 1)] >= table[(i - 1) * cols + j])) {
			ops.push({ type: ROW.Add, right: j - 1 });
			j -= 1;
		} else {
			ops.push({ type: ROW.Remove, left: i - 1 });
			i -= 1;
		}
	}

	return ops.reverse();
};



// Word-level diff of one changed row: both sides get their tokens split into
// `{ text, changed }` segments so the UI can underline only what differs.
const diffWords = (leftText, rightText) => {
	const left = splitTokens(leftText);
	const right = splitTokens(rightText);
	if (left.length > MAX_WORD_TOKENS || right.length > MAX_WORD_TOKENS) {
		return {
			left: [{ text: String(leftText ?? ""), changed: true }],
			right: [{ text: String(rightText ?? ""), changed: true }],
		};
	}

	const ops = lcsMatrix(left, right);
	const outLeft = [];
	const outRight = [];
	const push = (arr, text, changed) => {
		const last = arr[arr.length - 1];
		if (last && last.changed === changed) last.text += text;
		else arr.push({ text, changed });
	};
	for (const op of ops) {
		if (op.type === ROW.Equal) {
			push(outLeft, left[op.left], false);
			push(outRight, right[op.right], false);
		} else if (op.type === "remove") {
			push(outLeft, left[op.left], true);
		} else {
			push(outRight, right[op.right], true);
		}
	}

	return { left: outLeft, right: outRight };
};

const lineRow = (type, leftNo, leftText, rightNo, rightText) => {
	const row = { type };
	if (leftNo != null) row.left = { no: leftNo, text: leftText ?? "" };
	if (rightNo != null) row.right = { no: rightNo, text: rightText ?? "" };
	if (type === ROW.Change) {
		const words = diffWords(leftText, rightText);
		// A row's text is stored ONCE: the segments are the text, split. Keeping
		// both `text` and `words` doubled the page size on a real run.
		row.left.words = words.left;
		row.right.words = words.right;
		delete row.left.text;
		delete row.right.text;
	}
	if (type !== ROW.Equal && type !== ROW.Change) {
		// A one-sided row has nothing to compare against: the whole line is the
		// changed segment.
		if (row.left) {
			row.left.words = [{ text: row.left.text, changed: true }];
			delete row.left.text;
		}
		if (row.right) {
			row.right.words = [{ text: row.right.text, changed: true }];
			delete row.right.text;
		}
	}

	return row;
};

// Turn an op list into rows, pairing a run of removes with the run of adds that
// follows it (that is what makes a changed line a `change` row rather than a
// red line above a green line).
const toRows = (ops, leftLines, rightLines, leftOffset, rightOffset) => {
	const rows = [];
	let k = 0;
	while (k < ops.length) {
		const op = ops[k];
		if (op.type === ROW.Equal) {
			rows.push(lineRow(ROW.Equal, op.left + leftOffset, leftLines[op.left], op.right + rightOffset, rightLines[op.right]));
			k += 1;
		} else {
			const removes = [];
			const adds = [];
			while (k < ops.length && ops[k].type === ROW.Remove) removes.push(ops[k++]);
			while (k < ops.length && ops[k].type === ROW.Add) adds.push(ops[k++]);
			const paired = Math.min(removes.length, adds.length);
			for (let n = 0; n < paired; n += 1) {
				rows.push(lineRow(ROW.Change, removes[n].left + leftOffset, leftLines[removes[n].left], adds[n].right + rightOffset, rightLines[adds[n].right]));
			}
			for (let n = paired; n < removes.length; n += 1) {
				rows.push(lineRow(ROW.Remove, removes[n].left + leftOffset, leftLines[removes[n].left], null, null));
			}
			for (let n = paired; n < adds.length; n += 1) {
				rows.push(lineRow(ROW.Add, null, null, adds[n].right + rightOffset, rightLines[adds[n].right]));
			}
		}
	}

	return rows;
};

// Fold long runs of equal rows: keep `DIFF_CONTEXT` at both ends of the run, hide the
// rest behind one `fold` row that carries the hidden rows themselves (the UI
// expands it locally, no server, no second file).
const foldEqualRuns = (rows) => {
	const out = [];
	let k = 0;
	while (k < rows.length) {
		if (rows[k].type !== ROW.Equal) {
			out.push(rows[k]);
			k += 1;
			continue;
		}

		let end = k;
		while (end < rows.length && rows[end].type === ROW.Equal) end += 1;
		const run = rows.slice(k, end);
		if (run.length <= DIFF_CONTEXT * 2 + 1) {
			out.push(...run);
			k = end;
			continue;
		}
		out.push(...run.slice(0, DIFF_CONTEXT));
		out.push({ type: ROW.Fold, rows: run.slice(DIFF_CONTEXT, run.length - DIFF_CONTEXT) });
		out.push(...run.slice(run.length - DIFF_CONTEXT));
		k = end;
	}

	return out;
};

// `left`/`right` are `{ startLine, lines: [{ no, text }] }`.
const diffSpans = (left, right) => {
	const leftTexts = left.lines.map((l) => l.text);
	const rightTexts = right.lines.map((l) => l.text);
	const ops = lcsMatrix(leftTexts, rightTexts);
	const rows = toRows(ops, leftTexts, rightTexts, left.startLine, right.startLine);

	return { rows: foldEqualRuns(rows), counts: countRows(rows) };
};

const countRows = (rows) => ({
	added: rows.filter((r) => r.type === ROW.Add).length,
	removed: rows.filter((r) => r.type === ROW.Remove).length,
	changed: rows.filter((r) => r.type === ROW.Change).length,
	equal: rows.filter((r) => r.type === ROW.Equal).length,
});

module.exports = { diffSpans, diffWords, foldEqualRuns, lcsMatrix, countRows, splitTokens, DIFF_CONTEXT };
