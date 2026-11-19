// u13 app — NEGATIVE: snapToGrid mirrors truncateText's shape (guard,
// normalize a limit, early-return when within bounds, combine a remainder)
// but operates on NUMBERS with modulo arithmetic and round-up/down branching
// instead of string length + slice.

export function snapToGrid(value: number, max: number, step: number): number {
	if (!Number.isFinite(value) || value === 0) {
		return 0;
	}
	const stride = Math.trunc(step);
	if (!Number.isFinite(stride) || stride <= 0) {
		return value;
	}
	if (value <= stride) {
		return value;
	}
	const ceiling = max > 0 ? max : stride;
	if (ceiling <= stride) {
		return Math.min(value, ceiling);
	}
	const remainder = value % stride;
	const snapped = remainder >= stride / 2 ? value + (stride - remainder) : value - remainder;
	return Math.min(ceiling, snapped);
}
