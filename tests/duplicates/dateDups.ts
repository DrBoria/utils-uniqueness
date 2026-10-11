// TRUE duplicate of the canonical `parseDayParam` — ground truth from
// core/ehr/vitals.v/browse/hooks/use-history-filters.ts (`parseDay`).
// Same body shape, param renamed `iso` -> `raw`.

class Day {
	static fromISO(iso) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error("bad day");
		return new Day();
	}

	get formatDay() {
		return "day";
	}

	get formatTime() {
		return "time";
	}
}

const parseDay = (raw: string | null): Day | undefined => {
	if (!raw) return undefined;
	try {
		return Day.fromISO(raw);
	} catch {
		return undefined;
	}
};

// TRUE duplicate of the canonical `formatAtTime` — a genuine renamed copy of
// a template one-liner (param `t` -> `d`). Regression guard for the
// template-one-liner gate (Fix 8): the gate must keep real twins in the
// duplicate tier.
const formatAtTimeCopy = (d: Day): string => `${d.formatDay} at ${d.formatTime}`;

export { parseDay, formatAtTimeCopy };
