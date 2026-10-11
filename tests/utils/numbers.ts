// Canonical number utils — varying complexity.

/** Clamp a value into [min, max]. */
export const clamp = (value: number, min: number, max: number): number => {
	if (value < min) return min;
	if (value > max) return max;
	return value;
};

/** Format a number as currency, e.g. 1234.5 -> "$1,234.50". */
export const formatMoney = (amount: number, currency = "USD"): string => {
	const sign = amount < 0 ? "-" : "";
	const abs = Math.abs(amount);
	const rounded = Math.round(abs * 100) / 100;
	return `${sign}$${rounded.toFixed(2)} ${currency}`;
};

/** Round to a fixed number of decimals. */
export const round = (value: number, decimals = 2): number => {
	const f = 10 ** decimals;
	return Math.round(value * f) / f;
};

/** Format a number as currency, or undefined when absent. */
export const moneyOrNone = (n: number | undefined): string | undefined =>
	n === undefined ? undefined : `$${n.toLocaleString()}`;

// Ground truth from core/utils/utils/units.ts — the canonical that a
// same-shape boolean check (`isTerminalStatus`) over-matched at 0.55 in the
// real run (signature 0.00, structure 0.85, controlFlow 1.00).
export const celsiusToFahrenheit = (degC: number): number => (degC * 9) / 5 + 32;
