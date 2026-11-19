// u11 canon — computeTax. Long shared boilerplate shell, tax-specific core.

export function computeTax(amount: number, region: string): { ok: boolean; value: number; note: string } {
	if (!Number.isFinite(amount) || amount < 0) {
		return { ok: false, value: 0, note: "bad amount" };
	}
	const label = region.trim().toUpperCase();
	if (label === "") {
		return { ok: false, value: 0, note: "bad region" };
	}
	// --- core: tax computation ---
	const rate = label === "EU" ? 0.2 : label === "US" ? 0.07 : 0.15;
	const base = Math.round(amount * 100) / 100;
	const value = Math.round(base * rate * 100) / 100;
	// --- end core ---
	return { ok: true, value, note: `tax for ${label}` };
}
