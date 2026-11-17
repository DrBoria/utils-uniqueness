"use strict";

// ── CONTROL-FLOW MATCHER · the model ────────────────────────────────────────
//
// The question this group answers: which RUN of blocks happens in the same order
// on both sides — `call, call, return, try, catch`. Not the bag (that is
// structure) and not the kinds of nodes (that is AST).
//
// The run is weighted by RARITY, exactly as the engine scores it: a `var` is in
// every function and proves little, a `try`/`catch` or a `var-destr` is rare and
// proves a lot.

import { weightsOf, alignSteps, keysOf } from "../../../matcher/control-flow";
import { RELIABILITY, saturate, combine } from "../../../evidence";

const build = (leftCandidate, rightCandidate) => {
	if (!leftCandidate || !rightCandidate) return null;
	// The SAME list the board numbers (`sequenceSites`, in row order), aligned by the same
	// walk the score uses. Three places, one rule: the middle column, the verdict and the
	// console line cannot disagree — keysOf is the matcher's own, imported above.
	const left = keysOf(leftCandidate);
	const right = keysOf(rightCandidate);
	const weight = weightsOf(left, right);
	// THE NUMBERED RUN: the steps both sides walk in the same order, keeping the numbering
	// after a step that does not line up. The SAME rarity weights the score uses: a rare
	// step outranks a frequent one, so `if`/`return` anchor the run before `var`/`call`.
	const pairs = alignSteps(left, right, weight);
	const run = pairs.length;
	const kinds = pairs.map(([at]) => left[at]);
	const sumOf = (list) => list.reduce((sum, kind) => sum + (weight.get(kind) ?? 1), 0);
	const value = sumOf(kinds);
	const total = Math.max(sumOf(left), sumOf(right));
	const score = combine([saturate(run, RELIABILITY.flow), total === 0 ? 0 : value / total]);

	return {
		left,
		right,
		run,
		kinds,
		score,
		// The run as `kind ×n` runs, so a reader sees `call ×2, return, try`.
		runs: kinds.reduce((list, kind) => {
			const last = list[list.length - 1];
			if (last && last.kind === kind) last.count += 1;
			else list.push({ kind, count: 1 });

			return list;
		}, []),
		weight: value,
		totalWeight: total,
	};
};

export {  build  };
