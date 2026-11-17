"use strict";

// ── STRUCTURE · ONE COUNT, ONE PERCENT ──────────────────────────────────────
//
// Structure does not ask "does the body have a call" — it asks HOW MANY. So the
// number for a kind is the share of the larger side the smaller side covers:
// five calls against eight are `5/8`, not "both call something".
//
// The board and the CLI both read this one function: a lane caption and a line
// of the terminal report cannot disagree about `${matched}/${total}`.

import { percentOf, correspondence } from "../../../evidence";

const countOf = (left, right) => {
	const matched = Math.min(left, right);
	const total = Math.max(left, right);
	const share = total === 0 ? 0 : correspondence(matched, total);

	return { matched, total, share, percent: percentOf(share) };
};

// `call · 38%`, and just `call` when the counts are the same: a row that corresponds
// exactly does not need a number, and `5 / 7` was a count nobody could use.
const countLabel = (kind, left, right) => {
	const count = countOf(left, right);
	if (count.matched === 0) return kind;

	return count.matched === count.total ? kind : `${kind} · ${count.percent}%`;
};

export {  countOf, countLabel  };
