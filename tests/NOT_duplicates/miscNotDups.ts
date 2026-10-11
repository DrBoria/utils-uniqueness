// Ground truth for the throw-stub similar-gate: a zero-arg one-liner that, in
// the real run, matched the deprecated `date()`/`datetime()` throw-stubs at
// exactly 0.53 (signature 1.00 — zero-arg exactKey — structure/ast/cf coarse).

/** Today's ISO day, e.g. "2026-10-09". */
export const todayIso = (): string => new Date().toISOString().slice(0, 10);

// Ground truth for the template-one-liner gate (Fix 8): in the real run the
// allergies composite-key builder (`` `${row.system}|${row.code}` ``)
// over-matched the canonical `formatAtTime` (`` `${t.formatDay} at ${t.formatTime}` ``)
// at 0.92 — structure 1.00, controlFlow 1.00, ast 0.66 — because every
// template one-liner shares the same pattern-level skeleton. A composite key
// and a timestamp display are different operations and must stay in the
// similar tier.
interface SubstanceRow {
	system: string;
	code: string;
}

/** A composite key for a substance row. */
export const keyOf = (row: SubstanceRow): string => `${row.system}|${row.code}`;
