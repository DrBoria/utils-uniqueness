"use strict";

const { jaccard } = require("../signature");

const isVoidLike = (s) => !s || s === "?" || s === "void" || s === "undefined" || s === "null";

const carries = (rec, thresholds) =>
	(rec.bodyTokenCount || 0) >= (thresholds.bodyMinParams || 1) || !isVoidLike(rec.returns);

const bodyPairs = (records, thresholds) => {
	const out = [];
	const byName = new Map();
	for (const r of records) {
		const list = byName.get(r.name) || [];
		list.push(r);
		byName.set(r.name, list);
	}
	for (const list of byName.values()) {
		if (list.length < 2) continue;
		for (let i = 0; i < list.length; i += 1) {
			for (let j = i + 1; j < list.length; j += 1) {
				const a = list[i];
				const b = list[j];
				if (!carries(a, thresholds) || !carries(b, thresholds)) continue;
				const sim = jaccard(a.bodyTokens || [], b.bodyTokens || []);
				if (sim >= (thresholds.bodyMinRatio || 0.6)) {
					out.push([a, b]);
				}
			}
		}
	}
	return out;
};

module.exports = { bodyPairs };
