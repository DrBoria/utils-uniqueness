"use strict";

const path = require("node:path");

const indexOfRecord = (records, file, startLine, endLine) => {
	const norm = (p) => p.replace(/\\/g, "/");
	const nf = norm(file);
	const idx = records.findIndex((r) => {
		const np = norm(r.path);
		return (np === nf || np.endsWith(`/${nf}`) || nf.endsWith(`/${np}`)) && r.line <= startLine && endLine <= (r.endLine || r.line);
	});
	return idx;
};

const wholePairs = (records, jscpdPairs, thresholds) => {
	const out = [];
	const whole = thresholds.jscpd.whole;
	for (const p of jscpdPairs) {
		const ia = indexOfRecord(records, p.a.path, p.a.line, p.a.endLine);
		const ib = indexOfRecord(records, p.b.path, p.b.line, p.b.endLine);
		if (ia < 0 || ib < 0) continue;
		const a = records[ia];
		const b = records[ib];
		const aLen = a.endLine - a.line + 1;
		const bLen = b.endLine - b.line + 1;
		const aCov = (p.a.endLine - p.a.line + 1) / aLen;
		const bCov = (p.b.endLine - p.b.line + 1) / bLen;
		if (aCov >= (whole.minCoverage || 0.5) && bCov >= (whole.minCoverage || 0.5)) {
			out.push([a, b]);
		}
	}
	return out;
};

module.exports = { wholePairs, indexOfRecord };
