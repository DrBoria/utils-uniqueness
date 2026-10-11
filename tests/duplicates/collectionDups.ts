// TRUE duplicates: renamed copies of the canonical collection utils.

export const totalUp = (xs: (number | null | undefined)[]): number => {
	let total = 0;
	for (const x of xs) {
		if (x === null || x === undefined) continue;
		if (!Number.isFinite(x)) continue;
		total += x;
	}
	return total;
};

export const keyMap = <T>(items: T[], key: (item: T) => string): Record<string, T> => {
	const out: Record<string, T> = {};
	for (const item of items) out[key(item)] = item;
	return out;
};

// TRUE duplicate of the canonical `dedupeRows` — ground truth from
// core/ehr/labs.types.ts:1177 (`requisitionDiagnoses`), 0.86 in the real run.
export const requisitionDiagnoses = <T>(rows: T[], key: (row: T) => string): T[] => {
	const seen = new Map<string, T>();
	for (const row of rows) if (!seen.has(key(row))) seen.set(key(row), row);
	return [...seen.values()];
};
