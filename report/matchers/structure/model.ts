"use strict";

// ── STRUCTURE MATCHER · the model ───────────────────────────────────────────
//
// What group 2 compares: HOW MANY of each construct a body is built from — five
// calls, one `if`, two `return`s. Not "does it have a `try`" but "does it have
// as many `try`s": a body with three branches is not the shape of a body with
// one, and presence alone could not say that.
//
// The same arithmetic the engine scores: `sum(min) / sum(max)` over the kinds,
// counted per ROW. Each kind also carries the lines it is written on, per side,
// because a count a reader cannot locate is not evidence.

import { STRUCTURAL_KINDS } from "../../../constants";

const sitesOf = (tree, out = new Map()) => {
	if (!tree) return out;
	if (STRUCTURAL_KINDS.has(tree.kind)) {
		const list = out.get(tree.kind) ?? [];
		// ONE SITE PER ROW: two calls written on one line are one row of the diff,
		// so they are one block here too — the board and this text count the same.
		if (tree.start != null && !list.includes(tree.start)) list.push(tree.start);
		out.set(tree.kind, list);
	}

	for (const child of tree.children ?? []) sitesOf(child, out);

	return out;
};

const build = (leftCandidate, rightCandidate) => {
	if (!leftCandidate || !rightCandidate) return null;
	const leftSites = sitesOf(leftCandidate.tree);
	const rightSites = sitesOf(rightCandidate.tree);
	const kinds = [...new Set([...leftSites.keys(), ...rightSites.keys()])].sort();

	let shared = 0;
	let total = 0;
	const counts = kinds.map((kind) => {
		const left = leftSites.get(kind)?.length ?? 0;
		const right = rightSites.get(kind)?.length ?? 0;
		shared += Math.min(left, right);
		total += Math.max(left, right);

		return { kind, left, right };
	});

	return {
		kinds,
		counts,
		leftSites,
		rightSites,
		sharedCount: shared,
		totalCount: total,
		// The number the verdict uses: identical counts everywhere is 1, one kind
		// present twice on one side and once on the other drags it down.
		score: total === 0 ? 1 : shared / total,
	};
};

// The same vocabulary, without the candidate: the line walk is the only part of
// the model that needs a body.
const kindsOf = (tree, set = new Set()) => {
	if (!tree) return set;
	if (STRUCTURAL_KINDS.has(tree.kind)) set.add(tree.kind);
	for (const child of tree.children ?? []) kindsOf(child, set);

	return set;
};

export {  build, kindsOf, sitesOf  };
