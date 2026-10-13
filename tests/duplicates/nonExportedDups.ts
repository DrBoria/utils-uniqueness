// A NON-exported copy of the canonical formatMoney (tests/utils/numbers.ts).
// There is no exported-only contract: the rule must flag this non-exported
// copy exactly like any other duplicate.
const hiddenMoney = (amount: number, currency = "USD"): string => {
	const sign = amount < 0 ? "-" : "";
	const abs = Math.abs(amount);
	const rounded = Math.round(abs * 100) / 100;
	return `${sign}$${rounded.toFixed(2)} ${currency}`;
};

// A function that is NOT a duplicate of any canonical — proves the rule runs
// on this file and stays silent on functions that are not duplicates.
export const tag = (s: string): string => s.trim().toUpperCase();
