"use strict";

// ── EVIDENCE, NOT SHARE ─────────────────────────────────────────────────────
//
// A share answers "how much of what I compared matched"; it says 100% for one
// matching parameter out of one, and a decision maker that reads shares is as
// sure about that as about fifty matching AST nodes out of fifty-five. Evidence
// answers a different question: "how sure am I, given what I compared, that this
// is a duplicate".
//
// Each matched item is one piece of evidence with a RELIABILITY: how much a
// single match of that kind tells you. Evidence accumulates like independent
// observations — `1 - (1 - w)^matched` — so it never reaches certainty from one
// item, and it keeps climbing with every further match.
//
// Unmatched items are counter-evidence: the same evidence is scaled by how much
// of the compared material it actually covers (0.5 … 1).

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * ONE coefficient per group. A row and its group are the SAME arithmetic: a row is
 * `1 - (1 - w)^items_of_that_row`, the group is `1 - (1 - w)^all_items`. So the
 * group is never smaller than its rows, and it is literally the sum of what they
 * observed — no hidden second coefficient.
 */
const GROUP_WEIGHT = Object.freeze({ signature: 0.2, ast: 0.06, structure: 0.12, controlFlow: 0.15 });

/** How much ONE match of this kind tells you that it is a duplicate. */
const RELIABILITY = Object.freeze({
	// A NAME is the weakest thing two functions can share: `key`, `value`, `type` are in
	// every body, so one name is one small observation and twenty of them still have to
	// be confirmed by types and by the return. A whole shared function name is worth
	// more, a single word of a name much less.
	function: 0.2,
	param: 0.1,
	prop: 0.06,
	assign: 0.06,
	"var-decl": 0.08,
	return: 0.22,
	name: 0.15,
	node: 0.06,
	kind: 0.1,
	effect: 0.2,
	flow: 0.1,
	subtree: 0.1,
	// Signature's own pieces: a shared parameter TYPE and a shared RETURN TYPE say
	// more than one shared name, and one shared WORD of a function name says less
	// than the whole name — two names can share `create` and be nothing alike.
	type: 0.18,
	returnType: 0.25,
	"name-word": 0.05,
	// A callback's parameter is a name the body introduces, not part of the interface:
	// `([key, value])` in a `map` says nothing about how the function is called.
	"callback-param": 0.04,
});

/** 1 - (1 - w)^matched: each further match adds LESS than the previous one. */
const saturate = (matched, weight) => 1 - Math.pow(1 - clamp01(weight), Math.max(0, matched));

/**
 * Evidence of `matched` items of a kind.
 *
 * It is the SATURATION and nothing else: 45 and 55 matching items differ by a
 * fraction of a percent, not by their ratio — the difference between them is not
 * the difference between 100% and 82%, because neither of them is certainty. What
 * `total` adds is only the check that a kind was compared at all.
 */
const evidenceOf = (matched, total, weight) => (total > 0 ? saturate(matched, weight) : 0);

/** Independent pieces of evidence add up: 1 - Π(1 - e). */
const combine = (pieces) => clamp01(1 - pieces.reduce((rest, piece) => rest * (1 - clamp01(piece)), 1));

/**
 * The group's number, read straight off its rows: each row's confidence counted
 * as many times as it has items. A row with one node is one observation among
 * many, so a stack of `1 / 1` rows cannot outvote a single `20 / 20` one.
 */
const meanOf = (rows) => {
	let weighted = 0;
	let weight = 0;
	for (const row of rows) {
		weighted += row.confidence * row.count;
		weight += row.count;
	}

	return weight === 0 ? 0 : clamp01(weighted / weight);
};

/**
 * A percent that can APPROACH 100 but never say it: evidence is asymptotic, so
 * `0.99999` prints `99.9`, not `100`.
 */
const percentOf = (value) => {
	const pct = clamp01(value) * 100;
	if (pct >= 99) return (Math.floor(pct * 10) / 10).toFixed(1);

	return String(Math.round(pct));
};

/** One group's confidence, weighted by how much the group matters overall. */
const weighed = (evidence, weight, groups) => (weight > 0 ? 1 - Math.pow(1 - clamp01(evidence), weight * groups) : 0);

/**
 * ── HOW MUCH OF A PIECE CORRESPONDS ────────────────────────────────────────
 *
 * A piece is not a yes/no: `createSomeAdapter` against `createPlainAdapter` is the
 * same shape, not the same name, and five calls against thirteen is not "both call".
 * So a piece carries a CORRESPONDENCE — matched / total — and that number is a
 * MULTIPLIER on its evidence, not a caption nobody uses:
 *
 *   · 1.00 — the piece corresponds exactly; it counts in full and prints no number,
 *            because a 100% label on every row is noise;
 *   · 0.5…1 — it corresponds partly; it counts with its share, and the row states %;
 *   · below 0.5 — it does not correspond; it is not counted and not drawn.
 */
const correspondence = (matched, total) => (total > 0 ? clamp01(matched / total) : 0);

/** Below this share a piece is not a correspondence at all. */
const MIN_CORRESPONDENCE = 0.5;

/** Evidence of a piece, multiplied by how much of it corresponds. */
const pieceEvidence = (matched, total, weight) => {
	const share = correspondence(matched, total);

	return share < MIN_CORRESPONDENCE ? 0 : saturate(matched, weight) * share;
};

/** The caption a piece prints: its name alone at 100%, `name · NN%` when it differs. */
const pieceWord = (word, matched, total) => {
	const share = correspondence(matched, total);

	return share >= 1 ? word : `${word} · ${percentOf(share)}%`;
};

module.exports = { RELIABILITY, GROUP_WEIGHT, clamp01, saturate, evidenceOf, combine, meanOf, weighed, percentOf, correspondence, MIN_CORRESPONDENCE, pieceEvidence, pieceWord };
