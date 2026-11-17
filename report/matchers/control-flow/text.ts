"use strict";

// ── CONTROL-FLOW MATCHER · the CLI/markdown text ────────────────────────────
//
// The heaviest run of identical blocks, in order, with its weight. Not "3 of 27
// steps line up" — a step that lines up somewhere else is not a run.

import { PHRASES } from "./phrases";
import { fill } from "../../errorTypes/vocabulary/phrases";
import { flowWord } from "../../../constants";

const text = (model) => {
	if (!model) return [];
	if (model.kinds.length === 0) return [PHRASES.empty];

	const chain = model.runs.map((run) => fill(PHRASES.block, { kind: flowWord(run.kind), count: run.count })).join(", ");
	// ONE LINE PER FILE. The RUN is numbered exactly as the middle column numbers it
	// (1..run); the steps after the break are listed WITHOUT numbers, because the board
	// does not number them either.
	const steps = (list) => {
		const head = list.slice(0, model.kinds.length).map((kind, at) => `${at + 1} ${flowWord(kind)}`).join(" · ");
		const tail = list.slice(model.kinds.length);

		return tail.length === 0 ? head : `${head} → ${tail.map(flowWord).join(" · ")}`;
	};

	return [
		fill(PHRASES.run, {
			score: Math.round(model.score * 100) / 100,
			chain,
		}),
		fill(PHRASES.sequence, { side: "local", steps: steps(model.left) }),
		fill(PHRASES.sequence, { side: "canonical", steps: steps(model.right) }),
	];
};

export {  text  };
