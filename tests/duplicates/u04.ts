// u04 app — weighted mean rewritten from reduce() to an explicit for loop
// with two mutable accumulators instead of an accumulator object.

export function forWeightedMean(samples: number[], weights: number[]): number {
	if (samples.length === 0) return 0;
	const limit = Math.min(samples.length, weights.length);
	let sum = 0;
	let mass = 0;
	for (let i = 0; i < limit; i = i + 1) {
		const weight = Number.isFinite(weights[i]) ? weights[i] : 0;
		sum = sum + samples[i] * weight;
		mass = mass + weight;
	}
	return mass > 0 ? sum / mass : 0;
}
