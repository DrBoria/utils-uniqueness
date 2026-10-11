// App-to-app fixture (vitals side). The status-guard one-liners mirror
// vitals.v/vitals.adapters.ts: they ARE mutual duplicates of each other, but
// the right recommendation is "inline at the call site", not "extract to
// utils" — the function carries no value. `vitalType` is a plain accessor
// that must stay out of the Trash category.

export type VitalSet = { status: string; type: string };

export const isRemoved = (set: VitalSet): boolean => set.status === "entered-in-error";

export const isAmended = (set: VitalSet): boolean => set.status === "amended" || set.status === "corrected";

export const isCorrected = (set: VitalSet): boolean => set.status === "corrected";

export const isAnnotated = (set: VitalSet): boolean => set.status === "amended";

export const vitalType = (set: VitalSet): string => set.type;
