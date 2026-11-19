// u01 app — same money formatting, but the two canon helpers are INLINED
// and template literals become string concatenation.

export function formatCurrency(value: number, currencySign: string, places: number): string {
	const safeValue = Number.isFinite(value) ? value : 0;
	const safePlaces = Math.max(0, Math.min(6, Math.trunc(places)));
	// inlined roundedCents:
	const rounded = Math.round(safeValue * 100) / 100;
	const fixed = rounded.toFixed(safePlaces);
	const [wholePart, fractionPart] = fixed.split(".");
	// inlined groupedInteger:
	const grouped = wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
	return fractionPart ? currencySign + grouped + "." + fractionPart : currencySign + grouped;
}
