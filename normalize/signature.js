"use strict";

const { pipe, map, filter } = require("remeda");

// ---------------------------------------------------------------------------
// Type-name canonicalization: rename generic type params to T0, T1, … and
// collapse whitespace / punctuation spacing so two signatures that differ only
// by the chosen generic name or formatting compare equal.
// ---------------------------------------------------------------------------

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const genericRenameMap = (typeParams) => {
	const out = {};
	(typeParams || []).forEach((tp, i) => {
		const name = typeof tp === "string" ? tp : tp && tp.name;
		if (name) out[name] = `T${i}`;
	});
	return out;
};

const normalizeTypeText = (text, rename) =>
	pipe(
		String(text || ""),
		(s) => Object.entries(rename).reduce((out, [from, to]) => (from ? out.replace(new RegExp(`\\b${escapeRe(from)}\\b`, "g"), to) : out), s),
		(s) => s.replace(/\s+/g, " ").replace(/\s*([<>,()|&?:=])\s*/g, "$1"),
		(s) => s.trim(),
	);

// ---------------------------------------------------------------------------
// Parameter roles: a coarse, name-independent classification of each parameter
// so `parseDate(a, b)` and `parseDate(x, y)` with the same shapes match.
// ---------------------------------------------------------------------------

const roleOf = (typeText) => {
	const t = String(typeText || "").toLowerCase();
	if (!t || t === "?" || t === "any") return "any";
	if (t.includes("number") || t === "int" || t === "float") return "number";
	if (t.includes("string")) return "string";
	if (t.includes("boolean")) return "boolean";
	if (t.includes("date")) return "date";
	if (t.includes("function") || t.includes("=>")) return "fn";
	if (t.endsWith("[]") || t.includes("array<") || t.includes("iterable<") || t === "string[]" || t.includes("readonly")) return "array";
	if (t.startsWith("{") || t.includes("object<") || t.includes("record<")) return "object";
	if (t.includes("|")) return "union";
	if (t.includes("<")) return "generic";
	return "other";
};

// ---------------------------------------------------------------------------
// Shape hash: a stable, order-sensitive fingerprint of the parameter roles plus
// the return role. Two functions with the same shape hash have structurally
// identical signatures even if the concrete type names differ.
// ---------------------------------------------------------------------------

const shapeHash = (roles, returnRole) => `${roles.join(",")}::${returnRole}`;

// ---------------------------------------------------------------------------
// buildSignature(descriptor) → Group-1 candidate fields
// ---------------------------------------------------------------------------

const buildSignature = (descriptor) => {
	const rename = genericRenameMap(descriptor.typeParams || []);

	const params = pipe(
		descriptor.params || [],
		map((p) => {
			const type = normalizeTypeText(p.type, rename);
			return {
				name: p.name,
				type,
				role: roleOf(type),
				hasDefault: !!p.hasDefault,
				isRest: !!p.isRest,
				isOptional: !!p.isOptional,
			};
		}),
	);

	const returns = normalizeTypeText(descriptor.returnType, rename) || "?";
	const returnRole = roleOf(returns);
	const roles = params.map((p) => p.role);

	const signatureKey = `${params.map((p) => p.type).join("|")}::${returns}`;

	return {
		name: descriptor.name,
		params,
		returns,
		returnRole,
		roles,
		shapeHash: shapeHash(roles, returnRole),
		signatureKey,
		typeParams: descriptor.typeParams || [],
		flags: descriptor.flags || {},
	};
};

module.exports = { buildSignature, normalizeTypeText, roleOf, shapeHash, genericRenameMap };
