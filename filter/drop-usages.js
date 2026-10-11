"use strict";

// If the candidate already calls the canonical function (or vice versa), the
// relationship is composition, not duplication — the candidate is reusing the
// canonical, which is the desired outcome.
const test = (match) => {
	const appCalls = new Set(match.app.calls || []);
	const canonCalls = new Set(match.canon.calls || []);
	if (appCalls.has(match.canon.name)) {
		return `${match.app.name} calls ${match.canon.name} (composition, not a duplicate)`;
	}
	if (canonCalls.has(match.app.name)) {
		return `${match.canon.name} calls ${match.app.name} (composition, not a duplicate)`;
	}
	return null;
};

module.exports = { name: "drop-usages", test };
