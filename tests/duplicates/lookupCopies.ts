// TRUE copies of canonical find-lookups — app-side regression guards.
// These live in tests/duplicates (app layer) so the pipeline actually compares
// them against the canonicals in tests/NOT_duplicates (same-layer pairs are
// never compared).

// A genuine COPY of splitGroupsValue (renamed receiver/property) — this one
// MUST stay a duplicate (regression guard: the gate must demote only the
// *unrelated* find-lookups, not a true twin).
export const splitGroupsValueCopy = (outcome: { extension: { url: string; valueString?: string }[] }): string | undefined =>
	outcome.extension.find((ext) => ext.url === "ORDER_SPLIT")?.valueString;
