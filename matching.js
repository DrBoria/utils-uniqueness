"use strict";

const { jaccard, distinctiveRatio } = require("./signature");
const { sort, first } = require("remeda");

const isVoidLike = (returns) => {
	const r = String(returns || "").trim();
	if (r === "" || r === "?" || r === "void" || r === "undefined" || r === "null") return true;
	const m = r.match(/^Promise<(.+)>$/);
	if (m) return isVoidLike(m[1]);
	return false;
};

const makeUnionFind = (n) => {
	const parent = Array.from({ length: n }, (_, i) => i);
	const find = (i) => {
		while (parent[i] !== i) {
			parent[i] = parent[parent[i]];
			i = parent[i];
		}
		return i;
	};
	const union = (i, j) => {
		const ri = find(i);
		const rj = find(j);
		if (ri !== rj) parent[rj] = ri;
	};
	return { find, union };
};

const indexOfRecord = (records, ref) => {
	if (!ref) return -1;
	if (typeof ref === "number") return ref >= 0 && ref < records.length ? ref : -1;
	if (ref.path) {
		const i = records.findIndex((r) => {
			if (r.path !== ref.path) return false;
			if (ref.line === undefined) return true;
			return ref.line >= r.line && ref.line <= (r.endLine ?? r.line);
		});
		if (i !== -1) return i;
	}
	if (ref.name) {
		const i = records.findIndex((r) => r.name === ref.name);
		if (i !== -1) return i;
	}
	return -1;
};

const match = (records, thresholds, jscpdPairs = []) => {
	const n = records.length;
	const uf = makeUnionFind(n);
	const pairs = [];
	const seen = new Set();

	const key = (i, j) => (i < j ? `${i}|${j}` : `${j}|${i}`);
	const link = (i, j, tier, reason) => {
		if (i === j) return;
		const k = key(i, j);
		if (seen.has(k)) return;
		seen.add(k);
		uf.union(i, j);
		pairs.push({ a: i, b: j, tier, reason });
	};

	const bySig = new Map();
	records.forEach((r, i) => {
		if (r.bodyTokenCount < thresholds.minBodyTokens) return;
		const k = `${r.name}::${r.signatureKey}`;
		const list = bySig.get(k) || [];
		list.push(i);
		bySig.set(k, list);
	});
	for (const list of bySig.values()) {
		if (list.length < 2) continue;
		const rep = records[list[0]];
		const hasShape = rep.params.length >= thresholds.signatureMinParams || !isVoidLike(rep.returns);
		if (!hasShape) continue;
		for (let a = 0; a < list.length; a += 1) {
			for (let b = a + 1; b < list.length; b += 1) {
				const i = list[a];
				const j = list[b];
				link(i, j, "signature", `identical signature (${records[i].params.join(", ")} -> ${records[i].returns})`);
			}
		}
	}

	const byName = new Map();
	records.forEach((r, i) => {
		if (r.bodyTokenCount < thresholds.minBodyTokens) return;
		const list = byName.get(r.name) || [];
		list.push(i);
		byName.set(r.name, list);
	});
	for (const list of byName.values()) {
		if (list.length < 2) continue;
		for (let a = 0; a < list.length; a += 1) {
			for (let b = a + 1; b < list.length; b += 1) {
				const i = list[a];
				const j = list[b];
				if (seen.has(key(i, j))) continue;
				const a0 = records[i];
				const b0 = records[j];
				const carries = (r) => r.params.length >= thresholds.bodyMinParams || !isVoidLike(r.returns);
				if (!carries(a0) && !carries(b0)) continue;
				const ratio = jaccard(a0.bodyTokens, b0.bodyTokens);
				if (ratio >= thresholds.bodyMinRatio) {
					link(i, j, "body", `body similarity ${ratio.toFixed(2)}`);
				}
			}
		}
	}

	const jconf = thresholds.jscpd || {};
	const whole = jconf.whole || {};
	const frag = jconf.fragment || {};
	for (const pair of jscpdPairs) {
		const i = indexOfRecord(records, pair.a);
		const j = indexOfRecord(records, pair.b);
		if (i === -1 || j === -1) continue;
		const recA = records[i];
		const recB = records[j];
		const cloneLines = (pair.a.endLine ?? pair.a.line) - pair.a.line + 1;
		const src = (pair.a.lines || []).join("\n");
		const distinctive = distinctiveRatio(src);
		const spanA = (recA.endLine ?? recA.line) - recA.line + 1;
		const spanB = (recB.endLine ?? recB.line) - recB.line + 1;
		const covA = spanA > 0 ? cloneLines / spanA : 0;
		const covB = spanB > 0 ? cloneLines / spanB : 0;
		const wholeCov = (whole.minCoverage || 0) > 0 && covA >= whole.minCoverage && covB >= whole.minCoverage;
		const wholeSpecific = distinctive >= (whole.minDistinctiveRatio || 0);
		if (wholeCov && wholeSpecific) {
			link(i, j, "jscpd", `whole-function clone (coverage ${covA.toFixed(2)}/${covB.toFixed(2)}, distinctiveness ${distinctive.toFixed(2)})`);
			continue;
		}
		const bigEnough = (pair.a.tokens || 0) >= (frag.minTokens || 0) && cloneLines >= (frag.minLines || 0);
		const fragSpecific = distinctive >= (frag.minDistinctiveRatio || 0);
		if (bigEnough && fragSpecific) {
			link(i, j, "fragment", `partial duplicate: ${pair.a.tokens} shared tokens (${cloneLines} lines, distinctiveness ${distinctive.toFixed(2)})`);
		}
	}

	const byRoot = new Map();
	for (let i = 0; i < n; i += 1) {
		const root = uf.find(i);
		const list = byRoot.get(root) || [];
		list.push(i);
		byRoot.set(root, list);
	}

	const tierRank = { signature: 4, body: 3, jscpd: 2, fragment: 1 };
	const bestTierByIndex = new Array(n).fill(0);
	for (const p of pairs) {
		const rank = tierRank[p.tier] || 0;
		bestTierByIndex[p.a] = Math.max(bestTierByIndex[p.a], rank);
		bestTierByIndex[p.b] = Math.max(bestTierByIndex[p.b], rank);
	}
	const rankToTier = { 4: "signature", 3: "body", 2: "jscpd", 1: "fragment" };

	const clusters = [];
	for (const members of byRoot.values()) {
		if (members.length < 2) continue;
		const recs = members.map((i) => records[i]);
		const canonical = pickCanonical(recs);
		const clusterRank = members.reduce((best, i) => Math.max(best, bestTierByIndex[i]), 0);
		clusters.push({
			canonical,
			members: recs,
			tier: rankToTier[clusterRank] || "fragment",
		});
	}
	clusters.sort((a, b) => b.members.length - a.members.length);

	return { clusters, pairs };
};

const pickCanonical = (recs) =>
	first(
		sort([...recs], (a, b) => {
			if (a.exported !== b.exported) return a.exported ? -1 : 1;
			if (b.bodyTokenCount !== a.bodyTokenCount) return b.bodyTokenCount - a.bodyTokenCount;
			return 0;
		}),
	);

module.exports = { match, makeUnionFind, pickCanonical };
