"use strict";

// ── AST ALIGNMENT · CONTENT BEFORE ORDER ───────────────────────────────────
//
// Which children of two same-form nodes correspond. The old rule was a strictly
// ORDERED LCS: it could only pair i with j while keeping both sequences in
// order, so a body whose statements were REORDERED paired `initials` with
// `displayName` — the first same-form candidate in order — and the real
// duplicate one line below was left "unique".
//
// The rule now: the most similar piece wins, order is only the tie-breaker.
// Pass 1 pairs pieces by content (Dice over their form sequences, weighted by
// rarity), best pairs first. Pass 2 aligns whatever is left in order, so an
// in-order body behaves exactly as before. A pair below the identity floor is
// not a correspondence: two `var:const` with different content are two pieces,
// not one broken piece.

import { flowRarity } from "../constants";

/** What makes two nodes the same CONSTRUCT (`var:const`, `call:log`). */
const formOf = (node) => `${node.kind}:${node.keyword ?? node.label ?? ""}`;

const walk = (node, at) => {
	if (!node) return;
	at(node);
	for (const kid of node.children ?? []) walk(kid, at);
};

const weightOf = (node) => flowRarity(node.kind);

const formListOf = (node, cache = new Map()) => {
	const known = cache.get(node);
	if (known !== undefined) return known;
	const out = [];
	walk(node, (child) => out.push(formOf(child)));
	cache.set(node, out);
	return out;
};

/** Dice coefficient over the form sequences: how much two pieces are the SAME piece. */
const similarityOf = (left, right, cache) => {
	const a = formListOf(left, cache);
	const b = formListOf(right, cache);
	if (a.length === 0 || b.length === 0) return 0;
	const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
	for (let i = 1; i <= a.length; i += 1) {
		for (let j = 1; j <= b.length; j += 1) {
			table[i][j] = a[i - 1] === b[j - 1] ? table[i - 1][j - 1] + 1 : Math.max(table[i - 1][j], table[i][j - 1]);
		}
	}
	return (2 * table[a.length][b.length]) / (a.length + b.length);
};

/** Below this similarity two same-form pieces are NOT the same piece. */
const IDENTITY_FLOOR = 0.5;

/** The ordered LCS over same forms — the tie-break pass for leftovers. */
const orderedLeftovers = (left, right, usedLeft, usedRight) => {
	const li = left.map((_, i) => i).filter((i) => !usedLeft.has(i));
	const ri = right.map((_, j) => j).filter((j) => !usedRight.has(j));
	const forms = { left: li.map((i) => formOf(left[i])), right: ri.map((j) => formOf(right[j])) };
	const rows = li.length + 1;
	const cols = ri.length + 1;
	const value = Array.from({ length: rows }, () => new Array(cols).fill(0));
	for (let i = 1; i < rows; i += 1) {
		for (let j = 1; j < cols; j += 1) {
			value[i][j] = forms.left[i - 1] === forms.right[j - 1] ? value[i - 1][j - 1] + 1 : Math.max(value[i - 1][j], value[i][j - 1]);
		}
	}
	const pairs = [];
	let i = li.length;
	let j = ri.length;
	while (i > 0 && j > 0) {
		if (forms.left[i - 1] === forms.right[j - 1]) {
			pairs.push([li[i - 1], ri[j - 1]]);
			i -= 1;
			j -= 1;
			continue;
		}
		if (value[i - 1][j] >= value[i][j - 1]) i -= 1;
		else j -= 1;
	}
	return pairs.reverse();
};

/**
 * Content-first alignment: same-form candidates are scored by rarity ×
 * similarity, the best pairs claim their nodes first (so the identical
 * `initials` takes the identical `initials`, not the first `var:const` in
 * order), and the leftovers keep the ordered behaviour.
 */
const alignWeighed = (left, right) => {
	const cache = new Map();
	const candidates = [];
	for (let i = 0; i < left.length; i += 1) {
		for (let j = 0; j < right.length; j += 1) {
			if (formOf(left[i]) !== formOf(right[j])) continue;
			const similarity = similarityOf(left[i], right[j], cache);
			if (similarity < IDENTITY_FLOOR) continue;
			candidates.push({ i, j, worth: weightOf(left[i]) * similarity, similarity });
		}
	}
	// Best content first; equal content keeps the earlier position (stable order).
	candidates.sort((a, b) => b.worth - a.worth || b.similarity - a.similarity || a.i - b.i || a.j - b.j);
	const usedLeft = new Set();
	const usedRight = new Set();
	const pairs = [];
	for (const { i, j } of candidates) {
		if (usedLeft.has(i) || usedRight.has(j)) continue;
		usedLeft.add(i);
		usedRight.add(j);
		pairs.push([i, j]);
	}
	for (const pair of orderedLeftovers(left, right, usedLeft, usedRight)) pairs.push(pair);
	return pairs.sort((a, b) => a[0] - b[0]);
};

/** The plain ordered alignment (no weights) — kept for callers that ask for it. */
const alignForms = (left, right) => orderedLeftovers(left, right, new Set(), new Set());

export { alignForms, alignWeighed, formOf, similarityOf, weightOf, IDENTITY_FLOOR };
