// Canonical string utils — varying complexity.

/** Capitalize the first letter, lowercase the rest. */
export const capitalize = (s: string): string => {
	if (!s) return "";
	return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
};

/** Turn a phrase into a kebab-case slug. */
export const slugify = (s: string): string =>
	s.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

/** Truncate to `max` chars, appending an ellipsis when cut. */
export const truncate = (s: string, max: number): string => {
	if (s.length <= max) return s;
	return s.slice(0, Math.max(0, max - 1)) + "…";
};

/** Join non-empty parts with a separator (drop empties first). */
export const joinParts = (parts: (string | undefined)[], sep = " "): string =>
	parts.filter((p) => p && p.length > 0).join(sep);

// Ground truth from core/ehr/_db/fhir.ts:245 — a guard-and-trim one-liner. In
// the real run a renamed copy (`clean`, core/ehr/allergens/parsers.ts:15)
// scored 0.985 against it (identical logic, different names).
/** Trim a string, returning undefined for empty/whitespace input. */
export const trimmed = (s: string | null | undefined): string | undefined => {
	const t = s?.trim();
	return t ? t : undefined;
};
