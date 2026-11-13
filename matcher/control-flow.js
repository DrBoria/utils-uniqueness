"use strict";

// ---------------------------------------------------------------------------
// Group 4 — Control flow.
//
// The question is the RUN, not the bag: which blocks happen in the same order,
// one after another, on both sides — `call, call, return, try, catch, var-destr`.
//
// Two bodies that both call something are not the same body; two bodies that
// walk the same chain of blocks are. And the chain is weighted by RARITY: a
// `var` is in every function and proves little, a `try`/`catch` or a
// `var-destr` is rare and proves a lot. The weights are the edge weights of the
// graph, and the best chain is the heaviest path through the aligned sequences.
//
// The alignment is the classic longest-common-run recurrence: a block extends
// the chain only when it follows the SAME block on both sides.
// ---------------------------------------------------------------------------

const { RELIABILITY, saturate, combine } = require("../evidence");
const { flowRarity } = require("../constants");

// Rarer kind → heavier edge. The ORDER is the vocabulary's (`constants →
// FLOW_RARITY`), not something read off these two bodies: the same step must
// weigh the same in every pair, or two runs of the same shape would score
// differently depending on what else the functions happen to contain.
const weightsOf = (left, right) => {
	const weight = new Map();
	for (const kind of [...left, ...right]) weight.set(kind, flowRarity(kind));

	return weight;
};

const weightSum = (kinds, weight) => kinds.reduce((sum, kind) => sum + (weight.get(kind) ?? 1), 0);

/**
 * WHICH steps correspond: the LONGEST run of the same steps in the same order.
 *
 * Not "from the first step": a body may open with `const` while the other opens with
 * `if` and still walk ten identical steps afterwards. Not a bare index-by-index walk
 * either: one extra step on one side would throw every step below it out of alignment.
 * The run is the longest, and where two runs are equally long the RARER one wins —
 * `try` is worth more than `var`.
 *
 * This walk is the ONE rule: the board reads it for its numbers, the matcher and the
 * console read it for the score, so a numbered step is always a counted step.
 */
const alignSteps = (left, right, weight = null) => {
	const rows = left.length + 1;
	const cols = right.length + 1;
	const worth = (kind) => (weight ? (weight.get(kind) ?? 1) : 1);
	const value = Array.from({ length: rows }, () => new Array(cols).fill(0));
	for (let i = 1; i < rows; i += 1) {
		for (let j = 1; j < cols; j += 1) {
			value[i][j] =
				left[i - 1] === right[j - 1]
					? value[i - 1][j - 1] + worth(left[i - 1])
					: Math.max(value[i - 1][j], value[i][j - 1]);
		}
	}
	const pairs = [];
	let i = left.length;
	let j = right.length;
	while (i > 0 && j > 0) {
		if (left[i - 1] === right[j - 1]) {
			pairs.push([i - 1, j - 1]);
			i -= 1;
			j -= 1;
			continue;
		}
		if (value[i - 1][j] >= value[i][j - 1]) i -= 1;
		else j -= 1;
	}

	return pairs.reverse();
};

const matchControlFlow = (candidate, canon, reliability = {}) => {
	// The SAME list the board numbers: the sites, in row order. `sequence` is the same
	// walk without positions, so a board and a score built from different lists would
	// number one thing and count another.
	const keysOf = (source) => {
		const sites = [...(source?.controlFlow?.sequenceSites ?? [])].sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0));
		const keys = sites.map((site) => `${site.path}/${site.kind}`);

		return keys.length > 0 ? keys : [...(source?.controlFlow?.sequence ?? [])];
	};
	const left = keysOf(candidate);
	const right = keysOf(canon);
	const weight = weightsOf(left, right);

	// ── THE CRITERION IS THE RUN ────────────────────────────────────────────
	//
	// The board writes ONE number per step: how many steps both sides walk IN THE SAME
	// ORDER, and KEEPS numbering after a step that does not line up. That numbering is
	// the score: the board and the verdict count the same steps.
	const pairs = alignSteps(left, right, weight);
	const runKinds = pairs.map(([at]) => left[at]);
	const runWeight = weightSum(runKinds, weight);
	const total = Math.max(weightSum(left, weight), weightSum(right, weight));
	const share = total === 0 ? 0 : runWeight / total;
	// Evidence of the run itself, combined with how much of the bodies it covers: one
	// step is a weak observation, a chain of ten is an order.
	const score = combine([saturate(pairs.length, reliability.flow ?? RELIABILITY.flow), share]);

	return {
		score,
		evidence: {
			run: pairs.length,
			runWeight: Math.round(runWeight * 100) / 100,
			flowWeight: Math.round(total * 100) / 100,
			runKinds,
			candidateFlow: left,
			canonicalFlow: right,
		},
	};
};

module.exports = { matchControlFlow, weightsOf, alignSteps };
