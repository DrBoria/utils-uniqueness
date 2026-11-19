// u08 canon — recursive merge of two plain-object records.

export function deepMerge(
	target: Record<string, unknown>,
	source: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = { ...target };
	for (const key of Object.keys(source)) {
		const incoming = source[key];
		const existing = out[key];
		if (
			incoming !== null &&
			typeof incoming === "object" &&
			!Array.isArray(incoming) &&
			existing !== null &&
			typeof existing === "object" &&
			!Array.isArray(existing)
		) {
			out[key] = deepMerge(existing as Record<string, unknown>, incoming as Record<string, unknown>);
		} else {
			out[key] = incoming;
		}
	}
	return out;
}
