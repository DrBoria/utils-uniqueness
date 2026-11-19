// Smoke app: the same clamp, renamed (should be flagged duplicate).
export function boundNumber(n: number, lo: number, hi: number): number {
	if (n < lo) return lo;
	if (n > hi) return hi;
	return n;
}

// Not a duplicate: different algorithm entirely.
export function sumAll(values: number[]): number {
	let total = 0;
	for (const v of values) total += v;
	return total;
}
