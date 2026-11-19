// u12 app — NEGATIVE: formatQueryString is the INVERSE of canon
// parseQueryString (record -> string instead of string -> record). Same
// domain vocabulary (encode/decode, +, &, =, ?) but opposite data flow.

export function formatQueryString(params: Record<string, string>): string {
	const pairs: string[] = [];
	for (const key of Object.keys(params)) {
		if (key === "") continue;
		const encodedKey = encodeURIComponent(key).replace(/%20/g, "+");
		const encodedVal = encodeURIComponent(params[key]).replace(/%20/g, "+");
		pairs.push(`${encodedKey}=${encodedVal}`);
	}
	if (pairs.length === 0) return "";
	return `?${pairs.join("&")}`;
}
