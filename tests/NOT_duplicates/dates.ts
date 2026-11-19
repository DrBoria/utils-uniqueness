// Canonical date utils — ground truth from core/utils/utils/tx.ts
// (parseDayParam, formatIsoDay). Self-contained: a local `Day` stub plays the
// role of Tx.Day so the parser sees the same body structure without imports.

class Day {
	static fromISO(iso) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error("bad day");
		return new Day();
	}

	get formatDay() {
		return "day";
	}
}

/** A `YYYY-MM-DD` URL param as a `Day`, or `undefined` for anything else. */
export const parseDayParam = (iso: string): Day | undefined => {
	if (!iso) return undefined;
	try {
		return Day.fromISO(iso);
	} catch {
		return undefined;
	}
};

/** A stored ISO day as a display string, falling back to the raw value. */
export const formatIsoDay = (iso: string | null | undefined): string | undefined => {
	if (!iso) return undefined;
	try {
		return Day.fromISO(iso).formatDay;
	} catch {
		return iso;
	}
};

// Ground truth from core/utils/utils/tx.ts:1257 — a single-expression
// template one-liner. In the real run the allergies `keyOf` composite-key
// builder (`` `${row.system}|${row.code}` ``) over-matched it at 0.92
// (structure 1.00, controlFlow 1.00, ast 0.66): every template one-liner
// shares the same pattern-level skeleton, so only the AST signal
// (member access vs plain identifiers, static text) discriminates them.
export const formatAtTime = (t: Day): string => `${t.formatDay} at ${t.formatTime}`;
