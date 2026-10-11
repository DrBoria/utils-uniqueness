"use strict";

const { pascalWords } = require("../normalize/words.js");

// ---------------------------------------------------------------------------
// Group 1 — Signature / Parameters.
// Scored from name-independent sub-signals:
//   exactKey   — canonical signatureKey identical (renamed generics, normalized types)
//   shape      — parameter-role shape hash identical
//   roleSeq    — per-parameter role sequence similarity
//   name       — function-name word overlap (weak, disambiguating only)
// ---------------------------------------------------------------------------

const seqSim = (a, b) => {
	const n = Math.max(a.length, b.length);
	if (n === 0) return 1;
	let same = 0;
	for (let i = 0; i < n; i += 1) if (a[i] === b[i]) same += 1;
	return same / n;
};

const nameWordSim = (a, b) => {
	const wa = new Set(pascalWords(a).map((w) => w.toLowerCase()).filter((w) => w.length >= 3));
	const wb = new Set(pascalWords(b).map((w) => w.toLowerCase()).filter((w) => w.length >= 3));
	if (wa.size === 0 || wb.size === 0) return 0;
	let inter = 0;
	for (const w of wa) if (wb.has(w)) inter += 1;
	const union = wa.size + wb.size - inter;
	return union === 0 ? 0 : inter / union;
};

const matchSignature = (candidate, canon) => {
	const cs = candidate.signature;
	const ns = canon.signature;

	const exactKey = cs.signatureKey === ns.signatureKey;
	const exactShape = cs.shapeHash === ns.shapeHash;
	const roleSeq = seqSim(cs.roles, ns.roles);
	const returnRole = cs.returnRole === ns.returnRole ? 1 : 0;
	const nameSim = nameWordSim(cs.name, ns.name);

	let score;
	let matchType;
	if (exactKey) {
		score = 1;
		matchType = "exact-signature";
	} else if (exactShape && returnRole === 1) {
		score = 0.85 + 0.1 * roleSeq;
		matchType = "exact-shape";
	} else {
		score = 0.55 * roleSeq + 0.25 * returnRole + 0.2 * nameSim;
		matchType = "role-overlap";
	}

	return {
		score,
		evidence: {
			exactKey,
			exactShape,
			roleSeq: Math.round(roleSeq * 100) / 100,
			returnRoleMatch: returnRole === 1,
			nameSim: Math.round(nameSim * 100) / 100,
			candidateKey: cs.signatureKey,
			canonicalKey: ns.signatureKey,
			matchType,
		},
	};
};

module.exports = { matchSignature };
