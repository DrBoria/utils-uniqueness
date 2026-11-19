// TRUE copies of canonical object builders — app-side regression guards.
// These live in tests/duplicates (app layer) so the pipeline actually compares
// them against the canonicals in tests/NOT_duplicates (same-layer pairs are
// never compared).

// A genuine COPY of emptyTotals — this one MUST stay a duplicate (regression
// guard: the gate must demote only the *unrelated* object builders, not a true
// twin of the trivial canonical).
export const emptyTotalsCopy = () => ({
	members: 0,
	mappedRows: 0,
	planned: 0,
	created: 0,
	skippedExisting: 0,
	unresolvedMembers: 0,
	failed: 0,
});
