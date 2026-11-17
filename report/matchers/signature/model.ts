"use strict";

// ── SIGNATURE MATCHER · the model ───────────────────────────────────────────
//
// What group 1 compares: the INTERFACE — the parameter ROLES in order, the kind
// of value returned, and the NAMES (the function's own, its parameters', and the
// names its body declares).
//
// This model is the picture behind the score, not a second score. It carries no
// composite number and no weights: the verdict and its weights belong to
// `matcher/signature.js` and the decision maker, and the page prints those. What
// lives here is only what a reader needs to SEE — the parameters side by side,
// the names both sides declare, and where each name is written.
//
// Nothing derived is stored twice:
//   * `names` is one entity: the two names, the names both declare, their words,
//     the shared share, and the sites;
//   * the counts are the arrays themselves (`params.length`), not copies;
//   * `same*` flags are gone — a reader compares two values, the code does too.

import { diffWords } from "../../user-report/data/diff";
import { nameSimilarity, namesOf, bagSimilarity, commonNames, wordSites } from "../../../normalize/words";
import { returnsSimOf } from "../../../matcher/signature";

const sideOf = (signature, fallbackName) => ({
	name: signature?.name ?? fallbackName ?? "",
	params: (signature?.params ?? []).map((param) => ({ name: param.name, type: param.type, role: param.role })),
	// The whole return, as the candidate carries it: `type`, `role`, `values`.
	returns: signature?.returns ?? { type: "?", role: "?", values: [] },
});

const build = (leftCandidate, rightCandidate) => {
	if (!leftCandidate || !rightCandidate) return null;
	const left = sideOf(leftCandidate.signature, leftCandidate.name);
	const right = sideOf(rightCandidate.signature, rightCandidate.name);

	// One row per PARAMETER POSITION. A row is "same" when the roles match — that
	// is what the score looks at. The type text is shown next to the role because
	// it explains the role.
	const width = Math.max(left.params.length, right.params.length);
	const params = [];
	for (let index = 0; index < width; index += 1) {
		const a = left.params[index] ?? null;
		const b = right.params[index] ?? null;
		// Where the TYPE TEXT differs (a `params: {...}` object with one key
		// renamed is the same role and a different interface). Word-level, so the
		// changed key is marked inside the string instead of the whole cell.
		const words = a && b ? diffWords(`${a.name}: ${a.type}`, `${b.name}: ${b.type}`) : null;
		params.push({
			index,
			left: a,
			right: b,
			same: Boolean(a && b && a.role === b.role),
			words: { left: words?.left ?? null, right: words?.right ?? null },
		});
	}

	const declaredLeft = namesOf(leftCandidate);
	const declaredRight = namesOf(rightCandidate);
	const nameWords = nameSimilarity(left.name, right.name);
	// Where the SHARED words of each function name are written — as COLUMNS, so the
	// view paints positions instead of searching for a substring. Only the words
	// both names have (in order) become sites.
	//
	// The name is the candidate's OWN name, and `candidate.nameSite` is the position
	// the decision maker read it from — it is handed over, not searched for. A
	// candidate that predates `nameSite` falls back to its declared sites.
	const nameSite = (candidate, name) => candidate?.nameSite ?? (candidate?.names ?? []).find((site) => site.name === name) ?? null;
	const wordSitesOf = (name, candidate) => {
		const site = nameSite(candidate, name);
		if (!site || site.column == null || site.line == null) return [];
		return wordSites(name, site.column)
			.filter((word) => nameWords.common.includes(word.text.toLowerCase()))
			.map((word) => ({ name: word.text, kind: "name-word", line: site.line, column: word.column }));
	};
	const names = {
		left: left.name,
		right: right.name,
		// The words of the two names, and the ones that matched in order. This is
		// the explanation of a rename, not a second score.
		words: { left: nameWords.left, right: nameWords.right, common: nameWords.common },
		// Each shared word with the COLUMN it starts at, per side.
		wordSites: { left: wordSitesOf(left.name, leftCandidate), right: wordSitesOf(right.name, rightCandidate) },
		// Every name both sides declare — parameters, variables, object keys.
		common: commonNames(declaredLeft, declaredRight),
		score: bagSimilarity(declaredLeft, declaredRight),
		// Where each name is written. A name belongs to the place that declares
		// it, not to every place that mentions it.
		sites: { left: leftCandidate.names ?? [], right: rightCandidate.names ?? [] },
	};

	// WHAT each side hands back, with the line it returns on, and which of them are
	// the same value. The score already reads these shapes (`returnsSim`); the page
	// needs them to draw the correspondence on the `return` lines themselves.
	const returnsOf = (candidate) => candidate?.signature?.returns?.values ?? [];
	const returnValues = {
		left: returnsOf(leftCandidate),
		right: returnsOf(rightCandidate),
		// The same number the decision maker scored: one coefficient, computed once.
		score: returnsSimOf(returnsOf(leftCandidate), returnsOf(rightCandidate)),
		pairs: [],
	};
	const taken = new Set();
	for (const value of returnValues.left) {
		const sameShape = returnValues.right.findIndex((other, at) => !taken.has(at) && other.shape === value.shape);
		const sameKind = sameShape < 0 ? returnValues.right.findIndex((other, at) => !taken.has(at) && other.role === value.role) : sameShape;
		if (sameKind < 0) continue;
		taken.add(sameKind);
		returnValues.pairs.push({ left: value, right: returnValues.right[sameKind], same: sameKind === sameShape });
	}

	return { left, right, params, names, returnValues };
};

export {  build  };
