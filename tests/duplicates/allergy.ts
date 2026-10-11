// Cross-file twin (allergy side). `summarizeAllergies` is a byte-identical
// copy of `summarizeReviews` in review.ts — the ground-truth shape of the
// cross-file twin the real run found (toReviewedAsOf in allergy.rm.ts and
// review.rm.ts). These are TRUE duplicates with no canonical anchor: the
// app↔app mode must surface them as "worth moving to utils".
// `countAllergies` is a trivial one-liner that must NOT be clustered.

export const summarizeAllergies = (rows: { code: string; severity: string }[]): Map<string, string> => {
	const seen = new Map<string, string>();
	for (const row of rows) {
		if (!seen.has(row.code)) seen.set(row.code, row.severity);
	}
	return seen;
};

export const countAllergies = (rows: { code: string }[]): number => rows.length;
