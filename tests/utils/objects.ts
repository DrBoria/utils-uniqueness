// Canonical object builders — from the real run's false-positive cluster.
//
// Ground truth from core/ehr/_import/define-import.ts:24 — a trivial zero-init
// object builder. In the real run it over-matched 8 unrelated object-returning
// app functions (buildLinkedItemsList, mapInsurance, newMember, toNoteSnapshot,
// toCanonicalUnits, aBloodPressure, instanceTest, tipTapToFormBlock) at
// 0.72-0.77, all with structure 1.00, because object-literal property *values*
// were dropped from the tree so any two builders with the same property count
// looked identical.

/** Fresh zeroed accumulator for an import run. */
export const emptyTotals = (): {
	members: number;
	mappedRows: number;
	planned: number;
	created: number;
	skippedExisting: number;
	unresolvedMembers: number;
	failed: number;
} => ({
	members: 0,
	mappedRows: 0,
	planned: 0,
	created: 0,
	skippedExisting: 0,
	unresolvedMembers: 0,
	failed: 0,
});
