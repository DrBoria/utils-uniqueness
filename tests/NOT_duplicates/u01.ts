// u01 canon — money formatting that delegates to two small helpers.

export function roundedCents(amount: number): number {
	return Math.round(amount * 100) / 100;
}

export function groupedInteger(digits: string): string {
	return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatMoney(amount: number, symbol: string, decimals: number): string {
	const safeAmount = Number.isFinite(amount) ? amount : 0;
	const safeDecimals = Math.max(0, Math.min(6, Math.trunc(decimals)));
	const fixed = roundedCents(safeAmount).toFixed(safeDecimals);
	const [whole, fraction] = fixed.split(".");
	const grouped = groupedInteger(whole);
	return fraction ? `${symbol}${grouped}.${fraction}` : `${symbol}${grouped}`;
}
