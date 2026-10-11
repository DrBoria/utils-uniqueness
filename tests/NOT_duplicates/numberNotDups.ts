// NOT duplicates: same arity/shape as the canonical number utils but a
// different operation.

// Same 3-arg (number, number, number) shape as `clamp`, but it does linear
// interpolation, not clamping.
export const lerp = (t: number, a: number, b: number): number => {
	if (t <= 0) return a;
	if (t >= 1) return b;
	return a + (b - a) * t;
};

// Same (number, string) shape as `formatMoney`, but it formats a percentage,
// not a currency.
export const pct = (amount: number, digits = 0): string => {
	const sign = amount < 0 ? "-" : "";
	const abs = Math.abs(amount);
	return `${sign}${abs.toFixed(digits)}%`;
};

// Same one-liner ternary shape as `moneyOrNone` (guard + template), but it
// extracts a year, not a currency string.
export const yearOf = (d: Date | undefined): number | undefined =>
	d === undefined ? undefined : d.getFullYear();

// Same one-liner ternary + `$` template shape as `moneyOrNone`, but it formats
// a monthly rate, not a currency value.
export const perMonth = (amount: number | undefined): string | undefined =>
	amount === undefined ? undefined : `$${amount}/mo`;

// Ground truth from core/ehr/allergies.v/allergies.permissions.ts — a
// boolean check that over-matched `celsiusToFahrenheit` at 0.55 in the real
// run (signature 0.00, structure 0.85, controlFlow 1.00). Same coarse
// one-liner shape, entirely different operation.
export const isTerminalStatus = (status: string): boolean => status === "resolved" || status === "entered-in-error";
