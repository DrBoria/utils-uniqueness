// u12 canon — parseQueryString: string -> record (the "decode" direction).

export function parseQueryString(query: string): Record<string, string> {
	const out: Record<string, string> = {};
	const trimmed = query.startsWith("?") ? query.slice(1) : query;
	if (trimmed === "") return out;
	for (const pair of trimmed.split("&")) {
		if (pair === "") continue;
		const eq = pair.indexOf("=");
		const rawKey = eq === -1 ? pair : pair.slice(0, eq);
		const rawVal = eq === -1 ? "" : pair.slice(eq + 1);
		const key = decodeURIComponent(rawKey.replace(/\+/g, " "));
		const val = decodeURIComponent(rawVal.replace(/\+/g, " "));
		if (key !== "") out[key] = val;
	}
	return out;
}
