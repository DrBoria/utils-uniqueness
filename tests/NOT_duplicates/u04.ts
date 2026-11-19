// u04 canon — weighted mean expressed with reduce.

export function weightedAverage(values: number[], weights: number[]): number {
	if (values.length === 0) return 0;
	const limit = Math.min(values.length, weights.length);
	const totals = values.reduce(
		(acc, value, index) => {
			if (index >= limit) return acc;
			const weight = Number.isFinite(weights[index]) ? weights[index] : 0;
			return { sum: acc.sum + value * weight, mass: acc.mass + weight };
		},
		{ sum: 0, mass: 0 },
	);
	return totals.mass > 0 ? totals.sum / totals.mass : 0;
}
