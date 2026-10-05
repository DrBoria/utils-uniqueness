"use strict";

const { signaturePairs } = require("./signature");
const { bodyPairs } = require("./body");
const { wholePairs } = require("./jscpd");
const { fragmentPairs } = require("./fragment");

const tierRank = { signature: 4, body: 3, jscpd: 2, fragment: 1 };

const makeUnionFind = (n) => {
	const parent = Array.from({ length: n }, (_, i) => i);
	const find = (x) => {
		while (parent[x] !== x) {
			parent[x] = parent[parent[x]];
			x = parent[x];
		}
		return x;
	};
	const union = (a, b) => {
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) parent[ra] = rb;
	};
	return { find, union };
};

const pickCanonical = (members) => {
	const sorted = [...members].sort((a, b) => {
		if (a.exported !== b.exported) return a.exported ? -1 : 1;
		return (b.bodyTokenCount || 0) - (a.bodyTokenCount || 0);
	});
	return sorted[0];
};

const match = (records, thresholds, jscpdPairs) => {
	const n = records.length;
	const uf = makeUnionFind(n);
	const indexOf = new Map();
	records.forEach((r, i) => indexOf.set(`${r.path}::${r.line}`, i));

	const linkPair = (a, b) => {
		const ia = indexOf.get(`${a.path}::${a.line}`);
		const ib = indexOf.get(`${b.path}::${b.line}`);
		if (ia !== undefined && ib !== undefined && ia !== ib) uf.union(ia, ib);
	};

	const sigPairs = signaturePairs(records, thresholds);
	const bodyList = bodyPairs(records, thresholds);
	const wholeList = wholePairs(records, jscpdPairs, thresholds);
	const fragList = fragmentPairs(records, jscpdPairs, thresholds);

	const pairTier = new Map();
	const addPairs = (list, tier) => {
		for (const [a, b] of list) {
			linkPair(a, b);
			const key = [`${a.path}::${a.line}`, `${b.path}::${b.line}`].sort().join("::");
			const prev = pairTier.get(key);
			if (!prev || tierRank[tier] > tierRank[prev]) pairTier.set(key, tier);
		}
	};
	addPairs(sigPairs, "signature");
	addPairs(bodyList, "body");
	addPairs(wholeList, "jscpd");
	addPairs(fragList, "fragment");

	const groups = new Map();
	for (let i = 0; i < n; i += 1) {
		const root = uf.find(i);
		const list = groups.get(root) || [];
		list.push(records[i]);
		groups.set(root, list);
	}

	const clusters = [];
	const pairs = [];
	for (const members of groups.values()) {
		if (members.length < 2) continue;
		let bestTier = "fragment";
		for (let i = 0; i < members.length; i += 1) {
			for (let j = i + 1; j < members.length; j += 1) {
				const key = [`${members[i].path}::${members[i].line}`, `${members[j].path}::${members[j].line}`].sort().join("::");
				const t = pairTier.get(key);
				if (t && tierRank[t] > tierRank[bestTier]) bestTier = t;
			}
		}
		const canonical = pickCanonical(members);
		clusters.push({ canonical, members, tier: bestTier });
		for (let i = 0; i < members.length; i += 1) {
			for (let j = i + 1; j < members.length; j += 1) {
				const key = [`${members[i].path}::${members[i].line}`, `${members[j].path}::${members[j].line}`].sort().join("::");
				const t = pairTier.get(key);
				if (t) pairs.push({ a: members[i], b: members[j], tier: t });
			}
		}
	}
	clusters.sort((a, b) => b.members.length - a.members.length);
	return { clusters, pairs };
};

module.exports = { match, pickCanonical };
