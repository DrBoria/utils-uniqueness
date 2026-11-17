"use strict";

// Nested diffs: "why is this piece identical?"
//
// A duplicate body usually calls the same helpers as its twin — and a reader
// staring at two identical `if` blocks wants to open the helper and see whether
// THAT is identical too. This module answers it: every call inside one side that
// also exists in the other side's file becomes an EXPANSION, a full diff of the
// two callees, attached to the row where the call happens.
//
// Depth is one. An expansion of an expansion would turn one pair into a tree the
// size of the codebase; the reader can open the callee as its own pair from the
// findings list if they need to keep going.

import * as path from "node:path";

// The regex, the keyword list and the expansion cap are vocabulary, not logic.
import { CALL_SITE_RE, CALL_KEYWORDS, MAX_EXPANSIONS } from "../../../constants";

const calledNames = (text) => {
	const names = new Set();
	for (const match of String(text ?? "").matchAll(CALL_SITE_RE)) {
		const name = match[1];
		if (!CALL_KEYWORDS.has(name)) names.add(name);
	}

	return [...names];
};

// Index of every parsed function, by file: `relPath -> Map<name, {line,endLine}>`.
const buildIndex = (candidates) => {
	const index = new Map();
	for (const candidate of candidates ?? []) {
		if (!candidate.path || !candidate.name) continue;
		if (!index.has(candidate.path)) index.set(candidate.path, new Map());
		const byName = index.get(candidate.path);
		const previous = byName.get(candidate.name);
		// The first declaration wins — overloads resolve to the same body.
		if (!previous) byName.set(candidate.name, { line: candidate.line, endLine: candidate.endLine ?? candidate.line });
	}

	return index;
};

const spanFor = (index, relPath, name, source, repoRoot) => {
	const entry = index.get(relPath)?.get(name);
	if (!entry) return null;

	return source.spanOf(path.resolve(repoRoot, relPath), entry.line, entry.endLine);
};

// Every call that resolves on BOTH sides becomes an expansion with its own diff.
const expansionsFor = ({ leftPath, rightPath, leftText, index, source, repoRoot, diff }) => {
	if (!leftPath || !rightPath || leftPath === rightPath) return [];
	const out = [];
	for (const name of calledNames(leftText)) {
		if (out.length >= MAX_EXPANSIONS) break;
		const left = spanFor(index, leftPath, name, source, repoRoot);
		const right = spanFor(index, rightPath, name, source, repoRoot);
		if (!left || !right) continue;
		const compared = diff.diffSpans(left, right);
		if (compared.counts.added === 0 && compared.counts.removed === 0 && compared.counts.changed === 0) {
			// Identical callees are the whole point: keep them, flagged, so the
			// reader can see that the sameness continues one level down.
			out.push({ name, identical: true, left, right, rows: compared.rows, counts: compared.counts });
			continue;
		}
		out.push({ name, identical: false, left, right, rows: compared.rows, counts: compared.counts });
	}

	return out.sort((a, b) => Number(b.identical) - Number(a.identical) || a.name.localeCompare(b.name));
};

export {  buildIndex, calledNames, expansionsFor  };
