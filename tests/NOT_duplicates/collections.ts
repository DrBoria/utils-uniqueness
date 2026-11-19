// Canonical collection utils — control-flow variety (loop + branch, map,
// early-return).

/** Sum the numbers, skipping nulls and non-finite values. */
export const safeSum = (xs: (number | null | undefined)[]): number => {
	let total = 0;
	for (const x of xs) {
		if (x === null || x === undefined) continue;
		if (!Number.isFinite(x)) continue;
		total += x;
	}
	return total;
};

/** Map items to records keyed by a selector. */
export const indexBy = <T>(items: T[], key: (item: T) => string): Record<string, T> => {
	const out: Record<string, T> = {};
	for (const item of items) out[key(item)] = item;
	return out;
};

// Ground truth from core/utils/utils/collections.ts — the two canonicals that
// produced the 0.77/0.76 duplicate false positives in the real run.

/** String names of a TypeScript enum's members (numeric reverse-maps filtered). */
export const enumKeys = <T extends object>(e: T): (keyof T & string)[] =>
	Object.keys(e).filter((key) => Number.isNaN(Number(key))) as (keyof T & string)[];

/** Member values of a TypeScript enum, in declaration order. */
export const enumValues = <T extends object>(e: T): T[keyof T & string][] =>
	enumKeys(e).map((key) => e[key]);

// Ground truth from core/ehr/allergens/parsers.ts:157 — dedupe rows by a key
// into a Map, preserving first-seen order. In the real run a renamed copy
// (`requisitionDiagnoses`, core/ehr/labs.types.ts:1177) scored 0.86 against it.
/** Dedupe rows by a key, keeping the first occurrence of each. */
export const dedupeRows = <T>(rows: T[], key: (row: T) => string): T[] => {
	const seen = new Map<string, T>();
	for (const row of rows) if (!seen.has(key(row))) seen.set(key(row), row);
	return [...seen.values()];
};
