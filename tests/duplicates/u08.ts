// u08 app — NEGATIVE: builds a record by zipping parallel key/value arrays.
// Same "combine inputs into a Record" domain as canon deepMerge, but a totally
// different algorithm and signature (no recursion, no object spreading).

export function mergePairs(keys: string[], values: string[]): Record<string, string> {
	const out: Record<string, string> = {};
	const count = Math.min(keys.length, values.length);
	for (let i = 0; i < count; i = i + 1) {
		const key = keys[i];
		if (key === "") continue;
		out[key] = values[i];
	}
	return out;
}
