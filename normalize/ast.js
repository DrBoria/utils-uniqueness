"use strict";

const { normalizeTree } = require("./tree.js");

// ---------------------------------------------------------------------------
// Subtree hashing: every normalized subtree is hashed by (kind, label,
// child-hashes). The multiset of subtree hashes is a strong structural
// fingerprint — Jaccard over the two multisets measures how much of the
// structure is shared, and is cheap (no tree-edit distance needed for the
// first pass).
// ---------------------------------------------------------------------------

const hashSubtrees = (tree, set = new Map()) => {
	if (!tree) return { hash: "", set };
	const kids = (tree.children || []).map((c) => hashSubtrees(c, set));
	const key = `${tree.kind}:${tree.label}[${kids.map((k) => k.hash).join(",")}]`;
	const hash = simpleHash(key);
	set.set(hash, (set.get(hash) || 0) + 1);
	for (const k of kids) for (const [h, n] of k.set) set.set(h, (set.get(h) || 0) + n);
	return { hash, set };
};

const simpleHash = (s) => {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i += 1) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(36);
};

const subtreeMultiset = (tree) => hashSubtrees(normalizeTree(tree)).set;

// ---------------------------------------------------------------------------
// Jaccard over two multisets (counts). Returns { score, shared, union }.
// ---------------------------------------------------------------------------

const multisetJaccard = (a, b) => {
	if (a.size === 0 && b.size === 0) return { score: 1, shared: 0, union: 0 };
	const keys = new Set([...a.keys(), ...b.keys()]);
	let shared = 0;
	let union = 0;
	for (const k of keys) {
		const av = a.get(k) || 0;
		const bv = b.get(k) || 0;
		shared += Math.min(av, bv);
		union += Math.max(av, bv);
	}
	return { score: union === 0 ? 0 : shared / union, shared, union };
};

// ---------------------------------------------------------------------------
// Structural sequence: an ordered list of (kind) tokens over a pre-order walk
// of the normalized tree. Compared with a normalized Levenshtein ratio.
// ---------------------------------------------------------------------------

const structureSequence = (tree, out = []) => {
	if (!tree) return out;
	out.push(tree.kind);
	for (const c of tree.children || []) structureSequence(c, out);
	return out;
};

const levenshtein = (a, b) => {
	const m = a.length;
	const n = b.length;
	if (m === 0) return n;
	if (n === 0) return m;
	let prev = new Array(n + 1);
	let curr = new Array(n + 1);
	for (let j = 0; j <= n; j += 1) prev[j] = j;
	for (let i = 1; i <= m; i += 1) {
		curr[0] = i;
		for (let j = 1; j <= n; j += 1) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
		}
		// eslint-disable-next-line no-multi-assign
		([prev, curr] = [curr, prev]);
	}
	return prev[n];
};

const sequenceSimilarity = (a, b) => {
	if (a.length === 0 && b.length === 0) return 1;
	const maxLen = Math.max(a.length, b.length);
	if (maxLen === 0) return 1;
	const dist = levenshtein(a, b);
	return 1 - dist / maxLen;
};

// ---------------------------------------------------------------------------
// buildAst(descriptor) → Group-3 candidate fields
// ---------------------------------------------------------------------------

const buildAst = (descriptor) => {
	const tree = descriptor.bodyTree;
	const multiset = subtreeMultiset(tree);
	const seq = structureSequence(tree);

	return {
		subtreeHashes: multiset,
		subtreeCount: multiset.size,
		sequence: seq,
	};
};

module.exports = { buildAst, subtreeMultiset, multisetJaccard, structureSequence, sequenceSimilarity, levenshtein, simpleHash };
