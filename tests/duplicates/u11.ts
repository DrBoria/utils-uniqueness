// u11 app — NEGATIVE: computeShipping shares computeTax's entire validation
// shell and return contract, but the core is a different (longer) algorithm:
// zone lookup + express multiplier + free-shipping thresholds.

export function computeShipping(
	amount: number,
	region: string,
	express: boolean,
): { ok: boolean; value: number; note: string } {
	if (!Number.isFinite(amount) || amount < 0) {
		return { ok: false, value: 0, note: "bad amount" };
	}
	const label = region.trim().toUpperCase();
	if (label === "") {
		return { ok: false, value: 0, note: "bad region" };
	}
	// --- core: shipping computation (NOT tax) ---
	const zones = ["EU", "US", "APAC"];
	let zoneIndex = zones.indexOf(label);
	if (zoneIndex === -1) zoneIndex = 2;
	let value = 4.99 + zoneIndex * 2.5;
	if (express) {
		value = value * 1.8;
	}
	if (amount >= 100) {
		value = 0;
	} else if (amount >= 50) {
		value = value / 2;
	}
	value = Math.round(value * 100) / 100;
	// --- end core ---
	return { ok: true, value, note: `shipping to ${label}` };
}
