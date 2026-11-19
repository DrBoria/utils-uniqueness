// Canonical single-expression find-lookups — from the real run's false-positive
// cluster.
//
// Ground truth from core/ehr/hg.contract.ts:532 — a one-line
// `collection.find(pred)?.prop` lookup. In the real run it over-matched 3
// unrelated find-lookups (answerOf, snomedIn, findVitalId) at 0.70-0.78, all
// with structure 1.00 and controlFlow 1.00, because every single-expression
// find-lookup shares the same pattern-level skeleton (member → find → member),
// so only the AST signal (the actual predicate + accessed property) can tell
// them apart.

/** Value of the order-splitting extension, if present. */
export const splitGroupsValue = (outcome: { extension: { url: string; valueString?: string }[] }): string | undefined =>
	outcome.extension.find((ext) => ext.url === "ORDER_SPLIT")?.valueString;
