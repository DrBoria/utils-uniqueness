"use strict";

const { CODE, FILTER } = require("../constants");

const { MIN_STRUCTURE_NODES } = require("../constants");

// A body with almost no structure (a bare return / passthrough) is not a
// meaningful duplication target — dropping it avoids flagging trivial
// one-liners that merely look alike.
//
// The filter states a CODE (`trivialBody`) plus its parameters; the sentence is
// rendered by the shared vocabulary for every surface that shows it.
const test = (match) => {
	const app = match.app;
	if (app.nodes < MIN_STRUCTURE_NODES && !app.structure.present) {
		return { code: CODE.TrivialBody, params: { name: match.app.name, nodes: app.nodes } };
	}

	return null;
};

module.exports = { name: FILTER.DropNoStructure, test };
