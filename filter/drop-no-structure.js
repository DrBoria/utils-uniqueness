"use strict";

const MIN_NODES = 6;

// A body with almost no structure (a bare return / passthrough) is not a
// meaningful duplication target — dropping it avoids flagging trivial
// one-liners that merely look alike.
const test = (match) => {
	const app = match.app;
	if (app.nodeCount < MIN_NODES && !app.hasStructure) {
		return `${match.app.name} is a trivial body (${app.nodeCount} nodes) — not a meaningful duplicate`;
	}
	return null;
};

module.exports = { name: "drop-no-structure", test };
