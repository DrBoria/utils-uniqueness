// Duplicates that live INSIDE other functions — the rule must see every
// function without exception: nested functions, anonymous callbacks passed
// to .map(), and partial blocks.

// 1. A NESTED function: a byte-for-byte copy of the canonical formatMoney
// (tests/utils/numbers.ts) declared inside another function body.
export const outerWithNested = (amounts: number[], currency: string) => {
	const formatOne = (amount: number, cur = "USD"): string => {
		const sign = amount < 0 ? "-" : "";
		const abs = Math.abs(amount);
		const rounded = Math.round(abs * 100) / 100;
		return `${sign}$${rounded.toFixed(2)} ${cur}`;
	};
	return amounts.map((a) => formatOne(a, currency));
};

// 2. An ANONYMOUS callback (no name at all) passed to .map() whose body is a
// byte-for-byte copy of the canonical formatMoney.
export const mapAnon = (amounts: number[], currency: string) =>
	amounts.map((amount: number) => {
		const sign = amount < 0 ? "-" : "";
		const abs = Math.abs(amount);
		const rounded = Math.round(abs * 100) / 100;
		return `${sign}$${rounded.toFixed(2)} ${currency}`;
	});

// 3. A PARTIAL duplicate: the outer function is NOT a copy of formatMoney, but
// it contains an anonymous arrow whose body IS the byte-for-byte formatMoney
// block — that block must be reported as a part of the canonical.
export const wrapper = (amounts: number[], currency: string) => {
	const totals = amounts.reduce((acc, n) => acc + n, 0);
	const avg = totals / amounts.length;
	const anon = (amount: number, cur = "USD"): string => {
		const sign = amount < 0 ? "-" : "";
		const abs = Math.abs(amount);
		const rounded = Math.round(abs * 100) / 100;
		return `${sign}$${rounded.toFixed(2)} ${cur}`;
	};
	return { avg, first: anon(amounts[0], currency) };
};
