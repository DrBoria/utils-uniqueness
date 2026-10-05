"use strict";

const { filter } = require("remeda");

const minBodyTokensFilter = (records, thresholds) =>
	filter(records, (r) => (r.bodyTokenCount || 0) >= (thresholds.minBodyTokens || 8));

module.exports = { minBodyTokensFilter };
