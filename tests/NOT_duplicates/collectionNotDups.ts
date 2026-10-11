// NOT duplicates: same loop + branch shape as the canonical collection utils
// but a different operation.

// Same for-of + guard shape as `safeSum`, but it finds the index of the max,
// not the sum.
export const argMax = (xs: (number | null | undefined)[]): number => {
	let best = -1;
	let bestVal = -Infinity;
	for (let i = 0; i < xs.length; i += 1) {
		const x = xs[i];
		if (x === null || x === undefined) continue;
		if (x > bestVal) {
			bestVal = x;
			best = i;
		}
	}
	return best;
};

// Same for-of + assign shape as `indexBy`, but it counts occurrences per key.
export const countBy = <T>(items: T[], key: (item: T) => string): Record<string, number> => {
	const out: Record<string, number> = {};
	for (const item of items) {
		const k = key(item);
		out[k] = (out[k] || 0) + 1;
	}
	return out;
};
