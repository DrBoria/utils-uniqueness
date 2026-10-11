// NOT duplicates: app functions that build/return objects but are NOT copies of
// the trivial zero-init canonical `emptyTotals`. Before the object-property fix
// these over-matched emptyTotals (struct 1.00, ast ~0.7-1.00) because
// object-literal property *values* were dropped from the tree, so any two
// object builders with the same property count looked identical.

// 8-property object with real expressions in the values (map/reduce/index/bool).
// Same property count as emptyTotals, but the values are NOT all literals.
export const buildLinkedItemsList = (rows: { id: string; cost: number }[]): {
	items: string[];
	count: number;
	total: number;
	first: string;
	ok: boolean;
	mappedRows: number;
	planned: number;
	created: number;
} => ({
	items: rows.map((r) => r.id),
	count: rows.length,
	total: rows.reduce((a, b) => a + b.cost, 0),
	first: rows[0]?.id ?? "",
	ok: rows.length > 0,
	mappedRows: rows.filter((r) => r.cost > 0).length,
	planned: rows.length,
	created: rows.filter((r) => r.cost > 0).length,
});

// 7-property object with call expressions and a template string in the values.
export const toNoteSnapshot = (note: { id: string; body: string; author: string }): {
	id: string;
	members: number;
	mappedRows: number;
	planned: number;
	created: number;
	skippedExisting: number;
	failed: number;
} => ({
	id: note.id,
	members: note.body.split(" ").length,
	mappedRows: note.body.length,
	planned: note.body.split("\n").length,
	created: note.author ? 1 : 0,
	skippedExisting: 0,
	failed: note.body.includes("ERR") ? 1 : 0,
});

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
