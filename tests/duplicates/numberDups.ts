// TRUE duplicates: renamed copies of the canonical number utils.

export const bound = (value: number, min: number, max: number): number => {
	if (value < min) return min;
	if (value > max) return max;
	return value;
};

export const money = (amount: number, currency = "USD"): string => {
	const sign = amount < 0 ? "-" : "";
	const abs = Math.abs(amount);
	const rounded = Math.round(abs * 100) / 100;
	return `${sign}$${rounded.toFixed(2)} ${currency}`;
};

// One-liner twin: identical body, ~6 tree nodes — right at the complexity gate.
export const cash = (n: number | undefined): string | undefined =>
	n === undefined ? undefined : `$${n.toLocaleString()}`;
