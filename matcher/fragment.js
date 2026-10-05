"use strict";

const { distinctiveRatio } = require("../signature");
const { indexOfRecord } = require("./jscpd");

const fragmentPairs = (records, jscpdPairs, thresholds) => {
	const out = [];
	const frag = thresholds.jscpd.fragment;
	const seen = new Set();
	for (const p of jscpdPairs) {
		if ((p.a.tokens || 0) < (frag.minTokens || 35)) continue;
		const aLines = p.a.endLine - p.a.line + 1;
		if (aLines < (frag.minLines || 4)) continue;
		const text = (p.a.lines || []).join("\n");
		const ratio = distinctiveRatio(text);
		if (ratio < (frag.minDistinctiveRatio || 0.35)) continue;
		const ia = indexOfRecord(records, p.a.path, p.a.line, p.a.endLine);
		const ib = indexOfRecord(records, p.b.path, p.b.line, p.b.endLine);
		if (ia < 0 || ib < 0) continue;
		const a = records[ia];
		const b = records[ib];
		const key = [a.path, a.line, b.path, b.line].sort().join("::");
		if (seen.has(key)) continue;
		seen.add(key);
		out.push([a, b]);
	}
	return out;
};

module.exports = { fragmentPairs };
