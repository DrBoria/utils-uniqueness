"use strict";

const { map } = require("remeda");

const isVoidLike = (s) => !s || s === "?" || s === "void" || s === "undefined" || s === "null";

const hasShape = (rec, thresholds) =>
	(rec.params || []).length >= (thresholds.signatureMinParams || 1) || !isVoidLike(rec.returns);

const signaturePairs = (records, thresholds) => {
	const out = [];
	const bySig = new Map();
	for (const r of records) {
		if (!r.signatureKey) continue;
		if (!hasShape(r, thresholds)) continue;
		const key = `${r.name}::${r.signatureKey}`;
		const list = bySig.get(key) || [];
		list.push(r);
		bySig.set(key, list);
	}
	for (const list of bySig.values()) {
		if (list.length < 2) continue;
		for (let i = 0; i < list.length; i += 1) {
			for (let j = i + 1; j < list.length; j += 1) {
				out.push([list[i], list[j]]);
			}
		}
	}
	return out;
};

module.exports = { signaturePairs };
