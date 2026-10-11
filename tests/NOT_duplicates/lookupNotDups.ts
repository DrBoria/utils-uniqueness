// NOT duplicates: single-expression `collection.find(pred)?.prop` lookups that
// are NOT copies of the canonical `splitGroupsValue`. Before the find-lookup
// gate these over-matched splitGroupsValue (structure 1.00, controlFlow 1.00)
// because every single-expression find-lookup shares the same pattern-level
// skeleton (member → find → member), so only the AST signal discriminates them.

// Ground truth from core/ehr/use-lab-order-draft.tsx:202 (FP, 0.78 in the real run).
export const answerOf = (draft: { aoeAnswers: { id: string; answer?: string }[] }, id: string): string | undefined =>
	draft.aoeAnswers.find((a) => a.id === id)?.answer;

// Ground truth from core/ehr/history.rm.ts:136 (FP, 0.70 in the real run).
export const snomedIn = (concept: { coding?: { system: string; code?: string }[] }): string | undefined =>
	concept?.coding?.find((c) => c.system === "SNOMED")?.code;

// Ground truth from core/ehr/seed.ts:312 (FP, 0.70 in the real run).
export const findVitalId = (set: { vitals: { type: string; id: string }[] }, type: string): string | undefined =>
	set.vitals.find((v) => v.type === type)?.id;

// Ground truth from core/ehr/use-organizations.ts:19 (borderline, 0.71 in the
// real run) — a find-lookup with a `?? ""` fallback.
export const orgName = (ident: { identifier?: { type: string; value?: string }[] }): string =>
	ident?.identifier?.find((x) => x.type === "ORG")?.value ?? "";

// A genuine COPY of splitGroupsValue (renamed receiver/property) — this one
// MUST stay a duplicate (regression guard: the gate must demote only the
// *unrelated* find-lookups, not a true twin).
export const splitGroupsValueCopy = (outcome: { extension: { url: string; valueString?: string }[] }): string | undefined =>
	outcome.extension.find((ext) => ext.url === "ORDER_SPLIT")?.valueString;
