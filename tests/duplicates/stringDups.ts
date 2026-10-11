// TRUE duplicates: renamed copies of the canonical string utils.

export const capFirst = (s: string): string => {
	if (!s) return "";
	return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
};

export const toSlug = (s: string): string =>
	s.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

export const shorten = (s: string, max: number): string => {
	if (s.length <= max) return s;
	return s.slice(0, Math.max(0, max - 1)) + "…";
};

export const glue = (parts: (string | undefined)[], sep = " "): string =>
	parts.filter((p) => p && p.length > 0).join(sep);

// TRUE duplicate of the canonical `trimmed` — ground truth from
// core/ehr/allergens/parsers.ts:15 (`clean`), 0.985 in the real run.
export const clean = (value: string | null | undefined): string | undefined => {
	const t = value?.trim();
	return t ? t : undefined;
};
