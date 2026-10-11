// Cross-file twin (review side). `summarizeReviews` is a byte-identical copy
// of `summarizeAllergies` in allergy.ts. `sortReviews` is a different body
// shape (spread + sort) and must NOT be clustered with the twins.

export const summarizeReviews = (rows: { code: string; severity: string }[]): Map<string, string> => {
	const seen = new Map<string, string>();
	for (const row of rows) {
		if (!seen.has(row.code)) seen.set(row.code, row.severity);
	}
	return seen;
};

export const sortReviews = (rows: { id: number }[]): { id: number }[] => [...rows].sort((a, b) => a.id - b.id);
