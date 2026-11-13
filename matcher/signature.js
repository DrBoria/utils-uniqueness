"use strict";

const { namesOf, commonNames, nameSimilarity } = require("../normalize/words.js");
const { GROUP_WEIGHT, RELIABILITY, saturate, combine, pieceEvidence } = require("../evidence");

// ---------------------------------------------------------------------------
// Group 1 — Signature / Parameters.
// Scored from:
//   exactKey   — canonical signatureKey identical (renamed generics, normalized types)
//   shape      — parameter-role shape hash identical
//   roleSeq    — per-parameter role sequence similarity
//   names      — EVERY name the two functions declare: the function's own name,
//                its parameters, and the names its body introduces (variables,
//                object keys). A multiset, so a name declared twice counts twice.
//                The tree normalizer replaces identifiers with `v`, so the
//                candidate carries the names separately (`candidate.names`);
//                a renamed copy keeps them, and that is a duplicate signal.
// ---------------------------------------------------------------------------

// ── WHAT THE FUNCTION HANDS BACK ────────────────────────────────────────
//
// Not the declared type — the VALUES of its own `return`s: which kind (number,
// string, object, call, undefined) and which shape (the same number, the same
// object with the same values). Different amounts of evidence:
//
//   same shapes                       1.00  — a copy returns the same thing
//   same kinds, different values      0.55  — a number, but not the same one
//   some kinds in common              0.25 × share
//   nothing in common                 0.10
//   both return nothing               1.00  — equally nothing
//   one returns, the other does not   0.00  — and this scores below
//                                             `return undefined` vs no return
const returnsSimOf = (a, b) => {
	const left = a ?? [];
	const right = b ?? [];
	if (left.length === 0 && right.length === 0) return 1;
	if (left.length === 0 || right.length === 0) return 0;

	const leftShapes = left.map((value) => value.shape).sort();
	const rightShapes = right.map((value) => value.shape).sort();
	if (leftShapes.length === rightShapes.length && leftShapes.every((shape, at) => shape === rightShapes[at])) return 1;

	const leftRoles = new Set(left.map((value) => value.role));
	const rightRoles = new Set(right.map((value) => value.role));
	const common = [...leftRoles].filter((role) => rightRoles.has(role)).length;
	const union = new Set([...leftRoles, ...rightRoles]).size;

	return union === 0 ? 1 : 0.55 * (common / union);
};

const matchSignature = (candidate, canon, reliability = {}) => {
	const cs = candidate.signature;
	const ns = canon.signature;
	// The weight ONE match of a kind is worth: the engine's default unless the owner
	// set it in the ESLint config (`weights.evidence`).
	const worth = (kind) => reliability[kind] ?? RELIABILITY[kind] ?? GROUP_WEIGHT.signature;

	const names = namesOf(candidate);
	const canonNames = namesOf(canon);
	const shared = commonNames(names, canonNames);

	// ── EVIDENCE, ONE PIECE PER KIND OF THING ───────────────────────────────
	//
	// Signature compares FIVE things and nothing else: the names the body declares,
	// the TYPES of the parameters, the name of the FUNCTION (as words), the names of
	// the parameters, and what the function returns. Each piece is
	// `1 - (1 - w)^matched` — one match is one observation, and twenty matches of one
	// kind are still one kind. Pieces combine like independent observations
	// (`1 - Π(1 - e)`), so a bag of shared names with a different return type cannot
	// pass for a copy.
	// A piece counts with the SHARE of it that corresponds: `createSomeAdapter` against
	// `createPlainAdapter` is the same shape but not the same name, and five of thirteen
	// calls is 38% — below the floor a piece is not evidence at all.
	const piece = (matched, total, kind) => pieceEvidence(matched, total, worth(kind));

	// Evidence per KIND OF NAME: how many names of this kind both sides share, and
	// how much one match of that kind is worth. Not a share of the total — a name
	// that matches once is one observation, not "100%".
	const bagByKind = (source) => {
		const bags = new Map();
		for (const site of source?.names ?? []) {
			const bag = bags.get(site.kind) ?? new Map();
			bag.set(site.name, (bag.get(site.name) ?? 0) + 1);
			bags.set(site.kind, bag);
		}

		return bags;
	};
	const matchedOf = (left, right) => {
		let matched = 0;
		let totalLeft = 0;
		let totalRight = 0;
		for (const count of left.values()) totalLeft += count;
		for (const count of right.values()) totalRight += count;
		for (const [name, count] of left) matched += Math.min(count, right.get(name) ?? 0);

		return { matched, total: Math.max(totalLeft, totalRight) };
	};

	const leftBags = bagByKind(candidate);
	const rightBags = bagByKind(canon);
	const byKind = {};
	// NAMES ARE ONE PIECE, NOT ONE PIECE PER KIND. Combining five separately saturated
	// kinds let a handful of names in five categories read like a copy: five kinds ×
	// two names each saturated to ~0.4 and combined to ~0.92, while the bodies shared
	// almost nothing. One count over all kinds says what the reader expects: twenty
	// shared names are a copy, one shared name is one observation.
	let matchedNames = 0;
	let totalNames = 0;
	for (const kind of new Set([...leftBags.keys(), ...rightBags.keys()])) {
		const counts = matchedOf(leftBags.get(kind) ?? new Map(), rightBags.get(kind) ?? new Map());
		const confidence = piece(counts.matched, counts.total, kind);
		byKind[kind] = { ...counts, confidence: Math.round(confidence * 100) / 100 };
		matchedNames += counts.matched;
		totalNames += counts.total;
	}
	const pieces = [];
	if (matchedNames > 0) pieces.push(piece(matchedNames, totalNames, "name"));

	// THE TYPES of the parameters, position by position: `(options: Options)` on both
	// sides is the same interface even when the body was rewritten.
	const typesOf = (side) => (side.params ?? []).map((param) => String(param.type ?? "").replace(/\s+/g, " ").trim().toLowerCase());
	const leftTypes = typesOf(cs);
	const rightTypes = typesOf(ns);
	let sameTypes = 0;
	for (let at = 0; at < Math.min(leftTypes.length, rightTypes.length); at += 1) {
		if (leftTypes[at] !== "" && leftTypes[at] === rightTypes[at]) sameTypes += 1;
	}
	if (leftTypes.length > 0 || rightTypes.length > 0) {
		const confidence = piece(sameTypes, Math.max(leftTypes.length, rightTypes.length), "type");
		byKind.type = { matched: sameTypes, total: Math.max(leftTypes.length, rightTypes.length), confidence: Math.round(confidence * 100) / 100 };
		pieces.push(confidence);
	}

	// THE DECLARED RETURN TYPE: `Promise<void>` against `void` is a different function
	// however much of the body matches.
	const typeText = (side) => String(side.returns?.type ?? "").replace(/\s+/g, " ").trim().toLowerCase();
	const leftType = typeText(cs);
	const rightType = typeText(ns);
	const sameReturnType = leftType !== "" && leftType !== "?" && leftType === rightType;
	if (sameReturnType) pieces.push(worth("returnType"));

	// THE VALUES it hands back: the same number back is stronger than `undefined`
	// twice, and one returning while the other does not is no evidence at all.
	const returnValues = { left: cs.returns.values ?? [], right: ns.returns.values ?? [] };
	const sameReturns = returnValues.left.filter((value, at) => returnValues.right[at] && returnValues.right[at].shape === value.shape).length;
	if (returnValues.left.length > 0 || returnValues.right.length > 0) {
		const confidence = piece(sameReturns, Math.max(returnValues.left.length, returnValues.right.length), "return");
		byKind.return = { matched: sameReturns, total: Math.max(returnValues.left.length, returnValues.right.length), confidence: Math.round(confidence * 100) / 100 };
		pieces.push(confidence);
	}

	// THE NAME of the function: a WORD match, not a whole-string one.
	// `createPlainAdapter` and `createDifficultAdapter` share `create` and `Adapter` —
	// two observations; `plain`/`difficult` contributes nothing.
	const nameWords = nameSimilarity(candidate.name ?? "", canon.name ?? "");
	const wordPiece = piece(nameWords.common.length, Math.max(nameWords.left.length, nameWords.right.length), "name-word");
	if (wordPiece > 0) pieces.push(wordPiece);
	if (nameWords.same) pieces.push(worth("name"));

	const confidence = combine(pieces);

	return {
		score: confidence,
		evidence: {
			commonNames: shared.slice(0, 40),
			byKind,
			sameReturnType,
			returnTypes: [leftType, rightType],
			nameWords: nameWords.common,
		},
	};
};

module.exports = { matchSignature, returnsSimOf };
