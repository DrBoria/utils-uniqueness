"use strict";

import { CODE, FILTER } from "../constants";

// If the candidate already calls the canonical function (or vice versa), the
// relationship is composition, not duplication — the candidate is reusing the
// canonical, which is the desired outcome.
//
// The filter states a CODE, not a sentence: the wording lives in
// `report/errorTypes/codes`, so the terminal report, the page and any future
// consumer say the same thing about the same dismissal.
const test = (match) => {
	const appCalls = new Set(match.app.calls || []);
	const canonCalls = new Set(match.canon.calls || []);
	if (appCalls.has(match.canon.name)) {
		return { code: CODE.Composition, params: { local: match.app.name, other: match.canon.name } };
	}
	if (canonCalls.has(match.app.name)) {
		return { code: CODE.CompositionReverse, params: { local: match.app.name, other: match.canon.name } };
	}

	return null;
};

export const name = FILTER.DropUsages;
export { test };
