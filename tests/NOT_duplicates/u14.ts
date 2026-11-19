// u14 canon — deepFlatten written RECURSIVELY.

export function deepFlatten(input: unknown[]): unknown[] {
	const out: unknown[] = [];
	for (const item of input) {
		if (Array.isArray(item)) {
			const nested = deepFlatten(item);
			for (const inner of nested) {
				out.push(inner);
			}
		} else {
			out.push(item);
		}
	}
	return out;
}
